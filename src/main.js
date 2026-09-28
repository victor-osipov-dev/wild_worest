// Точка входа: связывает террейн/дом/игрока/лук/мобов/камеры/яму/HUD.
// Управление: WASD+мышь (pointer lock), Space, ЛКМ — лук, E — дверь/камеры/монитор, Esc — пауза/выход.
import * as BABYLON from "@babylonjs/core";
import "@babylonjs/loaders";
import { initTerrain, updateTerrain, cullTerrainChunks, pushOutOfTrees } from "./terrain.js";
import { buildHouse, updateDoor, buildPit, buildCave, breakGlass,
  buildCampfire, updateCampfire, campfireInteract, COOK_TIME } from "./world.js";
import { createPlayer, updatePlayer, damagePlayer, createBow, updateBow, shootArrow,
  updateArrows, arrows, spawnMeat, updateMeats, spawnAnimal, updateAnimals, animals,
  pickKind, createCamManager, registerCamera, removeCamera, meats, damageAnimal } from "./entities.js";
import { getHeight } from "./noise.js";

const canvas = document.getElementById("renderCanvas");
const engine = new BABYLON.Engine(canvas, true);
if (window.devicePixelRatio > 1.5) engine.setHardwareScalingLevel(window.devicePixelRatio / 1.5);
const scene = new BABYLON.Scene(engine);
scene.collisionsEnabled = true;
// Лёгкий туман как в Godot (fog 0.02): прячет подгрузку дальних чанков и даёт глубину
scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
scene.fogDensity = 0.008;
scene.fogColor = new BABYLON.Color3(0.16, 0.18, 0.24);
// Фон = цвет тумана: то, что за пределами подгрузки (в т.ч. по краям конуса
// взгляда фида), читается как дымка, а не как синева пустоты.
scene.clearColor = new BABYLON.Color4(0.16, 0.18, 0.24, 1);
scene.gravity = new BABYLON.Vector3(0, -9.8, 0);

const camera = new BABYLON.UniversalCamera("FPS", new BABYLON.Vector3(0, 1.5, -14), scene);
// Без attachControl: камера полностью ручная (как в эталоне), лишние слушатели не мешают.
// Ввод: mousemove ниже + pointerdown для захвата.
camera.fov = 75 * Math.PI / 180;
camera.minZ = 0.05;

const terrain = initTerrain(scene);
const { door, glass, screen, screenMat } = buildHouse(scene);
const pit = buildPit(scene);
const cave = buildCave(scene);
const campfire = buildCampfire(scene);
const player = createPlayer(scene, camera);
const bow = createBow(scene, camera);
const mgr = createCamManager(scene);

// RT-монитор: отдельная камера + текстура на экране
const feedRT = new BABYLON.RenderTargetTexture("feedRT", { width: 480, height: 270 }, scene);
feedRT.refreshRate = 3; // фид не каждый кадр — экономим память/батарею
const feedCam = new BABYLON.UniversalCamera("FeedCam", new BABYLON.Vector3(0, 24, 0), scene);
feedCam.setTarget(BABYLON.Vector3.Zero());
feedCam.fov = 110 * Math.PI / 180;
feedCam.minZ = 0.05; // камера почти на земле: minZ=1 срезал низ кадра до clearColor
feedCam.layerMask = 0x0FFFFFFF & ~0x2; // без слоя игрока (как cull_mask без layer2)
feedRT.activeCamera = feedCam;
feedRT.renderList = null; // рендерит всю сцену
scene.customRenderTargets.push(feedRT);
// Экран стартует ЧЁРНЫМ: текстуру фида вешаем только когда есть камеры
// (setScreenOn в цикле — mgr.list[mgr.active] существует).
mgr.feedRT = feedRT; mgr.feedCam = feedCam;

const input = { f: false, b: false, l: false, r: false, jump: false };
const keys = {};
let paused = false, started = false, inCave = false;
let wildT = 5, forestT = 2, fadeT = -1, falling = false;

const $ = (id) => document.getElementById(id);
let debugOn = false, debugT = 0;
window.addEventListener("error", (e) => {
  const b = $("errbox");
  if (!b) return;
  b.style.display = "block";
  b.textContent = "ERR: " + (e.message || e.error);
});
function hud() {
  $("stats").innerHTML = `Здоровье: ${Math.ceil(player.st.hp)}<br>Мясо: ${player.st.meat}`;
  $("camCount").textContent = `Камеры: ${mgr.list.length} / 5`;
}
hud();
function toast(msg) {
  $("toast").textContent = msg;
  $("toast").style.display = "block";
  mgr.toastT = 2;
}

// ---------- ввод ----------
addEventListener("keydown", (e) => {
  keys[e.code] = true;
  if (e.code === "KeyW" || e.code === "ArrowUp") input.f = true;
  if (e.code === "KeyS" || e.code === "ArrowDown") input.b = true;
  if (e.code === "KeyA" || e.code === "ArrowLeft") input.l = true;
  if (e.code === "KeyD" || e.code === "ArrowRight") input.r = true;
  if (e.code === "Space" && !e.repeat) input.jump = true;
  if (e.code === "F3" && !e.repeat) {
    e.preventDefault();
    debugOn = !debugOn;
    $("debug").style.display = debugOn ? "block" : "none";
  }
  if (e.code === "F4" && !e.repeat) {
    e.preventDefault();
    // Атлас показываем ПРЯМО в игре: не зависит от блокировок скачивания data:-URL.
    let box = $("atlasbox");
    if (!box) {
      box = document.createElement("div");
      box.id = "atlasbox";
      box.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:60;"
        + "background:rgba(0,0,0,.75);padding:6px;border:1px solid #4a4;"
        + "font:12px monospace;color:#dfd;display:none";
      document.body.appendChild(box);
    }
    if (box.style.display === "block") { box.style.display = "none"; return; }
    box.innerHTML = "";
    for (const [url, w] of [[terrain.treeAtlasURL, 512], [terrain.bushAtlasURL, 256]]) {
      if (!url) continue;
      const im = document.createElement("img");
      im.src = url;
      im.style.cssText = `display:block;width:${w / 2}px;image-rendering:pixelated;margin-bottom:4px`;
      box.appendChild(im);
    }
    if (!terrain.treeAtlasURL) {
      const d = document.createElement("div");
      d.textContent = "bake fallback: " + (terrain.bakeError || "?");
      d.style.color = "#f88";
      box.appendChild(d);
    }
    box.style.display = "block";
  }
  if (!started || paused) return;
  if (e.code === "KeyE") onInteract();
  if (mgr.monitorActive) {
    if (e.code === "KeyC") stepCam(1);
    if (e.code === "KeyX") stepCam(-1);
    if (e.code === "KeyM") toggleMark();
  }
  if (e.code === "Escape") {
    if (mgr.monitorActive) exitMonitor();
    else togglePause(true);
  }
});
addEventListener("keyup", (e) => {
  keys[e.code] = false;
  if (e.code === "KeyW" || e.code === "ArrowUp") input.f = false;
  if (e.code === "KeyS" || e.code === "ArrowDown") input.b = false;
  if (e.code === "KeyA" || e.code === "ArrowLeft") input.l = false;
  if (e.code === "KeyD" || e.code === "ArrowRight") input.r = false;
  if (e.code === "Space") input.jump = false;
});
document.addEventListener("mousemove", (e) => {
  if (!started || paused || document.pointerLockElement !== canvas) return;
  // В режиме монитора мышь глотается (как в camera_manager._input) —
  // головой не вертим, камерой наблюдения — только стрелками/WASD.
  if (mgr.monitorActive) return;
  player.st.yaw += e.movementX * 0.002;
  player.st.pitch = clamp(player.st.pitch + e.movementY * 0.002, -Math.PI / 2, Math.PI / 2);
});
canvas.addEventListener("pointerdown", (e) => {
  if (!started || paused || e.button !== 0) return;
  // Захват — здесь (клик по канвасу) или по подсказке ниже; один запрос на клик
  if (document.pointerLockElement !== canvas) { lockPointer(); return; }
  if (mgr.monitorActive) return;
  // костёр (ЛКМ 4.5м): жарка/еда — в приоритете над луком
  if (scene.pickWithRay(camera.getForwardRay(4.5), (m) => m.metadata?.kind === "campfire")?.pickedMesh) {
    campfireInteract(campfire, player, hud, toast);
    return;
  }
  // подбор стрелы взглядом (луч 8м, mask 4)
  const ray = camera.getForwardRay(8);
  const hit = scene.pickWithRay(ray, (m) => m.name === "arrow");
  if (hit?.pickedMesh) {
    const i = arrows.findIndex(a => a.mesh === hit.pickedMesh && a.stopped);
    if (i >= 0) { arrows[i].mesh.dispose(); arrows.splice(i, 1); return; }
  }
  bow.drawing = true; bow.timer = 0;
});
// Клик по подсказке тоже захватывает (у неё pointer-events:auto, до канваса не доходит)
$("lockHint").addEventListener("pointerdown", (e) => { e.stopPropagation(); lockPointer(); });
addEventListener("mouseup", (e) => {
  if (e.button !== 0 || !bow.drawing) return;
  bow.drawing = false;
  if (bow.timer >= 0.15 && !mgr.monitorActive) shootArrow(scene, camera, bow.timer);
});
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// Захват как в эталоне: один запрос из жеста, без лишних guards
function lockPointer() {
  try {
    const r = canvas.requestPointerLock();
    if (r && typeof r.catch === "function") r.catch(() => updateLockHint());
  } catch { updateLockHint(); }
}
function updateLockHint() {
  const lost = started && !paused && !mgr.monitorActive && document.pointerLockElement !== canvas;
  $("lockHint").style.display = lost ? "block" : "none";
}
document.addEventListener("pointerlockchange", updateLockHint);
document.addEventListener("pointerlockerror", updateLockHint);
function stepCam(d) {
  for (let i = mgr.list.length - 1; i >= 0; i--)
    if (mgr.list[i].isDisposed()) { mgr.list.splice(i, 1); if (mgr.marked >= mgr.list.length) mgr.marked = -1; }
  if (!mgr.list.length) { mgr.active = -1; return; }
  mgr.active = (((mgr.active + d) % mgr.list.length) + mgr.list.length) % mgr.list.length;
  mgr.yaw = 0; mgr.pitch = 0;
}
function toggleMark() {
  mgr.marked = mgr.marked === mgr.active ? -1 : mgr.active;
  const t = $("toast");
  t.textContent = mgr.marked >= 0 ? "Метка поставлена" : "Метка снята";
  t.style.display = "block";
  mgr.toastT = 2;
}

// ---------- E: дверь / камеры / монитор ----------
function rayFromCam(dist, pred) {
  return scene.pickWithRay(camera.getForwardRay(dist), pred);
}
function onInteract() {
  if (mgr.monitorActive) return;
  // Как в Godot (_input менеджера раньше _unhandled_input игрока): монитор в приоритете.
  // 1) монитор (5м, LOOK_RANGE) — только если есть камеры
  for (let i = mgr.list.length - 1; i >= 0; i--)
    if (mgr.list[i].isDisposed()) mgr.list.splice(i, 1);
  if (mgr.list.length && rayFromCam(5, (m) => m.metadata?.kind === "monitor").pickedMesh) {
    enterMonitor(); return;
  }
  // 2) снять камеру взглядом (8м)
  const hitCam = rayFromCam(8, (m) => m.metadata?.kind === "seccam");
  if (hitCam?.pickedMesh) {
    const root = hitCam.pickedMesh.metadata.root;
    removeCamera(mgr, root);
    root.dispose(); hud();
    return;
  }
  // 3) дверь (4м)
  if (door.near) { door.open = !door.open; return; }
  // 4) поставить камеру на ствол (луч 5м, боковая нормаль)
  const hit = rayFromCam(5, (m) => m.metadata?.kind === "tree" || m.metadata?.kind === "terrain");
  if (hit?.pickedMesh && mgr.list.length < 5) {
    const m = hit.pickedMesh;
    if (m.metadata?.kind === "tree" && Math.abs(hit.getNormal(true).y) < 0.6) {
      placeCamera(hit);
    }
  }
}
function placeCamera(hit) {
  const id = Date.now() % 100000;
  const root = new BABYLON.TransformNode(`SecurityCam_${id}`, scene);
  const n = hit.getNormal(true);
  root.position = hit.pickedPoint.add(n.scale(0.03));
  // Камера смотрит ОТ ствола: линза и взгляд монитора идут по локальной -Z
  // модели, поэтому базис z = -горизонтальной нормали ствола (а не вслед за
  // взглядом игрока — тот смотрел в ствол). Нормаль у боковой грани цилиндра
  // почти горизонтальна (постановка требует |ny| < 0.6).
  const z = new BABYLON.Vector3(-n.x, 0, -n.z).normalize();
  root.rotation.y = Math.atan2(z.x, z.z);
  const bodyMat = new BABYLON.StandardMaterial("camBody", scene);
  bodyMat.diffuseColor = new BABYLON.Color3(0.15, 0.15, 0.17);
  const body = BABYLON.MeshBuilder.CreateBox("cambody", { width: 0.08, height: 0.05, depth: 0.12 }, scene);
  body.parent = root; body.material = bodyMat; body.layerMask = 0x2;
  body.metadata = { kind: "seccam", root };
  body.isPickable = true;
  const lens = BABYLON.MeshBuilder.CreateCylinder("camlens", { diameter: 0.03, height: 0.02 }, scene);
  lens.parent = root; lens.position.z = -0.07; lens.rotation.x = Math.PI / 2; lens.layerMask = 0x2;
  lens.metadata = { kind: "seccam", root };
  const led = BABYLON.MeshBuilder.CreateSphere("camled", { diameter: 0.015 }, scene);
  led.parent = root; led.position.set(0.03, 0.03, 0); led.layerMask = 0x2;
  const ledMat = new BABYLON.StandardMaterial("ledMat", scene);
  ledMat.emissiveColor = new BABYLON.Color3(1, 0, 0);
  led.material = ledMat;
  registerCamera(mgr, scene, root);
  hud();
}
function enterMonitor() {
  if (mgr.monitorActive || !mgr.list.length) return;
  mgr.monitorActive = true;
  mgr.yaw = 0; mgr.pitch = 0;
  document.exitPointerLock?.();
  $("camLabel").style.display = "block";
  $("monitorHelp").style.display = "block";
  updateLockHint();
}
function exitMonitor() {
  mgr.monitorActive = false;
  mgr.yaw = 0; mgr.pitch = 0;
  $("camLabel").style.display = "none";
  $("monitorHelp").style.display = "none";
  lockPointer();
  updateLockHint();
}
function setScreenOn() {
  if (mgr.screenOnFlag) return;
  mgr.screenOnFlag = true;
  screenMat.emissiveTexture = feedRT;
  screenMat.diffuseTexture = feedRT;
  screenMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
  screenMat.diffuseColor = new BABYLON.Color3(0.15, 0.15, 0.15);
}
function setScreenStandby() {
  if (!mgr.screenOnFlag) return;
  mgr.screenOnFlag = false;
  screenMat.emissiveTexture = null;
  screenMat.diffuseTexture = null;
  screenMat.emissiveColor = new BABYLON.Color3(0, 0, 0);
  screenMat.diffuseColor = new BABYLON.Color3(0.05, 0.05, 0.05);
}

// ---------- пауза / старт ----------
function togglePause(on) {
  paused = on;
  $("pause").style.display = on ? "flex" : "none";
  if (on) {
    document.exitPointerLock?.();
  }
  else lockPointer();
  updateLockHint();
}
$("btnContinue").onclick = () => togglePause(false);
$("btnRestart").onclick = () => {
  inCave = false; falling = false; fadeT = -1;
  player.mesh.position.copyFrom(player.st.spawn);
  player.st.hp = 100; hud();
  togglePause(false);
};
$("btnStart").onclick = () => {
  started = true;
  $("start").style.display = "none";
  lockPointer();
};
$("pause").style.display = "none";

// ---------- стартовые мобы леса (как forest_wildlife: сразу несколько) ----------
for (let i = 0; i < 4; i++) {
  const a = 2 + i * 1.5, r = 20 + i * 4;
  const x = Math.cos(a) * r, z = Math.sin(a) * r - 10;
  spawnAnimal(scene, ["rabbit", "fox", "wolf", "bear"][i % 4], new BABYLON.Vector3(x, getHeight(x, z) + 0.5, z));
}

// ---------- цикл ----------
let last = performance.now();
engine.runRenderLoop(() => {
  const now = performance.now();
  // raw — реальное время кадра, dt — кламп для физики. Таймеры (жарка мяса)
  // идут по raw: на низком fps физика может тормозить, а секунды — нет.
  const raw = (now - last) / 1000;
  const dt = Math.min(0.05, raw);
  last = now;
  if (!started || paused) { scene.render(); return; }

  // Монитор как в camera_manager._process: поворот стрелками/WASD 2.0 рад/с,
  // фид-камера = активная * yaw * pitch каждый кадр, экран гаснет без камер.
  // Горизонталь как у мыши игрока: A/← влево (yaw -), D/→ вправо (yaw +).
  if (mgr.monitorActive) {
    const rot = 2.0 * dt;
    let yaw = 0, pitch = 0;
    if (input.l) yaw -= rot;
    if (input.r) yaw += rot;
    if (input.f) pitch += rot;
    if (input.b) pitch -= rot;
    mgr.yaw = clamp(mgr.yaw + yaw, -75 * Math.PI / 180, 75 * Math.PI / 180);
    mgr.pitch = clamp(mgr.pitch + pitch, -85 * Math.PI / 180, 85 * Math.PI / 180);
  }
  const activeCam = mgr.list[mgr.active];
  let feedDir = null;
  if (activeCam && !activeCam.isDisposed()) {
    setScreenOn();
    const yawQ = BABYLON.Quaternion.RotationYawPitchRoll(activeCam.rotation.y + mgr.yaw, mgr.pitch, 0);
    feedDir = new BABYLON.Vector3(0, 0, -1).applyRotationQuaternion(yawQ);
    feedCam.position.copyFrom(activeCam.position);
    feedCam.setTarget(activeCam.position.add(feedDir));
    if (mgr.monitorActive) $("camLabel").textContent = `Камера ${mgr.active + 1} из ${mgr.list.length}`;
  } else {
    if (mgr.active !== -1) { mgr.active = -1; mgr.yaw = 0; mgr.pitch = 0; }
    if (mgr.marked !== -1 && !mgr.list[mgr.marked]) mgr.marked = -1;
    setScreenStandby();
  }
  // Земля грузится вокруг игрока, вокруг активной камеры монитора и конусом
  // вдоль её взгляда: без второго центра в кадре фида дыры, а дальше кольца
  // ±80м по направлению камеры — пустота (виден clearColor сцены).
  updateTerrain(terrain, player.mesh.position.x, player.mesh.position.z,
    feedDir ? feedCam.position.x : null, feedDir ? feedCam.position.z : null,
    feedDir ? feedDir.x : null, feedDir ? feedDir.z : null);
  cullTerrainChunks(terrain, camera.position, camera.getDirection(new BABYLON.Vector3(0, 0, 1)),
    Math.floor(player.mesh.position.x / 32), Math.floor(player.mesh.position.z / 32),
    feedDir ? feedCam.position : null, feedDir);
  if (debugOn) {
    debugT -= dt;
    if (debugT <= 0) {
      debugT = 0.5;
      let vis = 0, tot = 0;
      for (const [, ch] of terrain.chunks) { tot++; if (ch.visible) vis++; }
      $("debug").textContent =
        `fps ${engine.getFps().toFixed(0)} | pos ${player.mesh.position.x.toFixed(1)},${player.mesh.position.y.toFixed(1)},${player.mesh.position.z.toFixed(1)} | chunks ${vis}/${tot} | animals ${animals.length} | arrows ${arrows.length} | grounded ${player.st.grounded} | bake ${terrain.treeAtlasURL ? "RT-OK" : "FALLBACK " + (terrain.bakeError || "")}`;
    }
  }
  updatePlayer(scene, player, camera, input, dt, mgr.monitorActive);
  pushOutOfTrees(terrain, player.mesh.position);
  updateDoor(door, player.mesh.position, dt);
  // _update_looking каждый кадр (луч 5м до монитора) + хинты как в _update_hud
  const lookingAtMonitor = !mgr.monitorActive &&
    !!rayFromCam(5, (m) => m.metadata?.kind === "monitor").pickedMesh;
  const lookingAtCampfire = !!rayFromCam(4.5, (m) => m.metadata?.kind === "campfire").pickedMesh;
  if (mgr.monitorActive) $("hint").textContent = "";
  else if (lookingAtMonitor && mgr.list.length) $("hint").textContent = "E — посмотреть камеры";
  else if (lookingAtCampfire) {
    $("hint").textContent = campfire.phase === "cooking"
      ? `Мясо жарится… ${Math.max(0, Math.ceil(COOK_TIME - campfire.t))}с`
      : campfire.phase === "ready"
        ? "ЛКМ — съесть жареное мясо"
        : player.st.meat > 0 ? "ЛКМ — пожарить мясо" : "Костёр: нет сырого мяса";
  }
  else if (door.near) $("hint").textContent = "E — открыть/закрыть дверь";
  else $("hint").textContent = "";
  updateBow(bow, dt);
  updateArrows(scene, dt, animals, glass, player);
  updateMeats(scene, dt, player, hud);
  updateAnimals(scene, dt, player, hud);
  updateCampfire(campfire, raw);
  if (campfire.readyFlash) { campfire.readyFlash = false; toast("Жареное мясо готово — тыкни по костру"); }

  // спавн wildlife для монитора: только в режиме монитора, 4-9с, шанс 45%, 3-7м в конусе
  if (mgr.monitorActive && mgr.list[mgr.active]) {
    wildT -= dt;
    if (wildT <= 0) {
      wildT = 4 + Math.random() * 5;
      const alive = animals.length;
      if (alive < 8 && Math.random() < 0.45) {
        const cam = mgr.list[mgr.active];
        const fwd = new BABYLON.Vector3(Math.sin(cam.rotation.y + Math.PI), 0, Math.cos(cam.rotation.y + Math.PI));
        for (let k = 0; k < 8; k++) {
          const ang = (Math.random() - 0.5) * 2 * 0.7;
          const r = 3 + Math.random() * 4;
          const ca = Math.cos(ang), sa = Math.sin(ang);
          const x = cam.position.x + (fwd.x * ca - fwd.z * sa) * r;
          const z = cam.position.z + (fwd.x * sa + fwd.z * ca) * r;
          if (Math.hypot(x + 8, z + 5) < 5) continue;
          spawnAnimal(scene, pickKind(), new BABYLON.Vector3(x, getHeight(x, z) + 0.5, z));
          break;
        }
      }
    }
  }
  // спавн леса: 20-40с, шанс 30%, кольцо 15-40м, деспавн 60м
  forestT -= dt;
  if (forestT <= 0) {
    forestT = 20 + Math.random() * 20;
    if (animals.length < 8 && Math.random() < 0.3) {
      for (let k = 0; k < 20; k++) {
        const a = Math.random() * Math.PI * 2, r = 15 + Math.random() * 25;
        const x = player.mesh.position.x + Math.cos(a) * r;
        const z = player.mesh.position.z + Math.sin(a) * r;
        if (Math.hypot(x + 8, z + 5) < 12) continue;
        spawnAnimal(scene, pickKind(), new BABYLON.Vector3(x, getHeight(x, z) + 0.5, z));
        break;
      }
    }
  }
  // деспавн далеко
  for (let i = animals.length - 1; i >= 0; i--) {
    const an = animals[i];
    if (!an.st.dead && an.mesh.position.subtract(player.mesh.position).length() > 60) {
      an.mesh.dispose(); an.disposed = true; animals.splice(i, 1);
    }
  }

  if (mgr.toastT > 0) { mgr.toastT -= dt; if (mgr.toastT <= 0) $("toast").style.display = "none"; }
  // стрелка на метку
  const nav = $("navArrow");
  if (mgr.marked >= 0 && mgr.list[mgr.marked] && !mgr.monitorActive) {
    const mp = mgr.list[mgr.marked].position;
    const v = BABYLON.Vector3.Project(mp, BABYLON.Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()));
    if (v.z < 1 && v.x > 60 && v.x < innerWidth - 60 && v.y > 60 && v.y < innerHeight - 60) {
      nav.style.display = "block"; nav.style.left = (v.x - 24) + "px"; nav.style.top = (v.y - 60) + "px";
      nav.style.transform = "rotate(0deg)";
    } else {
      nav.style.display = "block";
      const dx = v.x - innerWidth / 2, dy = v.y - innerHeight / 2;
      nav.style.left = "calc(50% - 24px)";
      nav.style.top = "120px";
      nav.style.transform = `rotate(${Math.atan2(dx, -dy)}rad)`;
    }
  } else nav.style.display = "none";

  // яма: падение в триггер -> fade 0.9с -> пещера; в пещере выход назад
  if (!inCave) {
    const d = Math.hypot(player.mesh.position.x - pit.trigger.x, player.mesh.position.z - pit.trigger.z);
    const dy = Math.abs(player.mesh.position.y - pit.trigger.y);
    if (!falling && d < pit.triggerR && dy < pit.triggerH / 2) { falling = true; fadeT = 0; }
  } else {
    if (player.mesh.position.subtract(cave.exitPos).length() < 1.8) {
      inCave = false; falling = false;
      player.mesh.position.set(2, getHeight(2, 2) + 0.6, 2);
    }
  }
  if (fadeT >= 0) {
    fadeT += dt / 0.9;
    $("fade").style.opacity = Math.min(1, fadeT);
    if (fadeT >= 1) {
      fadeT = -1; falling = false;
      inCave = true;
      player.mesh.position.copyFrom(cave.spawnPos);
      player.st.vel.set(0, 0, 0);
      setTimeout(() => $("fade").style.opacity = 0, 300);
    }
  }

  // Удары зверей: накопленная красная вспышка постепенно гаснет.
  // Гасим по реальному времени (raw), иначе на низком fps красный экран висит.
  if (player.st.flash > 0) player.st.flash = Math.max(0, player.st.flash - 0.16 * raw);
  $("dmgFlash").style.opacity = player.st.flash.toFixed(3);

  scene.render();
});
addEventListener("resize", () => engine.resize());

// Доступ для автотестов Playwright — только с ?test=1, в обычной игре не создаётся.
if (new URLSearchParams(location.search).has("test")) {
  window.__game = { scene, camera, player, hud, campfire, campfireInteract,
    damagePlayer, damageAnimal, getHeight, terrain, animals, meats, BABYLON };
}
