// Сущности: игрок, лук/стрелы, мясо, мобы (animal.gd), камеры наблюдения (camera_manager.gd).
import * as BABYLON from "@babylonjs/core";
import { getHeight, PIT_CENTER, HOUSE_POS } from "./noise.js";
import { breakGlass } from "./world.js";
import { MODELS_BASE } from "./assets.js";
import { t } from "./i18n.js";

const _down = new BABYLON.Vector3(0, -1, 0);
const MAX_WALK_SLOPE = 2.0;  // ~63°: круче — уже стена воронки, вверх не пускаем
const SLOPE_SAMPLE = 0.35;   // шаг конечной разности для градиента getHeight

// Дом для зверей — сплошное препятствие с запасом на размер туловища.
// Вместо прохода сквозь стены звери скользят вдоль них и обходят угол.
const HOUSE_B = {
  minX: HOUSE_POS.x - 3.0, maxX: HOUSE_POS.x + 3.0,
  minZ: HOUSE_POS.z - 2.8, maxZ: HOUSE_POS.z + 2.8,
};
const insideHouseBox = (x, z) =>
  x > HOUSE_B.minX && x < HOUSE_B.maxX && z > HOUSE_B.minZ && z < HOUSE_B.maxZ;
function moveAnimalAroundHouse(p, dx, dz) {
  // Если уже внутри — выталкиваем к ближайшей грани.
  if (insideHouseBox(p.x, p.z)) {
    const dl = p.x - HOUSE_B.minX, dr = HOUSE_B.maxX - p.x;
    const db = p.z - HOUSE_B.minZ, df = HOUSE_B.maxZ - p.z;
    const m = Math.min(dl, dr, db, df);
    if (m === dl) p.x = HOUSE_B.minX;
    else if (m === dr) p.x = HOUSE_B.maxX;
    else if (m === db) p.z = HOUSE_B.minZ;
    else p.z = HOUSE_B.maxZ;
  }
  const nx = p.x + dx, nz = p.z + dz;
  if (!insideHouseBox(nx, nz)) { p.x = nx; p.z = nz; return; }
  const inX = p.x > HOUSE_B.minX && p.x < HOUSE_B.maxX;
  const inZ = p.z > HOUSE_B.minZ && p.z < HOUSE_B.maxZ;
  if (inX && !inZ) { p.x = nx; return; } // идем вдоль стены по X
  if (inZ && !inX) { p.z = nz; return; } // идем вдоль стены по Z
  // Угол: блокируем ось, с которой глубже вошли в коробку.
  const penX = Math.min(nx - HOUSE_B.minX, HOUSE_B.maxX - nx);
  const penZ = Math.min(nz - HOUSE_B.minZ, HOUSE_B.maxZ - nz);
  if (penX < penZ) p.z = nz; else p.x = nx;
}

// ---------- Игрок: SPEED 5, JUMP 4.5, мышь 0.002, HP 100 ----------
export function createPlayer(scene, camera) {
  const mesh = BABYLON.MeshBuilder.CreateCapsule("Player", { radius: 0.35, height: 1.15 }, scene);
  mesh.position = new BABYLON.Vector3(0, 1, -14.08);
  const mat = new BABYLON.StandardMaterial("playerMat", scene);
  mat.diffuseColor = new BABYLON.Color3(0.2, 0.4, 0.9);
  mesh.material = mat;
  // Камера от первого лица иногда заглядывает внутрь собственной капсулы —
  // тогда перед глазами появляется синий кружок. Тело не рисуем, коллизии
  // и лучи (isPickable=false) при этом работают как раньше.
  mesh.isVisible = false;
  mesh.checkCollisions = true;
  mesh.ellipsoid = new BABYLON.Vector3(0.35, 0.6, 0.35); // под капсулу: скользим по склонам
  mesh.isPickable = false; // самого себя лучами не ловим
  mesh.metadata = { kind: "player" };
  mesh.layerMask = 0x2; // невидим для фид-камеры (как cull_mask без layer2)
  const st = { vel: new BABYLON.Vector3(0, 0, 0), hp: 100, meat: 0, grounded: false,
    spawn: mesh.position.clone(), yaw: 2.4, pitch: 0, flash: 0,
    burnT: 0, burnTick: 0 }; // горение в костре
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
  // Градиент рельефа нужен и для запрета подъёма, и чтобы не дать встать
  // на слишком крутой склон (стенку воронки).
  // Важно: в воздухе склон не трогает траекторию прыжка — проверки работают
  // только когда игрок стоит на земле.
  let gx = 0, gz = 0, slope2 = 0;
  if (mesh.position.y > -30 && st.grounded) {
    const x = mesh.position.x, z = mesh.position.z;
    gx = (getHeight(x + SLOPE_SAMPLE, z) - getHeight(x - SLOPE_SAMPLE, z)) / (2 * SLOPE_SAMPLE);
    gz = (getHeight(x, z + SLOPE_SAMPLE) - getHeight(x, z - SLOPE_SAMPLE)) / (2 * SLOPE_SAMPLE);
    slope2 = gx * gx + gz * gz;
    if (slope2 > MAX_WALK_SLOPE * MAX_WALK_SLOPE && move.lengthSquared() > 0) {
      const uphill = gx * move.x + gz * move.z;
      if (uphill > 0) {
        const k = uphill / slope2;
        move.x -= gx * k;
        move.z -= gz * k;
      }
    }
  }
  const steep = slope2 > MAX_WALK_SLOPE * MAX_WALK_SLOPE;
  // Виртуальная стенка у дна воронки: чем глубже, тем уже радиус. Не даём
  // подойти к самому крутому склону, где ещё видно обратную сторону меша.
  if (mesh.position.y < -5) {
    const px = mesh.position.x - PIT_CENTER.x, pz = mesh.position.z - PIT_CENTER.z;
    const d = Math.hypot(px, pz);
    const limit = Math.max(2.0, 2.9 - 0.08 * (-mesh.position.y - 5));
    if (d > 1e-4) {
      const nx = px / d, nz = pz / d;
      // Небольшой запас: не дёргаем позицию каждый кадр из-за микро-выхода за радиус.
      if (d > limit + 0.06) {
        mesh.position.x = PIT_CENTER.x + nx * limit;
        mesh.position.z = PIT_CENTER.z + nz * limit;
      }
      if (d > limit - 0.1 && move.lengthSquared() > 0) {
        const outward = move.x * nx + move.z * nz;
        if (outward > 0) { move.x -= nx * outward; move.z -= nz * outward; }
      }
    }
  }
  // Пока решётка цела, яма — непроходимая стена: не даём шагнуть внутрь.
  if (st.pitBlocked && mesh.position.y > -5) {
    const px = mesh.position.x - PIT_CENTER.x, pz = mesh.position.z - PIT_CENTER.z;
    const d = Math.hypot(px, pz);
    if (d > 1e-4 && d < 5.2) {
      const nx = px / d, nz = pz / d;
      if (d < 4.2) {
        mesh.position.x = PIT_CENTER.x + nx * 4.2;
        mesh.position.z = PIT_CENTER.z + nz * 4.2;
      }
      const inward = -(move.x * nx + move.z * nz);
      if (inward > 0) { move.x += nx * inward; move.z += nz * inward; }
    }
  }
  // НОВЫЙ СПОСОБ: земля НЕ участвует в коллизиях. Горизонтальным движением
  // занимается moveWithCollisions (только стены дома и стволы), а высоту мы
  // берём напрямую из getHeight() — той же функции, по которой строится меш.
  // Раньше эллипсоид упирался в крутой склон воронки и застревал на кромке.
  mesh.moveWithCollisions(move);

  if (input.jump && st.grounded && !steep) { st.vel.y = 4.5; st.grounded = false; input.jump = false; }

  if (mesh.position.y > -30) {
    // Над поверхностью: кинематическое следование рельефу, без инерции и скольжения.
    let groundY = getHeight(mesh.position.x, mesh.position.z);
    // Пол дома лежит выше аналитической земли — учитываем его отдельным лучом.
    const houseRay = new BABYLON.Ray(mesh.position, _down, 1.5);
    const houseHit = scene.pickWithRay(houseRay, (m) => m.isPickable !== false && m.isEnabled()
      && m.metadata?.kind === "house");
    if (houseHit?.pickedMesh && houseHit.pickedPoint.y > groundY) groundY = houseHit.pickedPoint.y;
    const targetY = groundY + 0.6;
    if (steep) {
      // Крутой склон: соскальзываем вниз, но НЕ переводим игрока в «полёт».
      // Иначе на каждый кадр состояние дёргалось и казалось, что мы тычемся
      // в углы рельефа. Скорость спуска ограничена — без телепорта на дно.
      const inv = 1 / Math.sqrt(slope2);
      const slide = 2.5 * dt;
      mesh.position.x -= gx * inv * slide;
      mesh.position.z -= gz * inv * slide;
      const gy = getHeight(mesh.position.x, mesh.position.z) + 0.6;
      mesh.position.y = Math.max(gy, mesh.position.y - 4.5 * dt);
      st.vel.y = 0;
      st.grounded = true;
    } else if (!st.grounded) {
      // В ВОЗДУХЕ: полная баллистика и вверх, и вниз. Раньше ветка шла по
      // vel.y > 0 — в апогее (vel.y <= 0) игрока мгновенно приклеивало к земле.
      st.vel.y = Math.max(MAXFALL, st.vel.y - GRAV * dt);
      mesh.position.y += st.vel.y * dt;
      if (mesh.position.y <= targetY) { mesh.position.y = targetY; st.vel.y = 0; st.grounded = true; }
    } else {
      // Ходьба: плавно следуем рельефу. Спуск ограничен 4.5 м/с, поэтому
      // резкий обрыв не дёргает игрока и не включает/выключает состояние полёта.
      mesh.position.y = Math.max(targetY, mesh.position.y - 4.5 * dt);
      st.vel.y = 0;
    }
  } else {
    // Пещера: там свой пол и стены, высота берётся коллизиями как раньше.
    st.vel.y = Math.max(MAXFALL, st.vel.y - GRAV * dt);
    mesh.moveWithCollisions(new BABYLON.Vector3(0, st.vel.y * dt, 0));
    if (mesh.position.y < -59.4) { mesh.position.y = -59.4; st.vel.y = 0; st.grounded = true; }
  }
  // Плавное следование камеры по высоте: при вылезании из глубокой ямы
  // аналитическая высота меняется рывками, а камера теперь сглаживает их.
  const camTargetY = mesh.position.y + 0.45;
  if (st.camY === undefined || Math.abs(camTargetY - st.camY) > 4) st.camY = camTargetY;
  else st.camY += (camTargetY - st.camY) * Math.min(1, dt * 18);
  camera.position.set(mesh.position.x, st.camY, mesh.position.z);
  camera.rotation.set(st.pitch, st.yaw, 0);
  mesh.rotation.y = st.yaw;
}

export function damagePlayer(player, amount, hud, flash = true) {
  player.st.hp = Math.max(0, player.st.hp - amount);
  // Удар зверя: экран краснеет ВСЁ СИЛЬНЕЕ (накопление, затухание — в main.js).
  // Урон зоны передаёт flash=false: там урон идёт каждую секунду и постоянная
  // красная вспышка просто залила бы весь экран.
  if (flash) player.st.flash = Math.min(1, player.st.flash + 0.3);
  if (player.st.hp <= 0) {
    player.mesh.position.copyFrom(player.st.spawn);
    player.st.vel.set(0, 0, 0);
    player.st.hp = 100;
    player.st.flash = 0; // после смерти экран снова чистый
    player.st.burnT = 0; // и горение сбрасываем — иначе респавн сразу загорится
    player.st.burnTick = 0;
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

// Перья: три тонкие заострённые лопасти вокруг хвоста древка. Родитель — древко,
// поэтому они одинаково выглядят на натянутой стреле и в полёте.
function fletchMat(scene, color) {
  const m = new BABYLON.StandardMaterial("fletchMat", scene);
  m.diffuseColor = color;
  m.emissiveColor = color.scale(0.18); // заметные на фоне леса
  m.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
  return m;
}
function addFletching(scene, shaft, mat, forBow) {
  for (let i = 0; i < 3; i++) {
    const f = BABYLON.MeshBuilder.CreateSphere("fletch", { diameter: 1, segments: 6 }, scene);
    f.material = mat;
    f.parent = shaft;
    f.position.set(0, 0, -0.26); // хвост древка (depth 0.68 → конец -0.34)
    f.rotation.z = i * Math.PI * 2 / 3;
    f.scaling.set(0.005, 0.07, 0.10); // тонкая пластинка, вытянутая вдоль стрелы
    f.isPickable = false;
    if (forBow) { f.layerMask = 0x2; f.metadata = { kind: "bow" }; }
  }
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
  // Та же оперка, что и у вылетевшей стрелы — натянутая и летящая стрелы теперь совпадают.
  addFletching(scene, shaft, fletchMat(scene, new BABYLON.Color3(0.85, 0.18, 0.1)), true);
  root.parent = camera;
  root.position.set(0.25, -0.15, 0.4); // впереди камеры (в Godot -0.4, т.к. там вперёд -Z)
  return { root, limbs, strings, grip, tips, nocked, shaft, head, drawing: false, timer: 0 };
}

export function updateBow(bow, dt) {
  if (bow.drawing) bow.timer = Math.min(1.2, bow.timer + dt);
  else bow.timer = Math.max(0, bow.timer - dt * 10);
  // В покое лук не меняется: не пересчитываем 15 сегментов и десятки Vector3
  // каждый кадр. Учитываем и флаг натяжения (мгновенный выстрел при timer=0).
  if (bow.lastTimer !== undefined
    && Math.abs(bow.timer - bow.lastTimer) < 1e-4 && bow.drawing === bow.lastDrawing) return;
  bow.lastTimer = bow.timer;
  bow.lastDrawing = bow.drawing;
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

// ---------- Огонь: общая текстура частицы и короткий взрыв ----------
let fireTex = null;
export function getFireTexture(scene) {
  if (fireTex && fireTex.getScene?.() === scene) return fireTex;
  fireTex = new BABYLON.DynamicTexture("fireParticle", 32, scene, false);
  const ctx = fireTex.getContext();
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,200,90,0.8)");
  g.addColorStop(1, "rgba(255,120,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  fireTex.update();
  fireTex.hasAlpha = true;
  return fireTex;
}

export function burstAt(scene, pos, texture, count = 50) {
  const ps = new BABYLON.ParticleSystem("burst", count, scene);
  ps.particleTexture = texture || getFireTexture(scene);
  ps.emitter = pos.clone();
  ps.minEmitBox = new BABYLON.Vector3(-0.06, 0, -0.06);
  ps.maxEmitBox = new BABYLON.Vector3(0.06, 0.06, 0.06);
  ps.color1 = new BABYLON.Color4(1, 0.85, 0.3, 1);
  ps.color2 = new BABYLON.Color4(1, 0.35, 0.04, 0.9);
  ps.colorDead = new BABYLON.Color4(0.4, 0.1, 0, 0);
  ps.minLifeTime = 0.25; ps.maxLifeTime = 0.65;
  ps.minSize = 0.08; ps.maxSize = 0.24;
  ps.direction1 = new BABYLON.Vector3(-2, 0.5, -2);
  ps.direction2 = new BABYLON.Vector3(2, 3, 2);
  ps.minEmitPower = 1; ps.maxEmitPower = 4;
  ps.gravity = new BABYLON.Vector3(0, -4, 0);
  ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
  ps.manualEmitCount = count; // одна порция, без непрерывной генерации
  ps.start();
  setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 800); }, 200);
}

// Сноп коротких электрических искр: камера «умирает» с разрядом.
export function sparksAt(scene, pos, count = 14) {
  const ps = new BABYLON.ParticleSystem("sparks", count, scene);
  ps.particleTexture = getFireTexture(scene);
  ps.emitter = pos.clone();
  ps.minEmitBox = new BABYLON.Vector3(-0.05, -0.05, -0.05);
  ps.maxEmitBox = new BABYLON.Vector3(0.05, 0.05, 0.05);
  ps.color1 = new BABYLON.Color4(1, 1, 0.85, 1);
  ps.color2 = new BABYLON.Color4(0.35, 0.95, 1, 0.95);
  ps.colorDead = new BABYLON.Color4(0.1, 0.3, 0.45, 0);
  ps.minLifeTime = 0.12; ps.maxLifeTime = 0.42;
  ps.minSize = 0.025; ps.maxSize = 0.075;
  ps.direction1 = new BABYLON.Vector3(-3, -0.5, -3);
  ps.direction2 = new BABYLON.Vector3(3, 3.5, 3);
  ps.minEmitPower = 1.5; ps.maxEmitPower = 5;
  ps.gravity = new BABYLON.Vector3(0, -7, 0);
  ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
  ps.manualEmitCount = count;
  ps.start();
  setTimeout(() => { ps.stop(); setTimeout(() => ps.dispose(), 700); }, 140);
}

// ---------- Стрелы: урон 1, подбор после остановки, прилипание к мобам ----------
export const arrows = [];
export function shootArrow(scene, camera, power) {
  const t = Math.min(1, power / 1.2);
  const speed = 6 + (25 - 6) * t * t;
  const grav = 1.2 * (1 - t);
  // Та же геометрия и материалы, что у стрелы на луке: тонкое древко и металлический
  // наконечник. Заметность дают только перья, а не утолщённый ствол.
  const mesh = BABYLON.MeshBuilder.CreateBox("arrow", { width: 0.018, height: 0.018, depth: 0.68 }, scene);
  mesh.material = bowMat(scene, 0.55, 0.35, 0.15);
  const head = BABYLON.MeshBuilder.CreateBox("arrowHead", { width: 0.034, height: 0.034, depth: 0.1 }, scene);
  const headM = bowMat(scene, 0.3, 0.3, 0.35);
  headM.specularColor = new BABYLON.Color3(0.6, 0.6, 0.6);
  head.material = headM; head.parent = mesh; head.position.z = 0.29; head.isPickable = false;
  addFletching(scene, mesh, fletchMat(scene, new BABYLON.Color3(0.85, 0.18, 0.1)), false);
  const dir = camera.getDirection(new BABYLON.Vector3(0, 0, 1));
  mesh.position = camera.position.add(dir.scale(0.6));
  mesh.lookAt(mesh.position.add(dir));
  mesh.metadata = { kind: "arrow" };
  arrows.push({ mesh, vel: dir.scale(speed), grav, stuck: null, stuckOffset: null,
    stopped: false, age: 0, burning: false, burnT: 0, fire: null,
    ignoreFire: false });
}

// Стрела отлипает от носителя (смерть зверя, разбитое стекло) и падает.
function dropArrow(a, vel) {
  a.stuck = null;
  a.grav = 1.0;
  a.stopped = false;
  a.vel.copyFrom(vel ||
    new BABYLON.Vector3((Math.random() - 0.5) * 1.2, 0.8 + Math.random() * 0.6, (Math.random() - 0.5) * 1.2));
}

function igniteArrow(a, scene, passThrough = false) {
  if (a.burning) return;
  a.burning = true; a.burnT = 0;
  a.stopped = !passThrough;   // из костра — летим дальше, не висим на хитбоксе
  a.ignoreFire = passThrough; // и больше не цепляемся за невидимый блок огня
  if (a.mesh.material?.emissiveColor) a.mesh.material.emissiveColor.set(1, 0.3, 0.02);
  const ps = new BABYLON.ParticleSystem("arrowFire", 28, scene);
  ps.particleTexture = getFireTexture(scene);
  ps.emitter = a.mesh;
  ps.minEmitBox = new BABYLON.Vector3(-0.02, -0.02, -0.02);
  ps.maxEmitBox = new BABYLON.Vector3(0.02, 0.02, 0.02);
  ps.color1 = new BABYLON.Color4(1, 0.9, 0.35, 1);
  ps.color2 = new BABYLON.Color4(1, 0.35, 0.03, 0.9);
  ps.colorDead = new BABYLON.Color4(0.4, 0.08, 0, 0);
  ps.minLifeTime = 0.2; ps.maxLifeTime = 0.45;
  ps.minSize = 0.04; ps.maxSize = 0.12;
  ps.direction1 = new BABYLON.Vector3(-0.1, 0.6, -0.1);
  ps.direction2 = new BABYLON.Vector3(0.1, 1.3, 0.1);
  ps.minEmitPower = 0.1; ps.maxEmitPower = 0.4;
  ps.gravity = new BABYLON.Vector3(0, 1.2, 0);
  ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
  ps.emitRate = 34;
  ps.start();
  a.fire = ps;
}

export function updateArrows(scene, dt, animals, glass, player, onCameraHit, onHouseHit, onSelfHit) {
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i];
    if (a.burning) {
      // Горящая стрела тлеет и полностью сгорает за 1.5 с, НО продолжает
      // лететь — иначе она зависает в воздухе в точке попадания в костёр.
      a.burnT += dt;
      const k = Math.max(0, 1 - a.burnT / 1.5);
      a.mesh.scaling.setAll(Math.max(0.01, k));
      if (a.mesh.material?.emissiveColor) {
        const f = 0.6 + 0.4 * Math.sin(a.burnT * 19);
        a.mesh.material.emissiveColor.set(f, 0.25 * f, 0.02 * f);
      }
      if (a.burnT >= 1.5) {
        a.fire?.stop(); a.fire?.dispose();
        a.mesh.dispose(); arrows.splice(i, 1);
        continue;
      }
      // Ниже — обычная баллистика; хитбокс костра для неё уже отключён.
    }
    if (a.stuck) {
      const host = a.stuck;
      if (host.disposed || host.st.dead) {
        // Как _drop() в оригинале: отлипнуть, вернуть нормальную гравитацию и упасть.
        // Без сброса grav стрела с полной натяжки (grav≈0) улетала в небо навсегда.
        dropArrow(a);
      } else {
        // Смещение и направление — в ЛОКАЛЬНЫХ осях носителя: стрела крутится вместе с ним
        a.mesh.position.copyFrom(BABYLON.Vector3.TransformCoordinates(a.stuckLocalPos, host.mesh.getWorldMatrix()));
        const wd = BABYLON.Vector3.TransformNormal(a.stuckLocalDir, host.mesh.getWorldMatrix());
        a.mesh.lookAt(a.mesh.position.add(wd));
        continue;
      }
    }
    if (a.stopped) {
      if (a.burning) continue; // догорает на месте, подбирать такую нельзя
      // Как PickupArea в arrow.tscn: подбор проходом (лучом в 3см стрелу не попасть)
      if (player && a.mesh.position.subtract(player.mesh.position).length() < 1.2) {
        a.mesh.dispose(); arrows.splice(i, 1);
      }
      continue;
    }

    a.vel.y -= 9.8 * a.grav * dt;
    const dir = a.vel.normalizeToNew();
    const stepLen = a.vel.length() * dt;
    const start = a.mesh.position.clone();
    const ray = new BABYLON.Ray(start, dir, Math.max(0.001, stepLen));
    const hit = scene.pickWithRay(ray, (m) => m.isPickable !== false && m.isEnabled()
      && m.name !== "arrow" && m.name !== "arrowHead" && m.name !== "fletch"
      && m.name !== "shard"
      && m.metadata?.kind !== "player" && m.metadata?.kind !== "bow"
      && !(a.ignoreFire && m.metadata?.kind === "campfire"));

    // Стоп ровно в точке контакта. Раньше стрела сначала делала ПОЛНЫЙ шаг
    // (до 1.25м на полной натяжке), а потом только проверяла попадание —
    // из-за этого она «проскальзывала» и дёргалась к месту падения.
    let travel = stepLen;
    let groundHit = false;
    if (hit?.pickedMesh && hit.distance <= stepLen + 0.001) {
      travel = Math.max(0, Math.min(stepLen, hit.distance - 0.01));
    }
    // Аналитическая земля: чанки могут быть не подгружены, а луч по ним не попал.
    const g0 = getHeight(start.x, start.z);
    const g1 = getHeight(start.x + dir.x * stepLen, start.z + dir.z * stepLen);
    if (start.y > g0 + 0.02) {
      const f0 = start.y - g0;
      const f1 = start.y + dir.y * stepLen - g1;
      if (f1 <= 0 && f0 > 0) {
        const tg = Math.max(0, Math.min(stepLen, f0 / (f0 - f1) * stepLen));
        if (tg < travel) { travel = tg; groundHit = true; }
      }
    }
    const impact = start.add(dir.scale(travel));
    a.mesh.position.copyFrom(impact);
    if (a.vel.lengthSquared() > 0.09) a.mesh.lookAt(impact.add(dir));

    // Стрела, пущенная вверх, падает обратно на игрока — отдельная ачивка.
    // age > 0.5 исключает попадание собственной стрелой в момент выстрела.
    if (player && a.age > 0.5 && a.vel.y < 0
        && a.mesh.position.subtract(player.mesh.position).length() < 0.75) {
      onSelfHit?.(a.mesh.position.clone());
      a.fire?.stop(); a.fire?.dispose();
      a.mesh.dispose(); arrows.splice(i, 1);
      continue;
    }

    if (groundHit) {
      a.mesh.position.y = getHeight(impact.x, impact.z) + 0.04;
      a.stopped = true;
    } else if (hit?.pickedMesh && hit.distance <= stepLen + 0.001) {
      const m = hit.pickedMesh;
      const kind = m.metadata?.kind;
      if (kind === "glass") {
        breakGlass(scene, glass);
        // Разбитое стекло больше не держит стрелу — она падает на землю.
        dropArrow(a, new BABYLON.Vector3((Math.random() - 0.5) * 0.6, -0.2, (Math.random() - 0.5) * 0.6));
        a.age += dt;
        continue;
      }
      if (kind === "campfire") {
        // Загорается от огня, но пролетает сквозь невидимый хитбокс костра,
        // а не зависает в нём. Дальше тлеет 1.5 с и полностью сгорает.
        igniteArrow(a, scene, true);
        a.age += dt;
        continue;
      }
      if (kind === "house") {
        // Только ГОРЯЩАЯ стрела поджигает дом; обычная просто застревает.
        onHouseHit?.(a.burning, a.mesh.position.clone());
        if (a.burning) {
          a.fire?.stop(); a.fire?.dispose();
          a.mesh.dispose(); arrows.splice(i, 1);
        } else a.stopped = true;
        continue;
      }
      // Камера: модель состоит из нескольких мешей, корень ищем вверх по дереву.
      let node = m, camRoot = null;
      while (node && !camRoot) {
        if (node.metadata?.kind === "seccam") camRoot = node.metadata.root;
        node = node.parent;
      }
      if (camRoot) {
        burstAt(scene, a.mesh.position, getFireTexture(scene), 24);
        onCameraHit?.(camRoot, a.mesh.position.clone());
        a.mesh.dispose(); arrows.splice(i, 1);
        continue;
      }
      // Зверь ищется вверх по родителям: луч бьёт в дочерние меши .glb,
      // а хитбокс — их корень
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
        a.stuckLocalDir = BABYLON.Vector3.TransformNormal(dir, inv);
        a.age += dt;
        continue;
      }
      a.stopped = true;
    }
    // Аналитическую землю учитываем только на поверхности: в пещере/шахте
    // (y < -30) getHeight() возвращает рельеф далеко наверху, и без этого
    // условия стрела телепортировалась на поверхность и «застревала» там.
    if (a.mesh.position.y > -30) {
      const g = getHeight(a.mesh.position.x, a.mesh.position.z);
      if (a.mesh.position.y < g) { a.mesh.position.y = g + 0.04; a.stopped = true; }
    }
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

// ---------- Смола аномальных деревьев: подбирается автоматически ----------
export const resins = [];
export function spawnResin(scene, pos) {
  const mesh = BABYLON.MeshBuilder.CreateSphere("resin", { diameter: 0.28, segments: 10 }, scene);
  const mat = new BABYLON.StandardMaterial("resinMat", scene);
  mat.diffuseColor = new BABYLON.Color3(0.55, 0.28, 0.03);
  mat.emissiveColor = new BABYLON.Color3(0.85, 0.42, 0.04);
  mesh.material = mat;
  mesh.position.copyFrom(pos).addInPlace(new BABYLON.Vector3(0, 0.4, 0));
  mesh.metadata = { kind: "resin" };
  mesh.isPickable = false;
  resins.push({ mesh, vel: new BABYLON.Vector3(0, 1.2, 0), age: 0 });
}
export function updateResins(scene, dt, player, toast) {
  for (let i = resins.length - 1; i >= 0; i--) {
    const c = resins[i];
    c.age += dt;
    c.vel.y -= 9.8 * dt;
    c.mesh.position.addInPlace(c.vel.scale(dt));
    const g = getHeight(c.mesh.position.x, c.mesh.position.z) + 0.18;
    if (c.mesh.position.y < g) { c.mesh.position.y = g; c.vel.set(0, 0, 0); }
    c.mesh.rotation.y += dt * 2;
    c.mesh.scaling.setAll(0.95 + 0.1 * Math.sin(c.age * 5));
    if (c.mesh.position.subtract(player.mesh.position).length() < 1.3) {
      player.st.resin = true;
      toast(t("Смола получена — используйте её на решётке ямы"));
      c.mesh.dispose(); resins.splice(i, 1);
    }
  }
}

// ---------- Мобы: rabbit/fox/wolf (h, speed, hp, dmg из animal.gd) ----------
// У лисы и волка 2 жизни: первая стрела застревает в звере, вторая добивает.
export const KINDS = {
  rabbit: { h: 0.45, speed: 1.7, hp: 1, dmg: 0, color: new BABYLON.Color3(0.8, 0.75, 0.7) },
  fox:    { h: 0.55, speed: 1.3, hp: 2, dmg: 8, color: new BABYLON.Color3(0.9, 0.45, 0.15) },
  wolf:   { h: 0.7, speed: 1.1, hp: 2, dmg: 12, color: new BABYLON.Color3(0.4, 0.4, 0.45) },
  // Сюжетная аномалия у ямы: недвижимая мишень, из неё выпадает заражённое ядро.
  anomaly: { h: 0.6, speed: 0, hp: 1, dmg: 0, color: new BABYLON.Color3(0.8, 0.12, 0.12) },
};
export const animals = [];
// Поправка ориентации модели. glTF правосторонний, Babylon левосторонний —
// лоадер зеркалит модели по Z (__root__.scaling.z = -1), поэтому нос из +Z
// файла смотрит в -Z хитбокса. Все звери в файле носом в +Z → доворот PI.
// Без этого они идут задом наперёд.
const KIND_YAW = { rabbit: Math.PI, fox: Math.PI, wolf: Math.PI };

const MODEL_FILES = { rabbit: "rabbit.glb", fox: "fox.glb", wolf: "wolf.glb" };
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
  // Бешенство: пена из пасти лисы и волка. Нос модели смотрит в локальный -Z
  // хитбокса, поэтому пузыри крепим спереди по -Z. Дочерние меши не pickable —
  // стрела по-прежнему попадает в хитбокс, а не в пену.
  if (kind === "fox" || kind === "wolf") {
    const root = new BABYLON.TransformNode("foam_" + kind, scene);
    root.parent = mesh;
    root.position.set(0, info.h * 0.18, -0.52);
    const fm = new BABYLON.StandardMaterial("foamMat_" + kind, scene);
    fm.diffuseColor = new BABYLON.Color3(0.93, 0.96, 1);
    fm.emissiveColor = new BABYLON.Color3(0.3, 0.36, 0.45);
    fm.specularColor = new BABYLON.Color3(0.25, 0.25, 0.25);
    const bubbles = [];
    for (let i = 0; i < 10; i++) {
      const d = info.h * (0.045 + Math.random() * 0.035);
      const b = BABYLON.MeshBuilder.CreateSphere("foamBubble", { diameter: d, segments: 6 }, scene);
      b.material = fm; b.parent = root;
      const x = (Math.random() - 0.5) * 0.13;
      const y = (Math.random() - 0.5) * 0.04;
      const z = (Math.random() - 0.5) * 0.06;
      b.position.set(x, y, z);
      // Каждый пузырь — капля со своей фазой: рождается у пасти, стекает
      // вниз и исчезает, затем цикл повторяется. Так пена «льётся».
      b.metadata = {
        x, y, z,
        phase: Math.random(),
        speed: 0.7 + Math.random() * 0.6,
        driftX: (Math.random() - 0.5) * 0.1,
        driftZ: -0.02 - Math.random() * 0.06,
      };
      b.isPickable = false;
      bubbles.push(b);
    }
    an.foam = { root, bubbles, t: Math.random() * 10 };
  }
  // Аномалия — не зверь, а светящийся сгусток. Хитбокс остаётся невидимым,
  // но pickable: стрела попадает в него как в обычного моба.
  if (kind === "anomaly") {
    mesh.material.alpha = 0;
    const orb = BABYLON.MeshBuilder.CreateSphere("anomalyOrb", { diameter: 0.62, segments: 12 }, scene);
    const om = new BABYLON.StandardMaterial("anomalyMat", scene);
    om.diffuseColor = new BABYLON.Color3(0.35, 0.02, 0.02);
    om.emissiveColor = new BABYLON.Color3(0.7, 0.05, 0.05);
    om.specularColor = new BABYLON.Color3(0.4, 0.1, 0.1);
    orb.material = om; orb.parent = mesh; orb.isPickable = false;
    an.orb = orb;
    animals.push(an);
    return an;
  }
  // Пытаемся заменить бокс на .glb (не критично если нет).
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
      // Ступни — по РЕАЛЬНОМУ минимуму вершин модели (не по bb скелета:
      // у скиновых мешей Babylon отдаёт смещённые границы). getVerticesData
      // возвращает исходные (нескиненные) позиции — минимум стабилен.
      let mnY = Infinity;
      for (const m of glb.getChildMeshes()) {
        const pd = m.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        if (!pd) continue;
        for (let i = 1; i < pd.length; i += 3) if (pd[i] < mnY) mnY = pd[i];
      }
      if (!isFinite(mnY)) mnY = bb.min.y;
      glb.position.y = -mnY * s - info.h / 2;
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
    if (an.kind === "anomaly") {
      // Сгусток стоит на месте и только пульсирует — это сюжетная мишень.
      an.st.spawnAge += dt;
      an.mesh.scaling.setAll(0.92 + 0.06 * Math.sin(an.st.spawnAge * 4));
      if (an.orb) an.orb.rotation.y += dt * 0.7;
      continue;
    }
    an.st.spawnAge += dt;
    // Пена течёт: капля появляется у пасти, стекает вниз и сжимается в ноль.
    if (an.foam) {
      an.foam.t += dt;
      const LIFE = 1.3;
      for (const b of an.foam.bubbles) {
        const m = b.metadata;
        const k = (an.foam.t * m.speed / LIFE + m.phase) % 1;
        b.position.set(
          m.x + m.driftX * k + Math.sin(an.foam.t * 9 + m.phase * 10) * 0.008,
          m.y - 0.26 * k,           // стекаем вниз из пасти
          m.z + m.driftZ * k);      // немного вперёд по ходу морды
        const s = Math.max(0.08, 1 - k * 1.05) * (0.85 + 0.15 * Math.sin(an.foam.t * 12 + m.phase * 8));
        b.scaling.set(s, s, s);
      }
    }
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
      for (const o of animals) {
        if (o.kind !== "rabbit" || o.st.dead) continue;
        const d = Math.hypot(p.x - o.mesh.position.x, p.z - o.mesh.position.z);
        if (d < best) { best = d; target = o.mesh.position; }
      }
      const wantPlayer = an.st.forcedAggro || distP < 16;
      if (!target && wantPlayer) target = pp;
      if (target) {
        const d = Math.hypot(p.x - target.x, p.z - target.z);
        const mult = 2.5;
        // Лиса и волк бьют с 1.1м
        const atkR = 1.1;
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
      moveAnimalAroundHouse(p, dir.x * spd * dt, dir.z * spd * dt);
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
    if (attacking && an.attackAG) {
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
      if (moving && an.walkAG?.isPlaying) {
        // Множитель как в animal.gd: походка модели ~1c на цикл.
        an.walkAG.speedRatio = Math.min(6, Math.max(0.3, spd * 6));
      }
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
      // кламп, чтобы не влететь в цель.
      const lunge = Math.sin(Math.min(1, t) * Math.PI) * 0.7 * an.info.h;
      const tgt = an.st.attackTarget;
      const tpx = tgt === pp ? pp.x : tgt.x, tpz = tgt === pp ? pp.z : tgt.z;
      const lyaw = Math.atan2(tpx - p.x, tpz - p.z);
      moveAnimalAroundHouse(p, Math.sin(lyaw) * lunge * dt * 3, Math.cos(lyaw) * lunge * dt * 3);
      const mind = 0.85;
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
  if (r < 0.35) return "rabbit";
  if (r < 0.67) return "fox";
  return "wolf";
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
