// Сущности: игрок, лук/стрелы, мясо, мобы (animal.gd), камеры наблюдения (camera_manager.gd).
import * as BABYLON from "@babylonjs/core";
import { getHeight } from "./noise.js";
import { breakGlass } from "./world.js";
import { MODELS_BASE } from "./assets.js";

// ---------- Игрок: SPEED 5, JUMP 4.5, мышь 0.002, HP 100 ----------
export function createPlayer(scene, camera) {
  const mesh = BABYLON.MeshBuilder.CreateCapsule("Player", { radius: 0.35, height: 1.15 }, scene);
  mesh.position = new BABYLON.Vector3(0, 1, -14.08);
  const mat = new BABYLON.StandardMaterial("playerMat", scene);
  mat.diffuseColor = new BABYLON.Color3(0.2, 0.4, 0.9);
  mesh.material = mat;
  mesh.checkCollisions = true;
  mesh.ellipsoid = new BABYLON.Vector3(0.35, 0.6, 0.35); // под капсулу: скользим по склонам
  mesh.isPickable = false; // самого себя лучами не ловим
  mesh.metadata = { kind: "player" };
  mesh.layerMask = 0x2; // невидим для фид-камеры (как cull_mask без layer2)
  const st = { vel: new BABYLON.Vector3(0, 0, 0), hp: 100, meat: 0, grounded: false,
    spawn: mesh.position.clone(), yaw: 2.4, pitch: 0, flash: 0 };
  return { mesh, st };
}

export function updatePlayer(scene, player, camera, input, dt, frozen) {
  const { mesh, st } = player;
  const SPEED = 5.0, GRAV = 9.8, MAXFALL = -20;
  if (frozen) { st.vel.set(0, 0, 0); return; }
  // Babylon — левосторонний, камера смотрит +Z: forward=(sin yaw,0,cos yaw), right=+X при yaw 0
  const f = new BABYLON.Vector3(Math.sin(st.yaw), 0, Math.cos(st.yaw));
  const r = new BABYLON.Vector3(f.z, 0, -f.x);
  const move = BABYLON.Vector3.Zero();
  if (input.f) move.addInPlace(f);
  if (input.b) move.subtractInPlace(f);
  if (input.l) move.subtractInPlace(r);
  if (input.r) move.addInPlace(r);
  if (move.lengthSquared() > 0) move.normalize().scaleInPlace(SPEED * dt);
  // Горизонталь и вертикаль раздельными шагами — иначе на склоне отталкивает.
  // В покое (стоим, без ввода) вертикаль не гоняем: мелкий шаг гравитации
  // выталкивался коллизией вбок по нормали склона — отсюда медленное сползание.
  mesh.moveWithCollisions(move);
  const resting = st.grounded && st.vel.y <= 0 && move.lengthSquared() === 0;
  if (!resting) {
    st.vel.y = Math.max(MAXFALL, st.vel.y - GRAV * dt);
    mesh.moveWithCollisions(new BABYLON.Vector3(0, st.vel.y * dt, 0));
  } else {
    st.vel.y = 0;
  }
  // Земля: короткий луч вниз = низ эллипсоида (0.6) + скин 0.08.
  // Длинный луч (0.8) срабатывал почти сразу после прыжка (~1м) и гасил падение.
  const ray = new BABYLON.Ray(mesh.position, new BABYLON.Vector3(0, -1, 0), 0.68);
  const hit = scene.pickWithRay(ray, (m) => m.isPickable !== false && m.isEnabled()
    && (m.metadata?.kind === "terrain" || m.metadata?.kind === "house"));
  st.grounded = !!hit?.pickedMesh;
  if (st.grounded && st.vel.y <= 0) {
    // Стоим: гравитацию не копим, иначе коллизия и падение дерутся каждый кадр
    // и камера дрожит. Точный покой на точке контакта.
    st.vel.y = 0;
    const target = hit.pickedPoint.y + 0.6;
    // Дельта ограничена: по склону/лестнице прилипаем, а в воронку ямы падаем свободно
    if (Math.abs(target - mesh.position.y) < 0.35) mesh.position.y = target;
  }
  if (input.jump && st.grounded) { st.vel.y = 4.5; st.grounded = false; input.jump = false; }
  // Страховка от дыр стриминга: провалились глубоко под analytic-поверхность —
  // вернуть на неё (в пещере y<-30 не трогаем, там свой пол)
  if (mesh.position.y > -30) {
    const gy = getHeight(mesh.position.x, mesh.position.z);
    if (mesh.position.y < gy - 3) {
      mesh.position.y = gy + 0.6; st.vel.y = 0; st.grounded = true;
    }
  }
  camera.position.set(mesh.position.x, mesh.position.y + 0.45, mesh.position.z);
  camera.rotation.set(st.pitch, st.yaw, 0);
  mesh.rotation.y = st.yaw;
}

export function damagePlayer(player, amount, hud) {
  player.st.hp = Math.max(0, player.st.hp - amount);
  // Удар зверя: экран краснеет ВСЁ СИЛЬНЕЕ (накопление, затухание — в main.js).
  player.st.flash = Math.min(1, player.st.flash + 0.3);
  if (player.st.hp <= 0) {
    player.mesh.position.copyFrom(player.st.spawn);
    player.st.vel.set(0, 0, 0);
    player.st.hp = 100;
    player.st.flash = 0; // после смерти экран снова чистый
  }
  hud();
}

// ---------- Лук как в bow.gd: плечи 8 сегментов по кривой, тетива 7 сегментов
// с оттяжкой, рукоять, наконечники, наложенная стрела (видна при натяжении).
// Натяжение 0.15..1.2с. Камерное пространство Babylon: полёт стрелы = +Z,
// поэтому ось z зеркалим относительно Godot (там полёт = -Z).
const BOW_H = 0.55, IDLE_BEND = 0.05, DRAW_BEND = 0.11, PULL_BASE = 0.03, PULL_MAX = 0.16;
const _bowUp = new BABYLON.Vector3(0, 1, 0);
const _bowQ = new BABYLON.Quaternion();
function bowLimbPoint(u, bend) {
  return new BABYLON.Vector3(0, (u - 0.5) * BOW_H, bend * Math.sin(Math.PI * u));
}
function bowStringPoint(u, pull, bend) {
  const a = bowLimbPoint(0, bend), b = bowLimbPoint(1, bend);
  return a.scale(1 - u).addInPlace(b.scale(u)).addInPlace(new BABYLON.Vector3(0, 0, -pull * Math.sin(Math.PI * u)));
}
function bowSeg(scene, parent, mat, sx, sz) {
  const m = BABYLON.MeshBuilder.CreateBox("bowseg", { width: 1, height: 1, depth: 1 }, scene);
  m.material = mat; m.parent = parent; m.layerMask = 0x2;
  m.metadata = { kind: "bow" }; m.isPickable = false;
  m.userData = { sx, sz };
  return m;
}
function bowPlaceSeg(m, a, b) {
  const d = b.subtract(a);
  const len = Math.max(0.001, d.length());
  m.position.copyFrom(a).addInPlace(b).scaleInPlace(0.5);
  BABYLON.Quaternion.FromUnitVectorsToRef(_bowUp, d.scaleInPlace(1 / len), _bowQ);
  m.rotationQuaternion = _bowQ.clone();
  m.scaling.set(m.userData.sx, len, m.userData.sz);
}
function bowMat(scene, r, g, b, rough) {
  const m = new BABYLON.StandardMaterial("bowmat", scene);
  m.diffuseColor = new BABYLON.Color3(r, g, b);
  m.specularColor = new BABYLON.Color3(0.08, 0.08, 0.08);
  void rough;
  return m;
}
export function createBow(scene, camera) {
  const root = new BABYLON.TransformNode("Bow", scene);
  const wood = bowMat(scene, 0.42, 0.25, 0.1);
  const stringM = bowMat(scene, 0.85, 0.82, 0.7);
  const gripM = bowMat(scene, 0.18, 0.1, 0.05);
  const tipM = bowMat(scene, 0.12, 0.09, 0.06);
  const limbs = [];
  for (let i = 0; i < 8; i++) limbs.push(bowSeg(scene, root, wood, 0.02, 0.024));
  const strings = [];
  for (let i = 0; i < 7; i++) strings.push(bowSeg(scene, root, stringM, 0.004, 0.004));
  const grip = BABYLON.MeshBuilder.CreateBox("grip", { width: 0.024, height: 0.09, depth: 0.034 }, scene);
  grip.material = gripM; grip.parent = root; grip.layerMask = 0x2;
  grip.metadata = { kind: "bow" }; grip.isPickable = false;
  const tips = [0, 1].map(() => {
    const t = BABYLON.MeshBuilder.CreateBox("tip", { width: 0.028, height: 0.04, depth: 0.034 }, scene);
    t.material = tipM; t.parent = root; t.layerMask = 0x2;
    t.metadata = { kind: "bow" }; t.isPickable = false;
    return t;
  });
  const nocked = new BABYLON.TransformNode("NockedArrow", scene);
  nocked.parent = root;
  const shaft = BABYLON.MeshBuilder.CreateBox("nshaft", { width: 0.018, height: 0.018, depth: 0.68 }, scene);
  shaft.material = bowMat(scene, 0.55, 0.35, 0.15); shaft.parent = nocked;
  shaft.layerMask = 0x2; shaft.metadata = { kind: "bow" }; shaft.isPickable = false;
  const head = BABYLON.MeshBuilder.CreateBox("nhead", { width: 0.034, height: 0.034, depth: 0.1 }, scene);
  const headM = bowMat(scene, 0.3, 0.3, 0.35);
  headM.specularColor = new BABYLON.Color3(0.6, 0.6, 0.6); // metallic 0.6 в оригинале
  head.material = headM; head.parent = nocked;
  head.layerMask = 0x2; head.metadata = { kind: "bow" }; head.isPickable = false;
  root.parent = camera;
  root.position.set(0.25, -0.15, 0.4); // впереди камеры (в Godot -0.4, т.к. там вперёд -Z)
  return { root, limbs, strings, grip, tips, nocked, shaft, head, drawing: false, timer: 0 };
}

export function updateBow(bow, dt) {
  if (bow.drawing) bow.timer = Math.min(1.2, bow.timer + dt);
  else bow.timer = Math.max(0, bow.timer - dt * 10);
  const t = bow.timer / 1.2;
  const bend = IDLE_BEND + (DRAW_BEND - IDLE_BEND) * t;
  const pull = PULL_BASE + (PULL_MAX - PULL_BASE) * t;
  for (let i = 0; i < 8; i++)
    bowPlaceSeg(bow.limbs[i], bowLimbPoint(i / 8, bend), bowLimbPoint((i + 1) / 8, bend));
  for (let i = 0; i < 7; i++)
    bowPlaceSeg(bow.strings[i], bowStringPoint(i / 7, pull, bend), bowStringPoint((i + 1) / 7, pull, bend));
  bow.grip.position.set(0, -0.02, bend - 0.014);
  bow.tips[0].position.copyFrom(bowLimbPoint(0, bend));
  bow.tips[1].position.copyFrom(bowLimbPoint(1, bend));
  bow.nocked.setEnabled(bow.drawing);
  if (bow.drawing) {
    bow.shaft.position.set(0, -0.02, -pull + 0.34);
    bow.head.position.set(0, -0.02, -pull + 0.63);
  }
}

// ---------- Стрелы: урон 1, подбор после остановки, прилипание к мобам ----------
export const arrows = [];
export function shootArrow(scene, camera, power) {
  const t = Math.min(1, power / 1.2);
  const speed = 6 + (25 - 6) * t * t;
  const grav = 1.2 * (1 - t);
  const mesh = BABYLON.MeshBuilder.CreateBox("arrow", { width: 0.03, height: 0.03, depth: 0.8 }, scene);
  const m = new BABYLON.StandardMaterial("arrowMat", scene);
  m.diffuseColor = new BABYLON.Color3(0.5, 0.35, 0.2);
  mesh.material = m;
  const dir = camera.getDirection(new BABYLON.Vector3(0, 0, 1));
  mesh.position = camera.position.add(dir.scale(0.6));
  mesh.lookAt(mesh.position.add(dir));
  mesh.metadata = { kind: "arrow" };
  arrows.push({ mesh, vel: dir.scale(speed), grav, stuck: null, stuckOffset: null, stopped: false, age: 0 });
}

export function updateArrows(scene, dt, animals, glass, player) {
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i];
    if (a.stuck) {
      const host = a.stuck;
      if (host.disposed || host.st.dead) {
        // Как _drop() в оригинале: отлипнуть, вернуть нормальную гравитацию и упасть.
        // Без сброса grav стрела с полной натяжки (grav≈0) улетала в небо навсегда.
        a.stuck = null;
        a.grav = 1.0;
        a.stopped = false;
        a.vel.set((Math.random() - 0.5) * 1.2, 0.8 + Math.random() * 0.6, (Math.random() - 0.5) * 1.2);
      } else {
        // Смещение и направление — в ЛОКАЛЬНЫХ осях носителя: стрела крутится вместе с ним
        a.mesh.position.copyFrom(BABYLON.Vector3.TransformCoordinates(a.stuckLocalPos, host.mesh.getWorldMatrix()));
        const wd = BABYLON.Vector3.TransformNormal(a.stuckLocalDir, host.mesh.getWorldMatrix());
        a.mesh.lookAt(a.mesh.position.add(wd));
        continue;
      }
    }
    if (a.stopped) {
      // Как PickupArea в arrow.tscn: подбор проходом (лучом в 3см стрелу не попасть)
      if (player && a.mesh.position.subtract(player.mesh.position).length() < 1.2) {
        a.mesh.dispose(); arrows.splice(i, 1);
      }
      continue;
    }
      a.vel.y -= 9.8 * a.grav * dt;
      const step = a.vel.scale(dt);
      const ray = new BABYLON.Ray(a.mesh.position, a.vel.normalizeToNew(), step.length() + 0.1);
      const hit = scene.pickWithRay(ray, (m) => m.isPickable !== false && m.isEnabled()
        && m.name !== "arrow" && m.metadata?.kind !== "player" && m.metadata?.kind !== "bow");
      a.mesh.position.addInPlace(step);
      if (a.vel.lengthSquared() > 0.09)
        a.mesh.lookAt(a.mesh.position.add(a.vel.normalizeToNew()));
      if (hit?.pickedMesh) {
        const m = hit.pickedMesh;
        const kind = m.metadata?.kind;
        if (kind === "glass") breakGlass(scene, glass);
        // Зверь ищется вверх по родителям: луч бьёт в дочерние меши .glb
        // (у медведя их 10 и они торчат за хитбокс), а хитбокс — их корень
        let t = m, an = null;
        while (t && !an) {
          if (t.metadata?.kind === "animal") an = animals.find(x => x.mesh === t);
          t = t.parent;
        }
        if (an) {
          damageAnimal(scene, an, 1.0);
          // Запоминаем точку и направление в локальных осях зверя
          const inv = an.mesh.getWorldMatrix().clone();
          inv.invert();
          a.stuck = an;
          a.stuckLocalPos = BABYLON.Vector3.TransformCoordinates(a.mesh.position, inv);
          const wdir = a.vel.lengthSquared() > 0.001
            ? a.vel.normalizeToNew() : new BABYLON.Vector3(0, 0, 1);
          a.stuckLocalDir = BABYLON.Vector3.TransformNormal(wdir, inv);
          continue;
        }
        a.stopped = true;
      }
      const g = getHeight(a.mesh.position.x, a.mesh.position.z);
      if (a.mesh.position.y < g) { a.stopped = true; a.mesh.position.y = g + 0.05; }
      a.age += dt;
      if (a.age > 30) { a.mesh.dispose(); arrows.splice(i, 1); }
  }
}

// ---------- Мясо: +1 к счёту, жизнь 30с ----------
export const meats = [];
export function spawnMeat(scene, pos) {
  const mesh = BABYLON.MeshBuilder.CreateBox("meat", { width: 0.12, height: 0.1, depth: 0.12 }, scene);
  const mat = new BABYLON.StandardMaterial("meatMat", scene);
  mat.diffuseColor = new BABYLON.Color3(0.6, 0.22, 0.18);
  mesh.material = mat;
  mesh.position.copyFrom(pos).addInPlace(new BABYLON.Vector3(0, 0.25, 0));
  mesh.metadata = { kind: "meat" };
  mesh.isPickable = false;
  meats.push({ mesh, vel: new BABYLON.Vector3((Math.random() - 0.5) * 1.2, 1.1, (Math.random() - 0.5) * 1.2), age: 0 });
}

export function updateMeats(scene, dt, player, hud) {
  for (let i = meats.length - 1; i >= 0; i--) {
    const m = meats[i];
    m.age += dt;
    m.vel.y -= 9.8 * dt;
    m.mesh.position.addInPlace(m.vel.scale(dt));
    const g = getHeight(m.mesh.position.x, m.mesh.position.z) + 0.08;
    if (m.mesh.position.y < g) { m.mesh.position.y = g; m.vel.set(0, 0, 0); }
    if (m.mesh.position.subtract(player.mesh.position).length() < 1.2) {
      player.st.meat++; hud();
      m.mesh.dispose(); meats.splice(i, 1); continue;
    }
    if (m.age > 30) { m.mesh.dispose(); meats.splice(i, 1); }
  }
}

// ---------- Мобы: rabbit/fox/wolf/bear (h, speed, hp, dmg из animal.gd) ----------
export const KINDS = {
  rabbit: { h: 0.45, speed: 1.7, hp: 1, dmg: 0, color: new BABYLON.Color3(0.8, 0.75, 0.7) },
  fox:    { h: 0.55, speed: 1.3, hp: 1, dmg: 8, color: new BABYLON.Color3(0.9, 0.45, 0.15) },
  wolf:   { h: 0.7, speed: 1.1, hp: 1, dmg: 12, color: new BABYLON.Color3(0.4, 0.4, 0.45) },
  bear:   { h: 0.95, speed: 0.7, hp: 2, dmg: 25, color: new BABYLON.Color3(0.3, 0.2, 0.12) },
};
export const animals = [];
// Поправка ориентации модели. glTF правосторонний, Babylon левосторонний —
// лоадер зеркалит модели по Z (__root__.scaling.z = -1), поэтому нос из +Z
// файла смотрит в -Z хитбокса. rabbit/fox/wolf в файле носом в +Z → доворот PI;
// bear в файле носом в -Z → доворот 0. Без этого лиса/волк идут задом наперёд.
const KIND_YAW = { rabbit: Math.PI, fox: Math.PI, wolf: Math.PI, bear: 0 };

const MODEL_FILES = { rabbit: "rabbit.glb", fox: "fox.glb", wolf: "wolf.glb", bear: "bear.glb" };
// Доводка ориентации для мешей Quaternius со скелетом (лиса/волк): их узлы дают
// лишний поворот (AnimalArmature: -90° по X, __root__: 180° по Y), из-за чего
// модель в файле (нос в +Z, верх в +Y) рендерится кувырком. Доворачиваем клон
// меша жёстко: анатомия и анимации не страдают, т.к. это статическое размещение.
// +90° по X: верх файла → мировой верх, нос → -Z хитбокса (KIND_YAW = PI).
// Проверено в игре (скриншоты): лиса/волк стоят на ногах и идут головой вперёд.
const KIND_PITCH = { fox: 90, wolf: 90 };
function fixMeshPitch(res, kind) {
  const deg = KIND_PITCH[kind];
  if (deg === undefined) return;
  const prim = (res.meshes || []).find(m => m.name && m.name.includes("primitive"));
  const node = prim && prim.parent;
  if (!node) return;
  const a = deg * Math.PI / 360;
  node.rotationQuaternion = new BABYLON.Quaternion(Math.sin(a), 0, 0, Math.cos(a));
}

// Скелеты, у которых корень — НЕ общий корень всех костей (Blender-риги с IK:
// лиса/волк Quaternius — кости IK*/FF висят на AnimalArmature мимо Body).
// Лоадер строит цепочку костей только внутри скелета, и трансформ предка
// (у AnimalArmature скейл x100) теряется для всего поддерева: кости получают
// ~1/100 масштаб, мех схлопывается в точку, а смешанные примитивы — в «палки».
// Возвращаем корневые кости под их предков, как в узлах glTF.
function fixSkeletonRoots(scene, res) {
  for (const sk of res.skeletons || []) {
    const byName = new Map();
    for (const b of sk.bones) if (!byName.has(b.name)) byName.set(b.name, b);
    for (const b of sk.bones) {
      if (b.getParent() || b.getIndex() === -1) continue; // только корни-джойнты
      let n = scene.getNodeByName(b.name);
      n = n ? n.parent : null;
      while (n) {
        const pb = byName.get(n.name);
        if (pb && pb !== b) { b.setParent(pb, false); break; }
        n = n.parent;
      }
    }
  }
}

// ---------- Медведь: процедурная low-poly модель вместо boxy bear.glb ----------
// Стиль под Quaternius-зверей (лиса/волк): гранёные формы через
// convertToFlatShadedMesh, нос в +Z (KIND_YAW.bear = 0). Ноги — пивоты,
// качаются в procBearAnim (походка/дыхание/удар), скелета и клипов нет.
function procBearPart(root, name, mk, mat, x, y, z, sx, sy, sz, parent) {
  const m = mk(name);
  m.material = mat;
  m.position.set(x, y, z);
  m.scaling.set(sx, sy, sz);
  m.parent = parent || root;
  m.isPickable = false; // бьём/стреляем в хитбокс (он pickable, части — нет)
  m.convertToFlatShadedMesh();
  return m;
}
function buildProcBear(scene, mesh, info) {
  const root = new BABYLON.TransformNode("bearRoot", scene);
  root.parent = mesh;
  const baseY = -info.h / 2; // ступни на дне хитбокса
  root.position.y = baseY;
  root.scaling.setAll(0.8);
  const fur = new BABYLON.StandardMaterial("bearFur", scene);
  fur.diffuseColor = new BABYLON.Color3(0.30, 0.20, 0.12);
  fur.specularColor = new BABYLON.Color3(0.04, 0.04, 0.04);
  const dark = new BABYLON.StandardMaterial("bearDark", scene);
  dark.diffuseColor = new BABYLON.Color3(0.20, 0.13, 0.08);
  dark.specularColor = new BABYLON.Color3(0.04, 0.04, 0.04);
  const tan = new BABYLON.StandardMaterial("bearTan", scene);
  tan.diffuseColor = new BABYLON.Color3(0.48, 0.34, 0.20);
  tan.specularColor = new BABYLON.Color3(0.04, 0.04, 0.04);
  const noseM = new BABYLON.StandardMaterial("bearNose", scene);
  noseM.diffuseColor = new BABYLON.Color3(0.07, 0.06, 0.05);
  const sph = (n, d) => BABYLON.MeshBuilder.CreateSphere(n, { diameter: d, segments: 2 }, scene);
  const box = (n, w, h, d) => BABYLON.MeshBuilder.CreateBox(n, { width: w, height: h, depth: d }, scene);
  procBearPart(root, "bearBody", () => sph("bearBody", 0.62), fur, 0, 0.60, -0.05, 1, 0.92, 1.6);
  procBearPart(root, "bearHump", () => sph("bearHump", 0.40), fur, 0, 0.80, 0.28, 1.05, 0.95, 1.1);
  procBearPart(root, "bearRump", () => sph("bearRump", 0.44), fur, 0, 0.60, -0.42, 1, 0.95, 1.05);
  const head = new BABYLON.TransformNode("bearHead", scene);
  head.parent = root; head.position.set(0, 0.86, 0.55);
  procBearPart(root, "bearSkull", () => sph("bearSkull", 0.34), fur, 0, 0, 0.06, 1, 0.95, 1.05, head);
  procBearPart(root, "bearSnout", () => box("bearSnout", 0.18, 0.14, 0.22), tan, 0, -0.07, 0.26, 1, 1, 1, head);
  procBearPart(root, "bearNose", () => box("bearNose", 0.09, 0.07, 0.06), noseM, 0, -0.03, 0.38, 1, 1, 1, head);
  procBearPart(root, "bearEarL", () => sph("bearEarL", 0.11), dark, -0.14, 0.17, -0.02, 1, 1, 1, head);
  procBearPart(root, "bearEarR", () => sph("bearEarR", 0.11), dark, 0.14, 0.17, -0.02, 1, 1, 1, head);
  const leg = (n, x, z) => {
    const piv = new BABYLON.TransformNode(n, scene);
    piv.parent = root; piv.position.set(x, 0.50, z);
    const cyl = BABYLON.MeshBuilder.CreateCylinder(n + "M", { height: 0.52, diameterTop: 0.11, diameterBottom: 0.15, tessellation: 6 }, scene);
    procBearPart(root, n + "M", () => cyl, dark, 0, -0.22, 0, 1, 1, 1, piv);
    procBearPart(root, n + "Paw", () => box(n + "Paw", 0.16, 0.10, 0.22), dark, 0, -0.45, 0.04, 1, 1, 1, piv);
    return piv;
  };
  const proc = { root, baseY, head,
    legFL: leg("bearLegFL", -0.20, 0.30), legFR: leg("bearLegFR", 0.20, 0.30),
    legBL: leg("bearLegBL", -0.21, -0.38), legBR: leg("bearLegBR", 0.21, -0.38) };
  procBearPart(root, "bearTail", () => sph("bearTail", 0.12), dark, 0, 0.66, -0.62, 1, 1, 1, root);
  return proc;
}
// Походка (диагональные пары), дыхание в покое, удар — встаёт на дыбы и бьёт.
function procBearAnim(an, dt, moving, atkT) {
  const P = an.proc;
  an.st.step = (an.st.step || 0) + dt * (moving ? 3 + an.info.speed * 2.2 : 0.6);
  const s = Math.sin(an.st.step * 2.2);
  const ease = (o, v) => { o.rotation.x += (v - o.rotation.x) * Math.min(1, dt * 10); };
  if (atkT >= 0) {
    const k = Math.sin(Math.min(1, atkT) * Math.PI);
    P.root.rotation.x = -0.5 * k;
    P.head.rotation.x = -0.35 * k;
    P.legFL.rotation.x = -1.1 * k; P.legFR.rotation.x = -1.1 * k;
    P.legBL.rotation.x = 0.35 * k; P.legBR.rotation.x = 0.35 * k;
    P.root.position.y = P.baseY;
  } else if (moving) {
    P.root.rotation.x = 0;
    P.head.rotation.x = 0.05 * s; P.head.rotation.y = 0;
    P.legFL.rotation.x = 0.55 * s; P.legBR.rotation.x = 0.55 * s;
    P.legFR.rotation.x = -0.55 * s; P.legBL.rotation.x = -0.55 * s;
    P.root.position.y = P.baseY + Math.abs(Math.cos(an.st.step * 2.2)) * 0.025;
  } else {
    P.root.rotation.x = 0;
    an.st.breath = (an.st.breath || 0) + dt;
    const b = Math.sin(an.st.breath * 2.2);
    ease(P.legFL, 0); ease(P.legFR, 0); ease(P.legBL, 0); ease(P.legBR, 0);
    P.head.rotation.x = 0.03 * b;
    P.head.rotation.y = 0.18 * Math.sin(an.st.breath * 0.45);
    P.root.position.y = P.baseY + 0.008 * b;
  }
}

export async function spawnAnimal(scene, kind, pos) {
  const info = KINDS[kind];
  const mesh = BABYLON.MeshBuilder.CreateBox(`an_${kind}`, { width: 0.8, height: Math.max(info.h, 0.3), depth: 1.2 }, scene);
  const mat = new BABYLON.StandardMaterial(`anMat_${kind}`, scene);
  mat.diffuseColor = info.color;
  mat.alpha = 1;
  mesh.material = mat;
  mesh.position.copyFrom(pos);
  mesh.metadata = { kind: "animal" };
  mesh.isPickable = true;
  // хитбокс = сам меш (layer 3 в оригинале)
  const an = { mesh, hitbox: mesh, kind, info, hp: info.hp, st: { dead: false, deathAge: 0, spawnAge: 0,
    wanderTarget: null, wanderT: 0, attackCd: 0, attackT: 0, forcedAggro: false, groundT: 0 }, disposed: false };
  // Пытаемся заменить бокс на .glb (не критично если нет).
  // Медведь — процедурный (boxy bear.glb не в стиле Quaternius-зверей).
  if (kind === "bear") {
    mesh.material.alpha = 0; // скрыть бокс, оставить коллизию
    an.walkAG = an.restAG = an.attackAG = null;
    an.proc = buildProcBear(scene, mesh, info);
  } else
  try {
    const res = await BABYLON.SceneLoader.ImportMeshAsync("", MODELS_BASE(), MODEL_FILES[kind], scene);
    fixSkeletonRoots(scene, res);
    fixMeshPitch(res, kind);
    if (res.meshes.length) {
      const glb = res.meshes[0];
      // Честные границы ПОСЛЕ фиксов: getHierarchyBoundingVectors читает кэш,
      // посчитанный лоадером до фиксов скелета (размер/посадка плывут в разы).
      // Первый проход освежает мировые матрицы, refreshBoundingInfo(true)
      // пересчитывает границы по текущему скинингу (копию, буфер цел —
      // двойного скининга в шейдере не будет), второй проход читает их.
      glb.getHierarchyBoundingVectors();
      for (const m of res.meshes) {
        if (m.getTotalVertices && m.getTotalVertices() && m.skeleton) {
          try { m.refreshBoundingInfo(true); } catch { /* noop */ }
        }
      }
      const bb = glb.getHierarchyBoundingVectors();
      const sizeY = Math.max(0.01, bb.max.y - bb.min.y);
      const s = info.h / sizeY;
      glb.scaling.setAll(s);
      glb.parent = mesh;
      glb.position.y = -bb.min.y * s - info.h / 2;
      mesh.material.alpha = 0; // скрыть бокс, оставить коллизию
      mesh.material = mesh.material;
      an.glb = glb;
    }
    // Клипы как в animal.gd:_cache_anim + атака: walk/run, rest/idle/survey, attack/bite.
    // Точное "Idle" в приоритете — иначе цепляется "Idle_HitReact_*".
    const groups = res.animationGroups || [];
    an.walkAG = groups.find(g => /walk|run/i.test(g.name)) || groups[0] || null;
    an.restAG = groups.find(g => /^idle$/i.test(g.name))
      || groups.find(g => /rest|idle|survey/i.test(g.name) && !/hit.?react/i.test(g.name)) || null;
    an.attackAG = groups.find(g => /attack/i.test(g.name))
      || groups.find(g => /bite|punch/i.test(g.name)) || null;
    // Ноды, которые драйвит ТОЛЬКО атака (напр. Torso3 у лисы/волка):
    // Idle/Walk их не трогают, и после удара они застревали бы в финальном
    // кадре (спина/ноги остаются согнутыми). Снапшотим bind-трансформы ДО
    // старта клипов, в конце удара возвращаем. skeleton.returnToRest() тут не
    // годится: кости залинкованы на ноды и rest-матрицы для них ненадёжны.
    const inLoops = new Set();
    for (const ag of [an.walkAG, an.restAG]) if (ag) for (const t of ag.targetedAnimations) inLoops.add(t.target);
    an.bindNodes = [];
    const allTargets = new Set();
    for (const ag of [an.walkAG, an.restAG, an.attackAG]) if (ag) for (const t of ag.targetedAnimations) allTargets.add(t.target);
    for (const n of allTargets) {
      if (!n || !n.position) continue;
      an.bindNodes.push({ n, p: n.position.clone(),
        q: n.rotationQuaternion ? n.rotationQuaternion.clone() : null,
        e: n.rotation.clone(), s: n.scaling.clone() });
    }
    if (an.restAG) { an.restAG.start(true); an.restAG.speedRatio = 1; }
    else if (an.walkAG) { an.walkAG.start(true); an.walkAG.speedRatio = 1; }
  } catch { /* fallback — цветной бокс */ }
  animals.push(an);
  return an;
}

export function damageAnimal(scene, an, dmg) {
  if (an.st.dead) return;
  an.hp -= dmg;
  if (an.hp <= 0) {
    an.st.dead = true; an.st.deathAge = 0;
    an.mesh.setEnabled(false);
    if (an.kind === "rabbit") spawnMeat(scene, an.mesh.position);
  } else if (an.kind !== "rabbit") an.st.forcedAggro = true;
}

function restoreUndriven(an) {
  if (!an.bindNodes || an.bindNodes.length === 0) return;
  const driven = new Set();
  for (const ag of [an.walkAG, an.restAG, an.attackAG]) {
    if (ag && ag.isPlaying) for (const t of ag.targetedAnimations) driven.add(t.target);
  }
  for (const r of an.bindNodes) {
    if (driven.has(r.n)) continue;
    r.n.position.copyFrom(r.p);
    r.n.scaling.copyFrom(r.s);
    if (r.q || r.n.rotationQuaternion)
      r.n.rotationQuaternion = r.q ? r.q.clone()
        : BABYLON.Quaternion.RotationYawPitchRoll(r.e.y, r.e.x, r.e.z);
    else r.n.rotation.copyFrom(r.e);
  }
}

const _tmp = [];
// Плавный доворот с задержкой (не снап): кратчайшая дуга, макс. шаг за кадр.
function smoothYaw(cur, des, maxStep) {
  let d = (des - cur) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return cur + Math.max(-maxStep, Math.min(maxStep, d));
}
export function updateAnimals(scene, dt, player, hud) {
  const pp = player.mesh.position;
  for (let i = animals.length - 1; i >= 0; i--) {
    const an = animals[i];
    if (an.st.dead) {
      an.st.deathAge += dt;
      if (an.st.deathAge > 0.7) { an.mesh.dispose(); an.disposed = true; animals.splice(i, 1); }
      continue;
    }
    an.st.spawnAge += dt;
    const sIn = Math.min(1, an.st.spawnAge / 0.4);
    an.mesh.scaling.setAll(Math.max(0.01, sIn));
    const p = an.mesh.position;
    const distP = Math.hypot(p.x - pp.x, p.z - pp.z);
    let dir = null, spd = an.info.speed, holdFace = null;

    if (an.kind === "rabbit") {
      // бежать от хищников <7м и игрока <4.2м
      const flee = new BABYLON.Vector3(0, 0, 0);
      for (const o of animals) {
        if (o === an || o.kind === "rabbit" || o.st.dead) continue;
        const d = Math.hypot(p.x - o.mesh.position.x, p.z - o.mesh.position.z);
        if (d < 7 && d > 0.01) {
          const w = 1 - d / 7;
          flee.x += (p.x - o.mesh.position.x) / d * w;
          flee.z += (p.z - o.mesh.position.z) / d * w;
        }
      }
      if (distP < 4.2 && distP > 0.01) {
        const w = 1 - distP / 4.2;
        flee.x += (p.x - pp.x) / distP * w; flee.z += (p.z - pp.z) / distP * w;
      }
      if (flee.lengthSquared() > 0.001) { dir = flee.normalize(); spd = an.info.speed * 2.0; }
    } else {
      // охотник: кролик <24м, иначе игрок (<16м или forced)
      let target = null, best = 24;
      if (!(an.kind === "bear" && !an.st.forcedAggro)) {
        for (const o of animals) {
          if (o.kind !== "rabbit" || o.st.dead) continue;
          const d = Math.hypot(p.x - o.mesh.position.x, p.z - o.mesh.position.z);
          if (d < best) { best = d; target = o.mesh.position; }
        }
      }
      const wantPlayer = an.st.forcedAggro || distP < 16;
      if (!target && wantPlayer && !(an.kind === "bear" && !an.st.forcedAggro)) target = pp;
      else if (!target && an.kind === "bear") target = null;
      if (target) {
        const d = Math.hypot(p.x - target.x, p.z - target.z);
        const mult = an.kind === "bear" ? 1.3 : 2.5;
        // Медведь крупнее: бьёт с 1.35м (встаёт на дыбы), мелочь — с 1.1м
        const atkR = an.kind === "bear" ? 1.35 : 1.1;
        if (d > atkR) { dir = new BABYLON.Vector3(target.x - p.x, 0, target.z - p.z).normalize(); spd = an.info.speed * mult; }
        else {
          // Вплотную к цели: стоим, атакуем и доворачиваемся на неё (а не бродим)
          holdFace = target;
          // атака: кд 1.2с, анимация 0.38с, урон на t>=0.5 если <=1.9м
          an.st.attackCd -= dt;
          if (an.st.attackCd <= 0) { an.st.attackCd = 1.2; an.st.attackT = 0.0001; an.st.attackTarget = target; }
        }
      }
    }
    if (!dir && !holdFace) { // wander в радиусе 8м (не когда держим цель)
      an.st.wanderT -= dt;
      if (!an.st.wanderTarget || an.st.wanderT <= 0) {
        const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 6;
        an.st.wanderTarget = new BABYLON.Vector3(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r);
        an.st.wanderT = 3 + Math.random() * 3;
      }
      const d = Math.hypot(an.st.wanderTarget.x - p.x, an.st.wanderTarget.z - p.z);
      if (d > 0.5) dir = new BABYLON.Vector3(an.st.wanderTarget.x - p.x, 0, an.st.wanderTarget.z - p.z).normalize();
      spd = an.info.speed * 0.5;
    }
    // Доворот плавный с задержкой, ровно на цель не снапаем: в движении — по курсу, в упор — на цель
    const faceRate = (an.kind === "rabbit" ? 3.5 : 2.5) * dt;
    const kyaw = KIND_YAW[an.kind] || 0;
    if (dir) {
      p.x += dir.x * spd * dt; p.z += dir.z * spd * dt;
      an.mesh.rotation.y = smoothYaw(an.mesh.rotation.y, Math.atan2(dir.x, dir.z) + kyaw, faceRate);
    } else if (holdFace) {
      const hx = holdFace.x - p.x, hz = holdFace.z - p.z;
      if (hx * hx + hz * hz > 0.0004)
        an.mesh.rotation.y = smoothYaw(an.mesh.rotation.y, Math.atan2(hx, hz) + kyaw, faceRate);
    }
    // Анимация как в animal.gd:_update_anim: walk со speed_scale=speed*6, иначе rest;
    // в окно атаки (0.38с) — клип attack/bite, если есть у модели
    const moving = !!dir;
    const attacking = an.st.attackT > 0;
    if (an.proc) {
      procBearAnim(an, dt, moving, attacking ? Math.min(1, an.st.attackT / 0.38) : -1);
    } else if (attacking && an.attackAG) {
      if (!an.attackAG.isPlaying) {
        an.walkAG?.stop(); an.restAG?.stop();
        an.attackAG.start(false);
      }
      an.st.moving = moving;
    } else {
      if (an.attackAG?.isPlaying) an.attackAG.stop();
      // После атаки вернуть looping-клип ПРИНУДИТЕЛЬНО: во время атаки st.moving
      // уже выставлено в moving, поэтому сравнение ниже не срабатывало и моб
      // оставался замороженным в кадре атаки (walk/rest были остановлены).
      const want = moving ? an.walkAG : an.restAG;
      const other = moving ? an.restAG : an.walkAG;
      if (want) {
        if (other?.isPlaying) other.stop();
        if (!want.isPlaying) want.start(true);
      }
      an.st.moving = moving;
      if (moving && an.walkAG?.isPlaying)
        an.walkAG.speedRatio = Math.min(6, Math.max(0.3, spd * 6));
    }
    // Ноды, которые не драйвит ни один играющий клип — в bind. Клипы покрывают
    // разные наборы (Walk: IK-ноги/спина/хвост/уши; атака: Torso3), и без этого
    // каждая смена клипа морозила середину кадра — ноги оставались согнутыми.
    restoreUndriven(an);
    // земля каждые ~0.25с
    an.st.groundT -= dt;
    if (an.st.groundT <= 0) { an.st.groundT = 0.25; p.y = getHeight(p.x, p.z) + an.info.h / 2; }
    // урон атаки
    if (an.st.attackT > 0) {
      an.st.attackT += dt;
      const t = an.st.attackT / 0.38;
      if (t >= 0.5 && !an.st.attackHit) {
        an.st.attackHit = true;
        const tp = an.st.attackTarget;
        const dd = tp === pp ? distP : Math.hypot(p.x - tp.x, p.z - tp.z);
        if (dd <= 1.9) {
          if (tp === pp) damagePlayer(player, an.info.dmg, hud);
          else { const victim = animals.find(x => x.mesh.position === tp); if (victim) damageAnimal(scene, victim, 1.0); }
        }
      }
      // Выпад ВПЕРЁД строго на цель (а не по rotation.y: в нём сидит KIND_YAW
      // доворот модели и доворот ещё догоняет цель — лису/волка тащило мимо,
      // клип pounce вперёд, тело вбок: ноги гребли по воздуху). Дальше —
      // кламп, чтобы не влететь в цель (медведь проходил сквозь игрока).
      const lunge = Math.sin(Math.min(1, t) * Math.PI) * 0.7 * an.info.h;
      const tgt = an.st.attackTarget;
      const tpx = tgt === pp ? pp.x : tgt.x, tpz = tgt === pp ? pp.z : tgt.z;
      const lyaw = Math.atan2(tpx - p.x, tpz - p.z);
      p.x += Math.sin(lyaw) * lunge * dt * 3;
      p.z += Math.cos(lyaw) * lunge * dt * 3;
      const mind = an.kind === "bear" ? 1.15 : 0.85;
      const ddx = p.x - tpx, ddz = p.z - tpz;
      const dd = Math.hypot(ddx, ddz);
      if (dd < mind && dd > 1e-6) { p.x = tpx + ddx / dd * mind; p.z = tpz + ddz / dd * mind; }
      if (t >= 1) {
        an.st.attackT = 0; an.st.attackHit = false;
        // Сброс эксклюзивных нод — в ветке выше, после stop() клипа.
      }
    }
    void _tmp;
  }
}

export function pickKind() {
  const r = Math.random();
  if (r < 0.30) return "rabbit";
  if (r < 0.58) return "fox";
  if (r < 0.82) return "wolf";
  return "bear";
}

// ---------- Камеры наблюдения: установка на деревья (E), монитор, C/X, M, стрелка ----------
export function createCamManager(scene) {
  return { list: [], active: -1, monitorActive: false, marked: -1, yaw: 0, pitch: 0,
    feedRT: null, feedCam: null, toastT: 0 };
}

export function registerCamera(mgr, scene, mesh) {
  mgr.list.push(mesh);
  mgr.active = mgr.list.length - 1;
  mgr.yaw = 0; mgr.pitch = 0;
}

export function removeCamera(mgr, mesh) {
  const i = mgr.list.indexOf(mesh);
  if (i >= 0) mgr.list.splice(i, 1);
  if (mgr.active >= mgr.list.length) mgr.active = mgr.list.length - 1;
  if (mgr.marked >= mgr.list.length) mgr.marked = -1;
}
