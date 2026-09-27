// Дом, дверь, стекло, монитор, яма (pit_visual), пещера — порт соответствующих .tscn/.gd.
import * as BABYLON from "@babylonjs/core";
import { getHeight, HOUSE_POS, PIT_CENTER } from "./noise.js";
import { asset } from "./assets.js";

export const HOUSE = { x: HOUSE_POS.x, z: HOUSE_POS.z };

export function buildHouse(scene) {
  const root = new BABYLON.TransformNode("House", scene);
  root.position = new BABYLON.Vector3(HOUSE.x, 0, HOUSE.z);
  const woodTex = new BABYLON.Texture(asset("assets/textures/wood_planks_diff.jpg"), scene);
  woodTex.uScale = 3; woodTex.vScale = 3;
  const woodMat = new BABYLON.StandardMaterial("woodMat", scene);
  woodMat.diffuseTexture = woodTex;
  woodMat.specularColor = new BABYLON.Color3(0, 0, 0); // дерево матовое — без бликов
  const floor = BABYLON.MeshBuilder.CreateBox("floor", { width: 5.2, height: 0.2, depth: 4.8 }, scene);
  floor.position.y = -0.1; floor.material = woodMat; floor.parent = root;
  floor.checkCollisions = true; floor.isPickable = true; floor.metadata = { kind: "house" };

  const wallMat = woodMat;
  const mkWall = (w, h, d, x, y, z) => {
    const m = BABYLON.MeshBuilder.CreateBox("wall", { width: w, height: h, depth: d }, scene);
    m.position.set(x, y, z); m.material = wallMat; m.parent = root;
    m.checkCollisions = true; m.isPickable = true; m.metadata = { kind: "house" };
    return m;
  };
  // Как в main.tscn: пол, задняя/правая стены целиком; спереди — проём двери
  // x -0.45..0.45 (FrontLeft/FrontRight/FrontTop), слева — проём окна (пилястры).
  mkWall(5.2, 0.16, 4.8, 0, 0.08, 0); // Floor, верх на 0.16
  mkWall(4.952, 2.2, 0.16, -0.002, 1.1, 2.2); // BackWall
  mkWall(0.16, 2.2, 4.4, 2.4, 1.1, 0); // RightWall
  mkWall(0.16, 1.5, 4.4, -2.4, 0.75, 0); // LeftLower (под окном)
  mkWall(0.16, 0.15, 4.4, -2.4, 2.125, 0); // LeftUpper (над окном)
  mkWall(0.16, 0.55, 1.7, -2.4, 1.775, -1.35); // LeftPillarF
  mkWall(0.16, 0.55, 1.7, -2.4, 1.775, 1.35); // LeftPillarB
  mkWall(2.0248, 2.0, 0.16, -1.4624, 1.0, -2.2); // FrontLeft
  mkWall(1.9896, 2.0, 0.16, 1.4448, 1.0, -2.2); // FrontRight
  mkWall(4.8, 0.2, 0.16, 0, 2.1, -2.2); // FrontTop (над дверью)
  // Рама окна
  mkWall(0.1, 0.1, 1.14, -2.48, 2.11, 0); // WinTop
  mkWall(0.1, 0.1, 1.14, -2.48, 1.44, 0); // WinSill
  mkWall(0.1, 0.78, 0.1, -2.48, 1.775, -0.58); // WinLeft
  mkWall(0.1, 0.78, 0.1, -2.48, 1.775, 0.58); // WinRight
  // Двускатная крыша (панели 5.2x3.06, наклон ~38°)
  const roofMat = new BABYLON.StandardMaterial("roofMat", scene);
  roofMat.diffuseColor = new BABYLON.Color3(0.55, 0.25, 0.15);
  roofMat.specularColor = new BABYLON.Color3(0, 0, 0); // без бликов от лампы
  const roofBack = BABYLON.MeshBuilder.CreateBox("roofBack", { width: 5.6, height: 0.12, depth: 3.06 }, scene);
  roofBack.position.set(0, 3.125, 1.25); roofBack.rotation.x = 0.661;
  roofBack.material = roofMat; roofBack.parent = root;
  const roofFront = BABYLON.MeshBuilder.CreateBox("roofFront", { width: 5.6, height: 0.12, depth: 3.06 }, scene);
  roofFront.position.set(0, 3.125, -1.25); roofFront.rotation.x = -0.661;
  roofFront.material = roofMat; roofFront.parent = root;
  const ridge = BABYLON.MeshBuilder.CreateBox("ridge", { width: 5.6, height: 0.22, depth: 0.22 }, scene);
  ridge.position.set(0, 4.0, 0); ridge.material = roofMat; ridge.parent = root;
  // Торцы-фронтоны как GableLeft/Right: треугольник z ±2.4, основание y 2.2, конёк y 4.0.
  // Без ExtrudePolygon (ему нужен внешний earcut): призма вручную из треугольников,
  // материал двусторонний — порядок обхода не критичен.
  const gableMat = wallMat.clone("gableMat");
  gableMat.backFaceCulling = false;
  const mkGable = (xCenter) => {
    const t = 0.08;
    const A0 = [xCenter - t, 2.2, -2.4], B0 = [xCenter - t, 2.2, 2.4], C0 = [xCenter - t, 4.0, 0];
    const A1 = [xCenter + t, 2.2, -2.4], B1 = [xCenter + t, 2.2, 2.4], C1 = [xCenter + t, 4.0, 0];
    const pos = [
      ...A0, ...B0, ...C0,
      ...A1, ...C1, ...B1,
      ...A0, ...A1, ...B1, ...A0, ...B1, ...B0,
      ...B0, ...B1, ...C1, ...B0, ...C1, ...C0,
      ...C0, ...C1, ...A1, ...C0, ...A1, ...A0,
    ];
    const uv = [];
    for (let i = 0; i < pos.length; i += 3) uv.push(pos[i + 2] / 5, pos[i + 1] / 4);
    const normals = [];
    // индексы — по номерам ВЕРШИН (pos.length/3), не по байтам позиций
    const idx = [];
    for (let v = 0; v < pos.length / 3; v += 3) idx.push(v, v + 1, v + 2);
    BABYLON.VertexData.ComputeNormals(pos, idx, normals);
    const vd = new BABYLON.VertexData();
    vd.positions = pos; vd.indices = idx; vd.uvs = uv; vd.normals = normals;
    const m = new BABYLON.Mesh(`gable${xCenter}`, scene);
    vd.applyToMesh(m);
    m.material = gableMat; m.parent = root;
    m.checkCollisions = true; m.isPickable = true; m.metadata = { kind: "house" };
  };
  mkGable(2.4); mkGable(-2.4);

  // --- Дверь: DoorPivot в (0.45,0.975,-2.17) отн. дома, открывается на -100°, E в радиусе 4м ---
  const pivot = new BABYLON.TransformNode("DoorPivot", scene);
  pivot.position = new BABYLON.Vector3(HOUSE.x + 0.45, 0.975, HOUSE.z - 2.17);
  const doorMesh = BABYLON.MeshBuilder.CreateBox("door", { width: 0.9, height: 1.95, depth: 0.06 }, scene);
  doorMesh.position.x = -0.45; doorMesh.parent = pivot;
  const doorMat = new BABYLON.StandardMaterial("doorMat", scene);
  doorMat.diffuseColor = new BABYLON.Color3(0.4, 0.25, 0.12);
  doorMat.specularColor = new BABYLON.Color3(0, 0, 0);
  doorMesh.material = doorMat; doorMesh.checkCollisions = true;
  const knob = BABYLON.MeshBuilder.CreateSphere("knob", { diameter: 0.09 }, scene);
  knob.position.set(-0.75, 0, 0.08); knob.parent = doorMesh;
  const door = { pivot, open: false, target: 0, OPEN: -100 * Math.PI / 180, SPEED: 2.2,
    hintPos: new BABYLON.Vector3(HOUSE.x + 0.45, 2.4, HOUSE.z - 2.17) };
  doorMesh.metadata = { kind: "door" };

  // --- Окно + стекло (WinGlassBody): разбивается стрелой, 16 осколков ---
  const glassMesh = BABYLON.MeshBuilder.CreateBox("WinGlass", { width: 0.02, height: 0.55, depth: 1.0 }, scene);
  glassMesh.position = new BABYLON.Vector3(HOUSE.x - 2.31, 1.775, HOUSE.z);
  const glassMat = new BABYLON.StandardMaterial("glassMat", scene);
  glassMat.diffuseColor = new BABYLON.Color3(0.7, 0.85, 1.0);
  glassMat.alpha = 0.25;
  glassMesh.material = glassMat;
  glassMesh.metadata = { kind: "glass" };
  const glass = { mesh: glassMesh, broken: false };

  // --- Стол/кровать/монитор: экран 0.92x0.5175, монитор-свет ---
  const table = BABYLON.MeshBuilder.CreateBox("table", { width: 1.4, height: 0.08, depth: 0.7 }, scene);
  table.position = new BABYLON.Vector3(HOUSE.x - 1.2, 0.75, HOUSE.z - 1.2);
  table.material = woodMat; table.checkCollisions = true;
  const screen = BABYLON.MeshBuilder.CreatePlane("Screen", { width: 0.92, height: 0.5175 }, scene);
  screen.position = new BABYLON.Vector3(HOUSE.x - 1.2, 1.25, HOUSE.z - 1.2);
  screen.rotation.y = Math.PI / 2;
  const screenMat = new BABYLON.StandardMaterial("screenMat", scene);
  screenMat.diffuseColor = new BABYLON.Color3(0.02, 0.03, 0.05);
  screenMat.emissiveColor = new BABYLON.Color3(0.02, 0.03, 0.05);
  screen.material = screenMat;
  screen.metadata = { kind: "monitor" };
  screen.layerMask = 0x2; // не рендерится в собственный фид (без рекурсии)
  const bed = BABYLON.MeshBuilder.CreateBox("bed", { width: 2.0, height: 0.4, depth: 1.0 }, scene);
  bed.position = new BABYLON.Vector3(HOUSE.x + 1.2, 0.2, HOUSE.z + 1.4);
  bed.material = wallMat; bed.checkCollisions = true;
  const lamp = new BABYLON.PointLight("InteriorLight", new BABYLON.Vector3(HOUSE.x, 2.0, HOUSE.z), scene);
  lamp.diffuse = new BABYLON.Color3(1, 0.85, 0.6); lamp.intensity = 2.5; lamp.range = 7;
  lamp.specular = new BABYLON.Color3(0, 0, 0); // чисто диффузный свет в доме — бликов нет

  // Свет/небо
  const sun = new BABYLON.DirectionalLight("sun", new BABYLON.Vector3(-0.5, -1, 0.3), scene);
  sun.intensity = 1.2;
  const hemi = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);
  hemi.intensity = 0.55;

  return { root, door, glass, screen, screenMat };
}

export function updateDoor(door, playerPos, dt) {
  const d2 = door.pivot.position.subtract(playerPos).lengthSquared();
  door.near = d2 < 16; // CLOSE_SQR=16
  const target = door.open ? door.OPEN : 0;
  const cur = door.pivot.rotation.y;
  const step = door.SPEED * dt;
  door.pivot.rotation.y = Math.abs(target - cur) < step ? target : cur + Math.sign(target - cur) * step;
}

export function breakGlass(scene, glass) {
  if (glass.broken) return;
  glass.broken = true;
  glass.mesh.setEnabled(false);
  const shardMat = new BABYLON.StandardMaterial("shardMat", scene);
  shardMat.diffuseColor = new BABYLON.Color3(0.75, 0.88, 1.0);
  shardMat.alpha = 0.6;
  for (let i = 0; i < 16; i++) {
    const s = BABYLON.MeshBuilder.CreateBox(`shard`, {
      width: 0.04 + Math.random() * 0.1, height: 0.004 + Math.random() * 0.01, depth: 0.04 + Math.random() * 0.1
    }, scene);
    s.material = shardMat;
    s.position = glass.mesh.position.clone().add(new BABYLON.Vector3(
      (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.44, (Math.random() - 0.5) * 0.24));
    const vel = new BABYLON.Vector3(-1.5 + Math.random() * 3, 0.5 + Math.random() * 2, -0.5 + Math.random());
    const life = 2 + Math.random() * 2;
    let age = 0;
    const obs = scene.onBeforeRenderObservable.add(() => {
      const dt = scene.getEngine().getDeltaTime() / 1000;
      age += dt;
      vel.y -= 9.8 * 1.3 * dt * 0.3;
      s.position.addInPlace(vel.scale(dt));
      s.rotation.x += dt * 4; s.rotation.z += dt * 3;
      if (age > life) { scene.onBeforeRenderObservable.remove(obs); s.dispose(); }
    });
  }
}

// --- Костёр рядом с домом: постоянно горит с дымом, ЛКМ — жарка мяса и еда ---
export const COOK_TIME = 8; // секунд жарки одного куска
const RAW_COLOR = new BABYLON.Color3(0.6, 0.22, 0.18);
const FRIED_COLOR = new BABYLON.Color3(0.5, 0.3, 0.14);

// Мягкий круглый спрайт для частиц (огонь/дым) — без внешних ассетов.
function blobTexture(scene, name) {
  const dt = new BABYLON.DynamicTexture(name, 64, scene, true);
  const ctx = dt.getContext();
  ctx.clearRect(0, 0, 64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.45, "rgba(255,255,255,0.6)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  dt.update();
  dt.hasAlpha = true;
  dt.wrapU = dt.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
  return dt;
}

export function buildCampfire(scene) {
  const x = HOUSE.x + 2.6, z = HOUSE.z - 4.4; // перед домом, справа от двери
  const y = getHeight(x, z);
  const root = new BABYLON.TransformNode("Campfire", scene);
  root.position.set(x, y, z);
  const cf = { root, pos: new BABYLON.Vector3(x, y, z), phase: "idle", t: 0, time: 0,
    readyFlash: false, meat: null, flame: null, light: null };
  const pickable = (m) => { m.isPickable = true; m.metadata = { kind: "campfire" }; };

  // Каменное кольцо
  const stoneMat = new BABYLON.StandardMaterial("cfStoneMat", scene);
  stoneMat.diffuseColor = new BABYLON.Color3(0.4, 0.38, 0.36);
  stoneMat.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);
  let seed = 91;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) | 0, ((seed >>> 0) % 1000) / 1000);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rnd() * 0.35;
    const s = 0.14 + rnd() * 0.08;
    const st = BABYLON.MeshBuilder.CreateSphere(`cfStone${i}`, { diameter: 1, segments: 6 }, scene);
    st.scaling.set(s * 1.4, s, s * 1.4);
    st.position.set(Math.cos(a) * 0.52, s * 0.35, Math.sin(a) * 0.52);
    st.rotation.y = rnd() * 3;
    st.material = stoneMat; st.parent = root;
    pickable(st);
  }
  // Брёвна крест-накрест
  const logMat = new BABYLON.StandardMaterial("cfLogMat", scene);
  logMat.diffuseColor = new BABYLON.Color3(0.3, 0.18, 0.09);
  logMat.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);
  for (let i = 0; i < 3; i++) {
    const log = BABYLON.MeshBuilder.CreateCylinder(`cfLog${i}`,
      { height: 0.8, diameter: 0.12, tessellation: 7 }, scene);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = i * Math.PI / 3 + 0.35;
    log.position.y = 0.1 + (i % 2) * 0.05;
    log.material = logMat; log.parent = root;
    pickable(log);
  }
  // Рогатки + шампур: мясо висит прямо над огнём (шампур вдоль Z — виден с тропы)
  for (const sz of [-0.38, 0.38]) {
    const stick = BABYLON.MeshBuilder.CreateCylinder("cfStick",
      { height: 0.64, diameter: 0.05, tessellation: 6 }, scene);
    stick.position.set(0, 0.32, sz);
    stick.rotation.x = sz > 0 ? -0.12 : 0.12;
    stick.material = logMat; stick.parent = root;
    pickable(stick);
  }
  const skewer = BABYLON.MeshBuilder.CreateCylinder("cfSkewer",
    { height: 0.9, diameter: 0.035, tessellation: 6 }, scene);
  skewer.rotation.x = Math.PI / 2;
  skewer.position.y = 0.62;
  skewer.material = logMat; skewer.parent = root;
  pickable(skewer);

  // Кусок мяса на шампуре: виден во время жарки, коричневеет когда готово
  const meat = BABYLON.MeshBuilder.CreateBox("cfMeat", { width: 0.2, height: 0.14, depth: 0.2 }, scene);
  const meatMat = new BABYLON.StandardMaterial("cfMeatMat", scene);
  meatMat.diffuseColor = RAW_COLOR.clone();
  meatMat.specularColor = new BABYLON.Color3(0.1, 0.05, 0.05);
  meat.material = meatMat; meat.parent = root;
  meat.position.y = 0.6;
  meat.isPickable = false;
  meat.setEnabled(false);
  cf.meat = meat;

  // Пламя: конус-биллборд со свечением, живёт отдельно от частиц
  const flame = BABYLON.MeshBuilder.CreateCylinder("cfFlame",
    { diameterTop: 0, diameterBottom: 0.3, height: 0.52, tessellation: 10 }, scene);
  const flameMat = new BABYLON.StandardMaterial("cfFlameMat", scene);
  flameMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
  flameMat.emissiveColor = new BABYLON.Color3(1, 0.4, 0.05);
  flameMat.alpha = 0.8;
  flameMat.backFaceCulling = false;
  flame.material = flameMat;
  flame.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;
  flame.position.y = 0.34;
  flame.isPickable = false;
  cf.flame = flame;

  // Прозрачный хитбокс, чтобы тыкать костёр было легко (кирпичи/брёвна тоже pickable)
  const hit = BABYLON.MeshBuilder.CreateBox("cfHit", { width: 1.35, height: 1.25, depth: 1.35 }, scene);
  const hitMat = new BABYLON.StandardMaterial("cfHitMat", scene);
  hitMat.alpha = 0; // не виден, но участвует в raycast (isVisible=false ломает pick)
  hitMat.disableDepthWrite = true;
  hit.material = hitMat;
  hit.position.y = 0.58;
  hit.parent = root;
  pickable(hit);

  // Огонь
  const blob = blobTexture(scene, "cfParticleTex");
  const fire = new BABYLON.ParticleSystem("cfFire", 160, scene);
  fire.particleTexture = blob;
  fire.emitter = new BABYLON.Vector3(x, y + 0.16, z);
  fire.minEmitBox = new BABYLON.Vector3(-0.2, 0, -0.2);
  fire.maxEmitBox = new BABYLON.Vector3(0.2, 0.06, 0.2);
  fire.color1 = new BABYLON.Color4(0.95, 0.45, 0.06, 0.8);
  fire.color2 = new BABYLON.Color4(0.9, 0.6, 0.15, 0.6);
  fire.colorDead = new BABYLON.Color4(1, 0.25, 0.03, 0);
  fire.minLifeTime = 0.3; fire.maxLifeTime = 0.65;
  fire.addSizeGradient(0, 0.1, 0.16);
  fire.addSizeGradient(1, 0.02, 0.05);
  fire.emitRate = 16;
  fire.direction1 = new BABYLON.Vector3(-0.1, 1, -0.1);
  fire.direction2 = new BABYLON.Vector3(0.1, 1.7, 0.1);
  fire.minEmitPower = 0.35; fire.maxEmitPower = 0.8;
  fire.gravity = new BABYLON.Vector3(0, 0.8, 0);
  // ВАЖНО: у ParticleSystem по умолчанию BLENDMODE_ONEONE (аддитив) — белое пересветление.
  // Огонь и дым рисуем обычным альфа-блендингом, свет даёт PointLight + свечение конуса.
  fire.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
  fire.start();

  // Дым: серый, медленно поднимается и раздувается
  const smoke = new BABYLON.ParticleSystem("cfSmoke", 120, scene);
  smoke.particleTexture = blob;
  smoke.emitter = new BABYLON.Vector3(x, y + 0.72, z);
  smoke.minEmitBox = new BABYLON.Vector3(-0.1, 0, -0.1);
  smoke.maxEmitBox = new BABYLON.Vector3(0.1, 0.05, 0.1);
  smoke.color1 = new BABYLON.Color4(0.55, 0.54, 0.52, 0.7);
  smoke.color2 = new BABYLON.Color4(0.38, 0.38, 0.37, 0.5);
  smoke.colorDead = new BABYLON.Color4(0.3, 0.3, 0.3, 0);
  smoke.minLifeTime = 2; smoke.maxLifeTime = 3;
  smoke.addSizeGradient(0, 0.1, 0.18);
  smoke.addSizeGradient(1, 0.4, 0.62);
  smoke.emitRate = 5;
  smoke.direction1 = new BABYLON.Vector3(-0.12, 1, -0.12);
  smoke.direction2 = new BABYLON.Vector3(0.3, 1.4, 0.3);
  smoke.minEmitPower = 0.35; smoke.maxEmitPower = 0.7;
  smoke.gravity = new BABYLON.Vector3(0, 0.25, 0);
  smoke.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD; // не ONEONE (см. выше)
  smoke.start();

  // Свет костра
  const light = new BABYLON.PointLight("cfLight", new BABYLON.Vector3(x, y + 0.7, z), scene);
  light.diffuse = new BABYLON.Color3(1, 0.6, 0.25);
  light.intensity = 1.15;
  light.range = 6;
  cf.light = light;
  return cf;
}

export function updateCampfire(cf, dt) {
  cf.time += dt;
  const fl = 0.86 + 0.1 * Math.sin(cf.time * 11.3) + 0.06 * Math.sin(cf.time * 23.7 + 1.3);
  cf.light.intensity = 1.15 * fl;
  const fs = 0.9 + 0.1 * Math.sin(cf.time * 13.1) + 0.05 * Math.sin(cf.time * 7.7);
  cf.flame.scaling.set(fs, 0.92 + 0.14 * Math.sin(cf.time * 9.4 + 2), fs);
  if (cf.phase === "cooking") {
    cf.t += dt;
    if (cf.t >= COOK_TIME) {
      cf.t = COOK_TIME;
      cf.phase = "ready";
      cf.readyFlash = true;
      cf.meat.material.diffuseColor = FRIED_COLOR;
    }
  }
}

// ЛКМ по костру: сырое мясо -> жарка -> готово -> съесть (здоровье полностью)
export function campfireInteract(cf, player, hud, toast) {
  if (cf.phase === "cooking") {
    toast(`Мясо жарится… ${Math.max(0, Math.ceil(COOK_TIME - cf.t))}с`);
    return;
  }
  if (cf.phase === "ready") {
    if (player.st.hp >= 100) { toast("Здоровье и так полное"); return; }
    cf.phase = "idle"; cf.t = 0; cf.meat.setEnabled(false);
    player.st.hp = 100;
    hud();
    toast("Жареное мясо съедено — здоровье восстановлено");
    return;
  }
  if (player.st.meat <= 0) { toast("Нет сырого мяса — охоться на кролика"); return; }
  player.st.meat--;
  hud();
  cf.phase = "cooking"; cf.t = 0;
  cf.meat.setEnabled(true);
  cf.meat.material.diffuseColor = RAW_COLOR.clone();
  toast("Мясо заряжено на жарку");
}

// --- Яма: торы-кольца, шипы, свечение, частицы (порт pit_visual.gd) ---
export function buildPit(scene) {
  const root = new BABYLON.TransformNode("Pit", scene);
  root.position = new BABYLON.Vector3(PIT_CENTER.x, 0, PIT_CENTER.z);
  const rockTex = new BABYLON.Texture(asset("assets/textures/rock_diff.jpg"), scene);
  const rockMat = new BABYLON.StandardMaterial("rockMat", scene);
  rockMat.diffuseTexture = rockTex;
  rockMat.diffuseColor = new BABYLON.Color3(0.17, 0.17, 0.16);
  rockMat.specularColor = new BABYLON.Color3(0, 0, 0);

  // Кольца-торы убраны: воронка уже есть в самом рельефе (getHeight),
  // а торы торчали чёрными арками над землёй.
  // шипы на дне
  let seed = 1337;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) | 0, ((seed >>> 0) / 4294967295));
  for (let i = 0; i < 8; i++) {
    const ang = rnd() * Math.PI * 2, rad = 0.2 + rnd() * 1.5, h = 1.2 + rnd() * 1.4;
    const spike = BABYLON.MeshBuilder.CreateCylinder(`spike${i}`,
      { height: h, diameterTop: 0.06, diameterBottom: 0.24 + rnd() * 0.36 }, scene);
    spike.position = new BABYLON.Vector3(PIT_CENTER.x + Math.cos(ang) * rad, -13.4 + h * 0.5, PIT_CENTER.z + Math.sin(ang) * rad);
    spike.material = rockMat;
  }
  const glow = new BABYLON.PointLight("PitGlow", new BABYLON.Vector3(PIT_CENTER.x, -11, PIT_CENTER.z), scene);
  glow.diffuse = new BABYLON.Color3(0.55, 0.12, 0.7); glow.intensity = 8; glow.range = 7;
  const glow2 = new BABYLON.PointLight("PitGlowDeep", new BABYLON.Vector3(PIT_CENTER.x, -13.2, PIT_CENTER.z), scene);
  glow2.diffuse = new BABYLON.Color3(0.75, 0.15, 0.12); glow2.intensity = 5; glow2.range = 4.5;

  // Восходящие миазмы: 30 частиц, жизнь 4с, скорость 0..1.6 вверх
  const ps = new BABYLON.ParticleSystem("motes", 30, scene);
  ps.emitter = new BABYLON.Vector3(PIT_CENTER.x, 0.4, PIT_CENTER.z);
  ps.minEmitBox = new BABYLON.Vector3(-1, 0, -1);
  ps.maxEmitBox = new BABYLON.Vector3(1, 0, 1);
  ps.color1 = new BABYLON.Color4(0.7, 0.3, 1.0, 0.85);
  ps.color2 = new BABYLON.Color4(0.6, 0.2, 0.9, 0.4);
  ps.minSize = 0.06; ps.maxSize = 0.2;
  ps.minLifeTime = 3; ps.maxLifeTime = 4;
  ps.emitRate = 8;
  ps.direction1 = new BABYLON.Vector3(-0.25, 1.6, -0.25);
  ps.direction2 = new BABYLON.Vector3(0.25, 0.4, 0.25);
  ps.minEmitPower = 0.2; ps.maxEmitPower = 1.0;
  ps.gravity = BABYLON.Vector3.Zero();
  ps.start();

  // Триггер-цилиндр (KillTrigger r2.8 h8 на y-6)
  const trigger = new BABYLON.Vector3(PIT_CENTER.x, -6, PIT_CENTER.z);
  return { root, trigger, triggerR: 2.8, triggerH: 8 };
}

// --- Пещера 20x8x20 в стороне (y=-60), выход назад ---
export function buildCave(scene) {
  const CY = -60;
  const root = new BABYLON.TransformNode("Cave", scene);
  const mk = (w, h, d, x, y, z) => {
    const m = BABYLON.MeshBuilder.CreateBox("cavewall", { width: w, height: h, depth: d }, scene);
    m.position.set(x, CY + y, z); m.parent = root;
    m.checkCollisions = true;
    const mt = new BABYLON.StandardMaterial("caveMat", scene);
    mt.diffuseColor = new BABYLON.Color3(0.12, 0.1, 0.12);
    m.material = mt;
    return m;
  };
  mk(20, 0.5, 20, 0, -0.25, 0);
  mk(20, 0.5, 20, 0, 8, 0);
  mk(20, 8, 0.5, 0, 4, -10); mk(20, 8, 0.5, 0, 4, 10);
  mk(0.5, 8, 20, -10, 4, 0); mk(0.5, 8, 20, 10, 4, 0);
  const torch = new BABYLON.PointLight("Torch", new BABYLON.Vector3(0, CY + 4, 0), scene);
  torch.diffuse = new BABYLON.Color3(1, 0.6, 0.3); torch.intensity = 25; torch.range = 15;
  const exitPos = new BABYLON.Vector3(0, CY + 1.5, -9.5);
  const marker = BABYLON.MeshBuilder.CreateBox("exitMark", { width: 1.8, height: 2.8, depth: 0.3 }, scene);
  marker.position = exitPos;
  const mm = new BABYLON.StandardMaterial("exitMat", scene);
  mm.emissiveColor = new BABYLON.Color3(0.1, 0.9, 0.3);
  marker.material = mm;
  return { exitPos, spawnPos: new BABYLON.Vector3(0, CY + 1.2, 7), CY };
}
