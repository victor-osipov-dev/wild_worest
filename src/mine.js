// Мини-игра «шахта»: после прыжка в яму игрок падает в вагонетку и катится
// по рельсам. Дорогу перекрывают ворота с красными метками: пока метка цела,
// вагонетка тормозит перед воротами. Попадание стрелой открывает ворота.
import * as BABYLON from "@babylonjs/core";
import { arrows } from "./entities.js";

const FLOOR_Y = -60;
const START_Z = 42;
const FINISH_Z = 286;
const TUNNEL_Z0 = 26;
const TUNNEL_Z1 = 302;
const BASE_SPEED = 10;
const ACCEL = 4;
const BRAKE = 10;
const GATE_ZS = [104, 176, 248];

function makeMat(scene, name, diffuse, emissive, specular) {
  const m = new BABYLON.StandardMaterial(name, scene);
  m.diffuseColor = diffuse;
  if (emissive) m.emissiveColor = emissive;
  if (specular) m.specularColor = specular;
  return m;
}

export function createMine({ scene, camera, player, toast, onFinish }) {
  const root = new BABYLON.TransformNode("MineRide", scene);
  root.setEnabled(false);

  // Свет сцены рассчитан на лес: под землёй солнце и небо не должны
  // пробивать породу, иначе тоннель залит ровным жёлтым светом и теряет
  // объём. Гасим их на время поездки и возвращаем при выходе.
  const sunLight = scene.getLightByName("sun");
  const hemiLight = scene.getLightByName("hemi");
  const baseSun = sunLight ? sunLight.intensity : 0;
  const baseHemi = hemiLight ? hemiLight.intensity : 0;

  const rockMat = makeMat(scene, "mineRock",
    new BABYLON.Color3(0.24, 0.19, 0.15), new BABYLON.Color3(0.04, 0.03, 0.024));
  const woodMat = makeMat(scene, "mineWood",
    new BABYLON.Color3(0.3, 0.18, 0.08), new BABYLON.Color3(0.045, 0.027, 0.01));
  const railMat = makeMat(scene, "mineRail",
    new BABYLON.Color3(0.34, 0.35, 0.37), new BABYLON.Color3(0.035, 0.035, 0.04),
    new BABYLON.Color3(0.28, 0.28, 0.3));
  const cartMat = makeMat(scene, "mineCart",
    new BABYLON.Color3(0.38, 0.26, 0.14), new BABYLON.Color3(0.16, 0.1, 0.05),
    new BABYLON.Color3(0.22, 0.18, 0.14));
  const gateMat = makeMat(scene, "mineGate",
    new BABYLON.Color3(0.28, 0.26, 0.25), new BABYLON.Color3(0.04, 0.034, 0.03),
    new BABYLON.Color3(0.3, 0.3, 0.3));
  const glowMat = makeMat(scene, "mineLamp",
    new BABYLON.Color3(0.4, 0.2, 0.05), new BABYLON.Color3(1, 0.55, 0.16));
  const exitMat = makeMat(scene, "mineExit",
    new BABYLON.Color3(0.1, 0.3, 0.12), new BABYLON.Color3(0.18, 0.9, 0.35));

  // ---------- Тоннель ----------
  const len = TUNNEL_Z1 - TUNNEL_Z0;
  const midZ = (TUNNEL_Z0 + TUNNEL_Z1) / 2;
  const floor = BABYLON.MeshBuilder.CreateBox("mineFloor",
    { width: 11.4, height: 0.6, depth: len }, scene);
  floor.position.set(0, FLOOR_Y - 0.3, midZ);
  floor.material = rockMat; floor.parent = root; floor.metadata = { kind: "mine" };

  const roof = BABYLON.MeshBuilder.CreateBox("mineRoof",
    { width: 11.4, height: 0.6, depth: len }, scene);
  roof.position.set(0, FLOOR_Y + 5.9, midZ);
  roof.material = rockMat; roof.parent = root; roof.metadata = { kind: "mine" };

  for (const sx of [-1, 1]) {
    const wall = BABYLON.MeshBuilder.CreateBox("mineWall",
      { width: 0.6, height: 6.6, depth: len }, scene);
    wall.position.set(sx * 5.8, FLOOR_Y + 3, midZ);
    wall.material = rockMat; wall.parent = root; wall.metadata = { kind: "mine" };
  }

  // Крепи и лампы вдоль тоннеля: меньше пустоты и понятно, куда едем.
  for (let z = TUNNEL_Z0 + 8; z < TUNNEL_Z1 - 4; z += 12) {
    const postL = BABYLON.MeshBuilder.CreateBox("minePost",
      { width: 0.32, height: 5.2, depth: 0.36 }, scene);
    postL.position.set(-4.7, FLOOR_Y + 2.6, z);
    postL.material = woodMat; postL.parent = root; postL.isPickable = false;
    const postR = BABYLON.MeshBuilder.CreateBox("minePost",
      { width: 0.32, height: 5.2, depth: 0.36 }, scene);
    postR.position.set(4.7, FLOOR_Y + 2.6, z);
    postR.material = woodMat; postR.parent = root; postR.isPickable = false;
    const beam = BABYLON.MeshBuilder.CreateBox("mineBeam",
      { width: 9.9, height: 0.34, depth: 0.4 }, scene);
    beam.position.set(0, FLOOR_Y + 5.15, z);
    beam.material = woodMat; beam.parent = root; beam.isPickable = false;
  }
  for (let z = TUNNEL_Z0 + 16; z < TUNNEL_Z1 - 8; z += 24) {
    for (const sx of [-1, 1]) {
      const lamp = BABYLON.MeshBuilder.CreateSphere("mineLampMesh",
        { diameter: 0.26, segments: 8 }, scene);
      lamp.position.set(sx * 5.35, FLOOR_Y + 2.9, z);
      lamp.material = glowMat; lamp.parent = root; lamp.isPickable = false;
    }
  }

  // ---------- Рельсы и шпалы ----------
  for (const rx of [-0.72, 0.72]) {
    const rail = BABYLON.MeshBuilder.CreateBox("mineRailMesh",
      { width: 0.13, height: 0.15, depth: len - 10 }, scene);
    rail.position.set(rx, FLOOR_Y + 0.11, midZ);
    rail.material = railMat; rail.parent = root; rail.isPickable = false;
  }
  const sleepers = [];
  for (let z = TUNNEL_Z0 + 8; z < TUNNEL_Z1 - 4; z += 2.2) {
    const sl = BABYLON.MeshBuilder.CreateBox("mineSleeper",
      { width: 2.5, height: 0.1, depth: 0.34 }, scene);
    sl.position.set(0, FLOOR_Y + 0.03, z);
    sl.material = woodMat; sl.isPickable = false;
    sleepers.push(sl);
  }
  const sleeperMesh = BABYLON.Mesh.MergeMeshes(sleepers, true, true);
  if (sleeperMesh) { sleeperMesh.name = "mineSleepers"; sleeperMesh.parent = root; sleeperMesh.isPickable = false; }

  // ---------- Ворота с метками ----------
  const gates = [];
  GATE_ZS.forEach((z, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    const gRoot = new BABYLON.TransformNode("mineGate" + i, scene);
    gRoot.parent = root;
    gRoot.position.set(0, FLOOR_Y, z);

    for (let b = -4; b <= 4; b++) {
      const bar = BABYLON.MeshBuilder.CreateBox("mineGateBar",
        { width: 0.16, height: 5.1, depth: 0.18 }, scene);
      bar.position.set(b, 2.55, 0);
      bar.material = gateMat; bar.parent = gRoot;
      bar.metadata = { kind: "mineGate" };
    }
    for (const by of [1.1, 3.9]) {
      const beam = BABYLON.MeshBuilder.CreateBox("mineGateBeam",
        { width: 8.5, height: 0.2, depth: 0.22 }, scene);
      beam.position.set(0, by, 0);
      beam.material = gateMat; beam.parent = gRoot;
      beam.metadata = { kind: "mineGate" };
    }
    // Неподвижная рама: по ней видно, где именно ворота.
    for (const sx of [-1, 1]) {
      const post = BABYLON.MeshBuilder.CreateBox("mineGatePost",
        { width: 0.5, height: 5.9, depth: 0.5 }, scene);
      post.position.set(sx * 4.55, FLOOR_Y + 2.95, z);
      post.material = woodMat; post.parent = root; post.isPickable = false;
    }
    const lintel = BABYLON.MeshBuilder.CreateBox("mineGateLintel",
      { width: 9.6, height: 0.5, depth: 0.5 }, scene);
    lintel.position.set(0, FLOOR_Y + 5.75, z);
    lintel.material = woodMat; lintel.parent = root; lintel.isPickable = false;

    // Метка висит на неподвижной раме перед воротами: красный кристалл
    // в кольце. Попал — створка уезжает вверх, метка становится зелёной.
    const targetMat = makeMat(scene, "mineTargetMat" + i,
      new BABYLON.Color3(0.55, 0.06, 0.03), new BABYLON.Color3(1, 0.16, 0.05));
    const target = BABYLON.MeshBuilder.CreateSphere("mineTarget" + i,
      { diameter: 0.8, segments: 10 }, scene);
    target.position.set(side * 2.7, FLOOR_Y + 2.9, z - 0.55);
    target.material = targetMat; target.parent = root;
    target.metadata = { kind: "mineTarget", index: i };
    target.isPickable = true;
    const ring = BABYLON.MeshBuilder.CreateTorus("mineTargetRing" + i,
      { diameter: 1.5, thickness: 0.11, tessellation: 20 }, scene);
    ring.position.copyFrom(target.position);
    ring.rotation.x = Math.PI / 2;
    ring.material = targetMat; ring.parent = root;
    ring.metadata = { kind: "mineTarget", index: i };
    ring.isPickable = true;

    // Подсветка у ворот, чтобы их было видно издалека.
    const lamp = BABYLON.MeshBuilder.CreateSphere("mineGateLamp" + i,
      { diameter: 0.3, segments: 8 }, scene);
    lamp.position.set(0, FLOOR_Y + 5.35, z - 0.2);
    lamp.material = glowMat; lamp.parent = root; lamp.isPickable = false;

    // Мягкий отсвет на раме: без него вдали ворота тонут в темноте.
    const gateLight = new BABYLON.PointLight("mineGateLight" + i,
      new BABYLON.Vector3(0, FLOOR_Y + 3.4, z - 2.6), scene);
    gateLight.diffuse = new BABYLON.Color3(1, 0.38, 0.2);
    gateLight.intensity = 0.65;
    gateLight.range = 13;
    gateLight.setEnabled(false);

    gates.push({
      index: i, z, side, gRoot, target, targetMat, light: gateLight,
      targetPos: new BABYLON.Vector3(side * 2.7, FLOOR_Y + 2.9, z - 0.55),
      open: false, openK: 0,
    });
  });

  // Финишная арка: зелёное свечение в конце тоннеля.
  for (const sx of [-1, 1]) {
    const post = BABYLON.MeshBuilder.CreateBox("mineExitPost",
      { width: 0.55, height: 6, depth: 0.55 }, scene);
    post.position.set(sx * 4.6, FLOOR_Y + 3, FINISH_Z);
    post.material = exitMat; post.parent = root; post.isPickable = false;
  }
  const exitTop = BABYLON.MeshBuilder.CreateBox("mineExitTop",
    { width: 9.8, height: 0.5, depth: 0.5 }, scene);
  exitTop.position.set(0, FLOOR_Y + 5.8, FINISH_Z);
  exitTop.material = exitMat; exitTop.parent = root; exitTop.isPickable = false;
  const exitGlow = BABYLON.MeshBuilder.CreatePlane("mineExitGlow",
    { width: 8.6, height: 5.4 }, scene);
  exitGlow.position.set(0, FLOOR_Y + 2.9, FINISH_Z + 0.2);
  const exitGlowMat = new BABYLON.StandardMaterial("mineExitGlowMat", scene);
  exitGlowMat.diffuseColor = new BABYLON.Color3(0.15, 0.4, 0.15);
  exitGlowMat.emissiveColor = new BABYLON.Color3(0.45, 1, 0.5);
  exitGlowMat.alpha = 0.55;
  exitGlowMat.disableDepthWrite = true;
  exitGlow.material = exitGlowMat; exitGlow.parent = root; exitGlow.isPickable = false;

  // ---------- Вагонетка ----------
  const cart = new BABYLON.TransformNode("mineCart", scene);
  cart.parent = root;
  cart.position.set(0, FLOOR_Y + 0.3, START_Z);
  const cartParts = [];
  const addBox = (w, h, d, x, y, z) => {
    const m = BABYLON.MeshBuilder.CreateBox("mineCartPart",
      { width: w, height: h, depth: d }, scene);
    m.position.set(x, y, z); m.material = cartMat; m.parent = cart;
    m.isPickable = false; cartParts.push(m);
    return m;
  };
  addBox(1.7, 0.22, 2.4, 0, 0.16, 0);
  addBox(0.12, 0.8, 2.4, -0.8, 0.55, 0);
  addBox(0.12, 0.8, 2.4, 0.8, 0.55, 0);
  addBox(1.7, 0.62, 0.12, 0, 0.5, -1.14);
  // Передний борт — невысокий: в первом лице он читается тонкой деревянной
  // кромкой снизу и не закрывает рельсы и метки на воротах.
  addBox(1.7, 0.56, 0.12, 0, 0.47, 1.14);
  for (const wx of [-0.88, 0.88]) {
    for (const wz of [-0.72, 0.72]) {
      const wheel = BABYLON.MeshBuilder.CreateCylinder("mineWheel",
        { diameter: 0.48, height: 0.14, tessellation: 12 }, scene);
      wheel.position.set(wx, -0.02, wz);
      wheel.rotation.z = Math.PI / 2;
      wheel.material = railMat; wheel.parent = cart;
      wheel.isPickable = false; cartParts.push(wheel);
    }
  }

  const lamp = new BABYLON.PointLight("mineLamp",
    new BABYLON.Vector3(0, FLOOR_Y + 3, START_Z + 4), scene);
  lamp.diffuse = new BABYLON.Color3(1, 0.7, 0.38);
  lamp.intensity = 3.2;
  lamp.range = 24;
  lamp.setEnabled(false);

  const hudEl = document.getElementById("mineHud");
  const statusEl = document.getElementById("mineStatus");
  const camCountEl = document.getElementById("camCount");
  function showHud(on) {
    if (hudEl) hudEl.style.display = on ? "block" : "none";
    if (camCountEl) camCountEl.style.display = on ? "none" : "block";
  }
  let lastStatus = "";

  const state = {
    active: false, finished: false, z: START_Z, speed: 0,
    gates, bob: 0, hint: "",
  };

  function resetGates() {
    for (const g of gates) {
      g.open = false; g.openK = 0;
      g.gRoot.position.y = FLOOR_Y;
      g.target.setEnabled(true);
      g.targetMat.diffuseColor.set(0.55, 0.06, 0.03);
      g.targetMat.emissiveColor.set(1, 0.16, 0.05);
    }
  }

  function start() {
    state.active = true; state.finished = false;
    state.z = START_Z; state.speed = 0; state.bob = 0; state.hint = "";
    resetGates();
    root.setEnabled(true);
    lamp.setEnabled(true);
    for (const g of gates) g.light.setEnabled(true);
    if (sunLight) sunLight.intensity = 0.12;
    if (hemiLight) hemiLight.intensity = 0.16;
    showHud(true);
    cart.position.set(0, FLOOR_Y + 0.3, START_Z);
    player.mesh.position.set(0, FLOOR_Y + 0.95, START_Z);
    player.st.vel.set(0, 0, 0);
    player.st.grounded = true;
    player.st.yaw = 0;
    player.st.pitch = 0;
    camera.position.set(0, FLOOR_Y + 1.55, START_Z + 0.15);
    camera.rotation.set(0, 0, 0);
    lastStatus = "";
    if (toast) toast("Вагонетка покатилась! Стреляйте по красным меткам на воротах");
  }

  function finish() {
    if (!state.active) return;
    state.active = false; state.finished = true;
    showHud(false);
    lamp.setEnabled(false);
    for (const g of gates) g.light.setEnabled(false);
    if (sunLight) sunLight.intensity = baseSun;
    if (hemiLight) hemiLight.intensity = baseHemi;
    if (onFinish) onFinish();
  }

  function openGate(g) {
    if (g.open) return;
    g.open = true; g.openK = 0;
    g.targetMat.diffuseColor.set(0.1, 0.45, 0.12);
    g.targetMat.emissiveColor.set(0.2, 1, 0.3);
    if (toast) toast("Метка прострелена — ворота открываются");
  }

  function nextClosedGate() {
    let next = null;
    for (const g of gates) {
      if (g.open || g.z < state.z + 0.5) continue;
      if (!next || g.z < next.z) next = g;
    }
    return next;
  }

  function update(dt) {
    if (!state.active) return;

    // Попадание: стрела остановилась у метки на воротах.
    for (const a of arrows) {
      if (!a.stopped) continue;
      for (const g of gates) {
        if (g.open) continue;
        if (a.mesh.position.subtract(g.targetPos).length() < 1.0) openGate(g);
      }
    }
    // Стрелы позади вагонетки больше не нужны — чистим, чтобы не копились.
    for (let i = arrows.length - 1; i >= 0; i--) {
      if (arrows[i].mesh.position.z < state.z - 10) {
        arrows[i].mesh.dispose();
        arrows.splice(i, 1);
      }
    }

    // Анимация открытия ворот: створка уезжает вверх.
    for (const g of gates) {
      if (!g.open || g.openK >= 1) continue;
      g.openK = Math.min(1, g.openK + dt / 1.2);
      const k = g.openK * g.openK * (3 - 2 * g.openK);
      g.gRoot.position.y = FLOOR_Y + 6.1 * k;
    }

    const next = nextClosedGate();
    let desired = BASE_SPEED;
    if (next) {
      const dist = next.z - state.z;
      if (dist < 32) desired = Math.min(desired, Math.max(0, (dist - 4.6) * 0.9));
    }
    const dv = desired - state.speed;
    const rate = dv > 0 ? ACCEL : BRAKE;
    state.speed += Math.max(-rate * dt, Math.min(rate * dt, dv));
    if (state.speed < 0.01) state.speed = 0;
    state.z += state.speed * dt;

    state.bob += dt * (2.2 + state.speed * 0.35);
    const bob = Math.sin(state.bob) * 0.025 + Math.sin(state.bob * 2.7) * 0.012;
    cart.position.set(0, FLOOR_Y + 0.3 + bob, state.z);
    cart.rotation.z = Math.sin(state.bob * 1.3) * 0.012;
    cart.rotation.x = Math.sin(state.bob * 0.9) * 0.008;

    player.mesh.position.set(0, FLOOR_Y + 0.95 + bob, state.z);
    camera.position.set(0, FLOOR_Y + 1.55 + bob, state.z + 0.15);
    camera.rotation.set(player.st.pitch, player.st.yaw, 0);
    lamp.position.set(0, FLOOR_Y + 3.2 + bob, state.z + 4);

    // Подсказка и HUD.
    state.hint = "";
    if (next) {
      const dist = next.z - state.z;
      if (state.speed < 0.3) state.hint = "Ворота закрыты! Прострелите красную метку";
      else if (dist < 42) state.hint = "Впереди ворота — стреляйте по красной метке";
    }
    const opened = gates.filter((g) => g.open).length;
    const status = next
      ? `Ворота ${next.index + 1} из ${gates.length} · ${Math.max(0, Math.round(next.z - state.z))} м`
      : `Ворота ${opened} из ${gates.length} · до выхода ${Math.max(0, Math.round(FINISH_Z - state.z))} м`;
    if (status !== lastStatus) {
      lastStatus = status;
      if (statusEl) statusEl.textContent = status;
    }

    if (state.z >= FINISH_Z) finish();
  }

  return {
    start,
    update,
    get active() { return state.active; },
    get state() { return state; },
    get hint() { return state.hint; },
    light: lamp,
    gates,
    openGate,
  };
}
