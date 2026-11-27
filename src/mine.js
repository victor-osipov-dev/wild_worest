// Мини-игра «шахта»: после прыжка в яму игрок падает в вагонетку и катится
// по рельсам. Ворота держит реальный механизм: чека лебёдки с противовесом,
// навесной замок на цепи или бочка пороха под рамой. Попадание стрелой
// освобождает механизм, противовес поднимает створку — вагонетка едет дальше.
// По пути: пыль из-под колёс, падающие камни, летучие мыши, битые рельсы,
// светящиеся кристаллы и три пасхалки, которые можно прострелить.
import * as BABYLON from "@babylonjs/core";
import { arrows, getFireTexture, burstAt, sparksAt } from "./entities.js";
import { t, onLangChange } from "./i18n.js";

const FLOOR_Y = -60;
const START_Z = 42;
const FINISH_Z = 286;
const TUNNEL_Z0 = 26;
const TUNNEL_Z1 = 302;
const BASE_SPEED = 10;
const ACCEL = 4;
const BRAKE = 10;
const GATE_ZS = [104, 176, 248];
const GATE_VARIANTS = ["pin", "lock", "keg"];
const SECRETS_TOTAL = 3;
// Участки с разбитыми шпалами: вагонетку трясёт, из-под колёс летят искры.
const BUMPS = [{ z: 84, len: 9 }, { z: 212, len: 11 }];

function makeMat(scene, name, diffuse, emissive, specular) {
  const m = new BABYLON.StandardMaterial(name, scene);
  m.diffuseColor = diffuse;
  if (emissive) m.emissiveColor = emissive;
  if (specular) m.specularColor = specular;
  return m;
}

// ---------- Процедурные текстуры (без внешних файлов) ----------
function dynTex(scene, name, size, draw, mip = true) {
  const tex = new BABYLON.DynamicTexture(name, { width: size, height: size }, scene, mip);
  draw(tex.getContext(), size);
  tex.update();
  tex.wrapU = tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
  // На длинных стенах без анизотропии текстура смазывается в полосы.
  tex.anisotropicFilteringLevel = 8;
  return tex;
}

function texMat(scene, name, tex, u, v, spec = 0.06, emissive = 0.03) {
  tex.uScale = u; tex.vScale = v;
  const m = new BABYLON.StandardMaterial(name, scene);
  m.diffuseTexture = tex;
  m.specularColor = new BABYLON.Color3(spec, spec, spec);
  m.emissiveColor = new BABYLON.Color3(emissive, emissive * 0.85, emissive * 0.7);
  return m;
}

// Скала: крупные пятна, мелкая крошка и трещины. Без горизонтальных полос,
// иначе стена на длинном тоннеле читается как деревянный щит. Пятна и
// трещины дублируются со сдвигом на тайл, чтобы швы между повторами
// текстуры не были видны на стенах.
function drawRock(g, s) {
  g.fillStyle = "#4a443c"; g.fillRect(0, 0, s, s);
  const blob = (x, y, r, dark) => {
    const col = dark
      ? `rgba(26,22,18,${0.08 + Math.random() * 0.16})`
      : `rgba(150,136,112,${0.05 + Math.random() * 0.12})`;
    for (let ox = -s; ox <= s; ox += s) {
      for (let oy = -s; oy <= s; oy += s) {
        const px = x + ox, py = y + oy;
        if (px < -r || px > s + r || py < -r || py > s + r) continue;
        const gr = g.createRadialGradient(px, py, 0, px, py, r);
        gr.addColorStop(0, col);
        gr.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = gr;
        g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
      }
    }
  };
  // Крупные неровности тона — слои породы.
  for (let i = 0; i < 70; i++) {
    blob(Math.random() * s, Math.random() * s,
      s * (0.05 + Math.random() * 0.22), Math.random() < 0.55);
  }
  // Крошка и мелкие включения. Точки у краёв дублируются на противоположной
  // стороне, чтобы не было шва на стыке повторов текстуры.
  for (let i = 0; i < 3000; i++) {
    const x = Math.random() * s, y = Math.random() * s;
    const r = 0.6 + Math.random() * 2.4;
    g.fillStyle = Math.random() < 0.55
      ? `rgba(20,17,14,${0.12 + Math.random() * 0.26})`
      : `rgba(174,158,132,${0.07 + Math.random() * 0.16})`;
    const xs = [x], ys = [y];
    if (x < r) xs.push(x + s);
    if (x > s - r) xs.push(x - s);
    if (y < r) ys.push(y + s);
    if (y > s - r) ys.push(y - s);
    for (const px of xs) for (const py of ys) {
      g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
    }
  }
  // Трещины — короткие ломаные, без выраженного направления.
  const crack = (pts, color, width) => {
    for (let ox = -s; ox <= s; ox += s) {
      for (let oy = -s; oy <= s; oy += s) {
        g.strokeStyle = color; g.lineWidth = width;
        g.beginPath();
        g.moveTo(pts[0].x + ox, pts[0].y + oy);
        for (let k = 1; k < pts.length; k++) g.lineTo(pts[k].x + ox, pts[k].y + oy);
        g.stroke();
      }
    }
  };
  for (let i = 0; i < 18; i++) {
    const pts = [];
    let x = Math.random() * s, y = Math.random() * s;
    pts.push({ x, y });
    for (let k = 0; k < 5; k++) {
      x += (Math.random() - 0.5) * s * 0.16;
      y += (Math.random() - 0.5) * s * 0.16;
      pts.push({ x, y });
    }
    crack(pts, `rgba(17,14,11,${0.3 + Math.random() * 0.32})`, 0.6 + Math.random() * 1.1);
  }
  // Светлые прожилки минералов.
  for (let i = 0; i < 12; i++) {
    const pts = [];
    let x = Math.random() * s, y = Math.random() * s;
    pts.push({ x, y });
    for (let k = 0; k < 4; k++) {
      x += (Math.random() - 0.5) * s * 0.14;
      y += (Math.random() - 0.5) * s * 0.14;
      pts.push({ x, y });
    }
    crack(pts, `rgba(188,172,142,${0.07 + Math.random() * 0.1})`, 0.5 + Math.random() * 0.7);
  }
}

// Пол: утоптанная порода с гравием и камешками, а не гладкая плита.
function drawGravel(g, s) {
  g.fillStyle = "#332e27"; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 55; i++) {
    const x = Math.random() * s, y = Math.random() * s;
    const r = s * (0.04 + Math.random() * 0.16);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, Math.random() < 0.5
      ? `rgba(14,12,10,${0.12 + Math.random() * 0.18})`
      : `rgba(105,92,74,${0.05 + Math.random() * 0.1})`);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 850; i++) {
    const x = Math.random() * s, y = Math.random() * s;
    const r = 1 + Math.random() * 4;
    const rot = Math.random() * Math.PI;
    const c = 52 + Math.random() * 42 | 0;
    g.fillStyle = `rgb(${c + 10},${c + 2},${c - 8})`;
    g.beginPath(); g.ellipse(x, y, r, r * (0.55 + Math.random() * 0.3), rot, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(190,176,148,.075)";
    g.beginPath(); g.ellipse(x - r * 0.25, y - r * 0.25, r * 0.45, r * 0.28, rot, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(8,7,5,.28)";
    g.beginPath(); g.ellipse(x + r * 0.3, y + r * 0.3, r * 0.55, r * 0.32, rot, 0, Math.PI * 2); g.fill();
  }
}

function drawWood(g, s) {
  g.fillStyle = "#6a4824"; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 1100; i++) {
    const y = Math.random() * s, h = 1 + Math.random() * 2.2;
    g.fillStyle = `rgba(${40 + Math.random() * 55 | 0},${25 + Math.random() * 32 | 0},${10 + Math.random() * 18 | 0},${0.07 + Math.random() * 0.2})`;
    g.fillRect(0, y, s, h);
  }
  for (let y = 0; y < s; y += 44) {
    g.fillStyle = "rgba(22,13,6,.6)"; g.fillRect(0, y, s, 2);
  }
  for (let i = 0; i < 7; i++) {
    const x = Math.random() * s, y = Math.random() * s;
    g.strokeStyle = "rgba(28,16,7,.55)"; g.lineWidth = 2;
    g.beginPath(); g.ellipse(x, y, 4 + Math.random() * 5, 2 + Math.random() * 3, 0, 0, Math.PI * 2); g.stroke();
  }
}

function drawMetal(g, s) {
  g.fillStyle = "#585d61"; g.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y++) {
    const a = 0.04 + Math.random() * 0.11;
    g.fillStyle = Math.random() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    g.fillRect(0, y, s, 1);
  }
  for (let i = 0; i < 170; i++) {
    g.fillStyle = `rgba(150,88,38,${0.05 + Math.random() * 0.16})`;
    g.beginPath(); g.arc(Math.random() * s, Math.random() * s, 2 + Math.random() * 9, 0, Math.PI * 2); g.fill();
  }
  for (let y = 16; y < s; y += 64) for (let x = 16; x < s; x += 64) {
    g.fillStyle = "rgba(24,24,26,.85)"; g.beginPath(); g.arc(x, y, 2.6, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(210,210,215,.22)"; g.beginPath(); g.arc(x - 1, y - 1, 1.2, 0, Math.PI * 2); g.fill();
  }
}

function drawDust(g, s) {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, "rgba(255,255,255,.85)");
  gr.addColorStop(0.45, "rgba(215,205,185,.35)");
  gr.addColorStop(1, "rgba(170,160,140,0)");
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
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

  // Растягивает цилиндр-трос между двумя точками. Меш создаётся высотой 1,
  // поэтому scaling.y задаёт реальную длину, а кватернион — направление.
  // Нужен, чтобы трос противовеса тянулся за камнем, а не висел на месте.
  const ropeUp = new BABYLON.Vector3(0, 1, 0);
  const ropeDir = new BABYLON.Vector3();
  const ropeQ = new BABYLON.Quaternion();
  const ropeTo = new BABYLON.Vector3();
  function stretchBetween(mesh, from, to) {
    ropeDir.copyFrom(to).subtractInPlace(from);
    const len = ropeDir.length();
    if (len < 0.02) { mesh.setEnabled(false); return; }
    mesh.setEnabled(true);
    mesh.position.copyFrom(from).addInPlace(to).scaleInPlace(0.5);
    ropeDir.scaleInPlace(1 / len);
    BABYLON.Quaternion.FromUnitVectorsToRef(ropeUp, ropeDir, ropeQ);
    if (!mesh.rotationQuaternion) mesh.rotationQuaternion = ropeQ.clone();
    else mesh.rotationQuaternion.copyFrom(ropeQ);
    mesh.scaling.y = len;
  }

  // UV по мировым координатам для длинных коробок тоннеля. Стандартная
  // развёртка бокса растягивает текстуру вдоль тоннеля и превращает скалу
  // в «деревянные полосы». Здесь U/V считаются от мировых X/Y/Z, поэтому
  // рисунок остаётся квадратным на любой длине.
  function applyWorldUV(mesh, tile) {
    const pos = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    const nor = mesh.getVerticesData(BABYLON.VertexBuffer.NormalKind);
    if (!pos || !nor) return;
    const count = pos.length / 3;
    const uvs = new Array(count * 2);
    const px = mesh.position.x, py = mesh.position.y, pz = mesh.position.z;
    for (let i = 0; i < count; i++) {
      const wx = pos[i * 3] + px, wy = pos[i * 3 + 1] + py, wz = pos[i * 3 + 2] + pz;
      const nx = Math.abs(nor[i * 3]), ny = Math.abs(nor[i * 3 + 1]), nz = Math.abs(nor[i * 3 + 2]);
      let u, v;
      if (nx >= ny && nx >= nz) { u = wz; v = wy; }
      else if (ny >= nx && ny >= nz) { u = wx; v = wz; }
      else { u = wx; v = wy; }
      uvs[i * 2] = u / tile;
      uvs[i * 2 + 1] = v / tile;
    }
    mesh.setVerticesData(BABYLON.VertexBuffer.UVKind, uvs, false);
  }

  // ---------- Материалы ----------
  const wallMat = texMat(scene, "mineRockWallMat",
    dynTex(scene, "mineRockWallTex", 512, drawRock), 1, 1, 0.04, 0.03);
  const floorMat = texMat(scene, "mineRockFloorMat",
    dynTex(scene, "mineRockFloorTex", 512, drawGravel), 1, 1, 0.035, 0.02);
  const roofMat = texMat(scene, "mineRockRoofMat",
    dynTex(scene, "mineRockRoofTex", 512, drawRock), 1, 1, 0.03, 0.024);
  const woodMat = texMat(scene, "mineWoodMat",
    dynTex(scene, "mineWoodTex", 256, drawWood), 1.4, 1.4, 0.03, 0.03);
  const railMat = texMat(scene, "mineRailMat",
    dynTex(scene, "mineRailTex", 128, drawMetal), 1, 34, 0.16, 0.03);
  const gateMat = texMat(scene, "mineGateMat",
    dynTex(scene, "mineGateTex", 128, drawMetal), 1.6, 1.6, 0.15, 0.03);
  const cartMat = texMat(scene, "mineCartMat",
    dynTex(scene, "mineCartTex", 256, drawWood), 1.6, 1.6, 0.04, 0.03);
  const stoneMat = texMat(scene, "mineStoneMat",
    dynTex(scene, "mineStoneTex", 128, drawRock), 1.5, 1.5, 0.03, 0.02);

  const glowMat = makeMat(scene, "mineLamp",
    new BABYLON.Color3(0.4, 0.2, 0.05), new BABYLON.Color3(1, 0.55, 0.16));
  const exitMat = makeMat(scene, "mineExit",
    new BABYLON.Color3(0.1, 0.3, 0.12), new BABYLON.Color3(0.18, 0.9, 0.35));
  const redMat = new BABYLON.StandardMaterial("mineRedMech", scene);
  redMat.diffuseColor = new BABYLON.Color3(0.6, 0.07, 0.04);
  redMat.emissiveColor = new BABYLON.Color3(1, 0.16, 0.05);
  const darkMetalMat = makeMat(scene, "mineDarkMetal",
    new BABYLON.Color3(0.13, 0.14, 0.16), new BABYLON.Color3(0.03, 0.03, 0.04),
    new BABYLON.Color3(0.12, 0.12, 0.14));
  const goldMat = makeMat(scene, "mineGold",
    new BABYLON.Color3(0.75, 0.55, 0.12), new BABYLON.Color3(1, 0.72, 0.15),
    new BABYLON.Color3(0.6, 0.5, 0.2));
  const boneMat = makeMat(scene, "mineBone",
    new BABYLON.Color3(0.72, 0.7, 0.6), new BABYLON.Color3(0.14, 0.13, 0.1));
  const crystalMat = makeMat(scene, "mineCrystal",
    new BABYLON.Color3(0.08, 0.34, 0.33), new BABYLON.Color3(0.08, 0.5, 0.48));

  // ---------- Тоннель ----------
  const len = TUNNEL_Z1 - TUNNEL_Z0;
  const midZ = (TUNNEL_Z0 + TUNNEL_Z1) / 2;
  const floor = BABYLON.MeshBuilder.CreateBox("mineFloor",
    { width: 11.4, height: 0.6, depth: len }, scene);
  floor.position.set(0, FLOOR_Y - 0.3, midZ);
  floor.material = floorMat; floor.parent = root; floor.metadata = { kind: "mine" };
  applyWorldUV(floor, 4);

  const roof = BABYLON.MeshBuilder.CreateBox("mineRoof",
    { width: 11.4, height: 0.6, depth: len }, scene);
  roof.position.set(0, FLOOR_Y + 5.9, midZ);
  roof.material = roofMat; roof.parent = root; roof.metadata = { kind: "mine" };
  applyWorldUV(roof, 6);

  for (const sx of [-1, 1]) {
    const wall = BABYLON.MeshBuilder.CreateBox("mineWall",
      { width: 0.6, height: 6.6, depth: len }, scene);
    wall.position.set(sx * 5.8, FLOOR_Y + 3, midZ);
    wall.material = wallMat; wall.parent = root; wall.metadata = { kind: "mine" };
    applyWorldUV(wall, 6);
  }

  // Крепи вдоль тоннеля: меньше пустоты и понятно, куда едем.
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
  // Подвесные/настенные лампы: корпус, колпак и светящаяся колба. Раньше
  // это были голые оранжевые шары, которые читались как непонятные объекты.
  function makeLantern(x, y, z, side, hanging) {
    const grp = new BABYLON.TransformNode("mineLantern", scene);
    grp.position.set(x, y, z); grp.parent = root;
    const cap = BABYLON.MeshBuilder.CreateCylinder("mineLanternCap",
      { diameterTop: 0.06, diameterBottom: 0.3, height: 0.17, tessellation: 10 }, scene);
    cap.position.y = 0.16; cap.material = darkMetalMat;
    cap.parent = grp; cap.isPickable = false;
    const bulb = BABYLON.MeshBuilder.CreateSphere("mineLanternBulb",
      { diameter: 0.19, segments: 10 }, scene);
    bulb.position.y = 0.01; bulb.scaling.y = 1.15;
    bulb.material = glowMat; bulb.parent = grp; bulb.isPickable = false;
    const ring = BABYLON.MeshBuilder.CreateTorus("mineLanternRing",
      { diameter: 0.25, thickness: 0.022, tessellation: 14 }, scene);
    ring.position.y = -0.11; ring.material = darkMetalMat;
    ring.parent = grp; ring.isPickable = false;
    for (let k = 0; k < 4; k++) {
      const a = k / 4 * Math.PI * 2 + Math.PI / 4;
      const bar = BABYLON.MeshBuilder.CreateBox("mineLanternBar",
        { width: 0.016, height: 0.27, depth: 0.016 }, scene);
      bar.position.set(Math.cos(a) * 0.105, 0.01, Math.sin(a) * 0.105);
      bar.material = darkMetalMat; bar.parent = grp; bar.isPickable = false;
    }
    if (hanging) {
      const chain = BABYLON.MeshBuilder.CreateCylinder("mineLanternChain",
        { diameter: 0.025, height: 0.45, tessellation: 6 }, scene);
      chain.position.y = 0.45; chain.material = darkMetalMat;
      chain.parent = grp; chain.isPickable = false;
    } else {
      const arm = BABYLON.MeshBuilder.CreateBox("mineLanternArm",
        { width: 0.34, height: 0.045, depth: 0.045 }, scene);
      arm.position.set(side * 0.08, 0.22, 0);
      arm.material = darkMetalMat; arm.parent = grp; arm.isPickable = false;
    }
    return grp;
  }
  for (let z = TUNNEL_Z0 + 16; z < TUNNEL_Z1 - 8; z += 24) {
    for (const sx of [-1, 1]) {
      makeLantern(sx * 5.3, FLOOR_Y + 2.9, z, sx, false);
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
    // На участках BUMPS часть шпал выбита — по рельсам видно, где трясёт.
    if (BUMPS.some((b) => Math.abs(z - b.z) < b.len && Math.random() < 0.6)) continue;
    const sl = BABYLON.MeshBuilder.CreateBox("mineSleeper",
      { width: 2.5, height: 0.1, depth: 0.34 }, scene);
    sl.position.set(0, FLOOR_Y + 0.03, z);
    sl.material = woodMat; sl.isPickable = false;
    sleepers.push(sl);
  }
  const sleeperMesh = BABYLON.Mesh.MergeMeshes(sleepers, true, true);
  if (sleeperMesh) {
    sleeperMesh.name = "mineSleepers"; sleeperMesh.parent = root; sleeperMesh.isPickable = false;
  }

  // ---------- Декор: кристаллы, вывески, мыши, пыль ----------
  for (const [cz, side] of [[66, -1], [148, 1], [232, -1]]) {
    for (let i = 0; i < 5; i++) {
      const h = 0.5 + Math.random() * 1.1;
      const c = BABYLON.MeshBuilder.CreateCylinder("mineCrystalMesh",
        { diameterTop: 0, diameterBottom: 0.1 + Math.random() * 0.13, height: h, tessellation: 6 }, scene);
      c.position.set(side * (5.36 + Math.random() * 0.06), FLOOR_Y + 0.8 + Math.random() * 3.6, cz + (Math.random() - 0.5) * 5);
      c.rotation.z = side * (0.25 + Math.random() * 0.45);
      c.rotation.x = (Math.random() - 0.5) * 0.5;
      c.material = crystalMat; c.parent = root; c.isPickable = false;
    }
  }

  let signSeq = 0;
  function makeSign(main, sub, w, h) {
    const W = 512, H = 256;
    const tex = new BABYLON.DynamicTexture("mineSignTex" + signSeq++,
      { width: W, height: H }, scene, false);
    const g = tex.getContext();
    // Тёмная металлическая табличка с деревянной окантовкой и заклёпками.
    g.fillStyle = "#15110d"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#2b2219"; g.fillRect(10, 10, W - 20, H - 20);
    g.strokeStyle = "#7d5f36"; g.lineWidth = 14; g.strokeRect(7, 7, W - 14, H - 14);
    g.strokeStyle = "rgba(255,224,160,.14)"; g.lineWidth = 3;
    g.strokeRect(24, 24, W - 48, H - 48);
    for (const [x, y] of [[28, 28], [W - 28, 28], [28, H - 28], [W - 28, H - 28]]) {
      g.fillStyle = "#a9854f"; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill();
      g.fillStyle = "rgba(0,0,0,.4)"; g.beginPath(); g.arc(x + 2, y + 2, 4.5, 0, Math.PI * 2); g.fill();
    }
    g.textAlign = "center"; g.textBaseline = "middle";
    // Длинные подписи (НЕ ОСТАНАВЛИВАЙСЯ) уменьшаем, чтобы влезли.
    const fs = main.length > 14 ? 46 : main.length > 11 ? 56 : main.length > 8 ? 66 : 84;
    g.fillStyle = "#f0d27a"; g.font = `bold ${fs}px Arial, sans-serif`;
    g.fillText(main, W / 2, sub ? 100 : 128);
    if (sub) {
      g.fillStyle = "#c7a361"; g.font = "bold 40px Arial, sans-serif";
      g.fillText(sub, W / 2, 178);
    }
    tex.update();
    const mat = new BABYLON.StandardMaterial("mineSignMat" + signSeq, scene);
    mat.emissiveTexture = tex;
    // ВНИМАНИЕ: emissiveColor прибавляется к emissiveTexture в шейдере.
    // Белый цвет делал табличку сплошным белым прямоугольником.
    mat.emissiveColor = BABYLON.Color3.Black();
    mat.diffuseColor = BABYLON.Color3.Black();
    mat.specularColor = BABYLON.Color3.Black();
    mat.backFaceCulling = false;
    const p = BABYLON.MeshBuilder.CreatePlane("mineSign", { width: w, height: h }, scene);
    p.material = mat; p.parent = root; p.isPickable = false;
    // Деревянная подложка: табличка не выглядит плоским листом в воздухе.
    const board = BABYLON.MeshBuilder.CreateBox("mineSignBoard",
      { width: w + 0.14, height: h + 0.12, depth: 0.05 }, scene);
    board.material = woodMat; board.parent = p;
    // Передняя сторона плоскости смотрит в -Z, поэтому подложка — за ней (+Z).
    board.position.z = 0.04; board.isPickable = false;
    return p;
  }
  const signA = makeSign("ШАХТА №7", "MINE №7", 1.8, 0.9);
  signA.position.set(-5.46, FLOOR_Y + 3.3, 56); signA.rotation.y = -Math.PI / 2;
  const signB = makeSign("ОПАСНО", "DANGER", 1.5, 0.75);
  signB.position.set(5.46, FLOOR_Y + 3.6, 128); signB.rotation.y = Math.PI / 2;
  const signC = makeSign("НЕ ОСТАНАВЛИВАЙСЯ", "DO NOT STOP", 1.9, 0.95);
  signC.position.set(5.46, FLOOR_Y + 3.4, 230); signC.rotation.y = Math.PI / 2;
  const signD = makeSign("ЗДЕСЬ БЫЛ КОТ", "THE CAT WAS HERE", 1.7, 0.85);
  signD.position.set(-5.46, FLOOR_Y + 1.9, 188); signD.rotation.y = -Math.PI / 2;

  const batMat = makeMat(scene, "mineBatMat",
    new BABYLON.Color3(0.12, 0.1, 0.11), new BABYLON.Color3(0.05, 0.04, 0.05));
  const bats = [];
  for (let i = 0; i < 7; i++) {
    const b = BABYLON.MeshBuilder.CreateBox("mineBat",
      { width: 0.24, height: 0.05, depth: 0.13 }, scene);
    b.material = batMat; b.parent = root; b.isPickable = false;
    b.setEnabled(false);
    b.meta = {
      phase: Math.random() * Math.PI * 2, r: 1.3 + Math.random() * 2.4,
      speed: 1.6 + Math.random() * 1.8, y: 1.3 + Math.random() * 2.8,
    };
    bats.push(b);
  }

  const dustTex = dynTex(scene, "mineDustTex", 64, drawDust);
  dustTex.hasAlpha = true;
  const dust = new BABYLON.ParticleSystem("mineCartDust", 600, scene);
  dust.particleTexture = dustTex;
  dust.emitter = null;
  dust.minEmitBox = new BABYLON.Vector3(-0.7, -0.05, -0.9);
  dust.maxEmitBox = new BABYLON.Vector3(0.7, 0.35, 0.6);
  dust.color1 = new BABYLON.Color4(0.45, 0.38, 0.3, 0.32);
  dust.color2 = new BABYLON.Color4(0.3, 0.26, 0.21, 0.2);
  dust.colorDead = new BABYLON.Color4(0.2, 0.18, 0.15, 0);
  dust.minSize = 0.25; dust.maxSize = 0.9;
  dust.minLifeTime = 0.35; dust.maxLifeTime = 1.3;
  dust.direction1 = new BABYLON.Vector3(-1.1, -0.1, -1.4);
  dust.direction2 = new BABYLON.Vector3(1.1, 0.8, 0.2);
  dust.minEmitPower = 0.2; dust.maxEmitPower = 1.2;
  dust.gravity = new BABYLON.Vector3(0, 0.25, 0);
  dust.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
  dust.emitRate = 0;
  dust.start();

  // ---------- Ворота с механизмом ----------
  const gates = [];
  GATE_ZS.forEach((z, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    const variant = GATE_VARIANTS[i];
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

    // --- Механизм на боковой стойке ---
    // Барабан лебёдки + трос через блок к противовесу. Створку держит
    // предохранитель: деревянная чека, замок на цепи или бочка пороха.
    // Механизм вынесен перед воротами к стене, чтобы его не закрывала рама.
    const mx = side * 5.0;
    const my = FLOOR_Y + 3.1;
    const mz = z - 2.4;

    // Деревянная стойка, к которой крепится лебёдка.
    const mechPost = BABYLON.MeshBuilder.CreateBox("mineMechPost",
      { width: 0.24, height: 5.6, depth: 0.3 }, scene);
    mechPost.position.set(side * 5.36, FLOOR_Y + 2.8, mz);
    mechPost.material = woodMat; mechPost.parent = root; mechPost.isPickable = false;

    const drum = BABYLON.MeshBuilder.CreateCylinder("mineWinchDrum",
      { diameter: 0.5, height: 0.34, tessellation: 14 }, scene);
    drum.rotation.z = Math.PI / 2;
    drum.position.set(mx, my, mz);
    drum.material = gateMat; drum.parent = root; drum.isPickable = false;

    const pulley = BABYLON.MeshBuilder.CreateTorus("minePulley",
      { diameter: 0.5, thickness: 0.07, tessellation: 14 }, scene);
    pulley.position.set(mx, FLOOR_Y + 5.25, mz);
    pulley.rotation.y = Math.PI / 2;
    pulley.material = darkMetalMat; pulley.parent = root; pulley.isPickable = false;

    // Оси, которыми барабан и блок крепятся к деревянной стойке.
    for (const ay of [my, FLOOR_Y + 5.25]) {
      const axle = BABYLON.MeshBuilder.CreateCylinder("mineAxle",
        { diameter: 0.07, height: 0.42, tessellation: 8 }, scene);
      axle.rotation.z = Math.PI / 2;
      axle.position.set(mx + side * 0.18, ay, mz);
      axle.material = darkMetalMat; axle.parent = root; axle.isPickable = false;
    }

    const ropeMat = makeMat(scene, "mineRope" + i,
      new BABYLON.Color3(0.32, 0.28, 0.2), new BABYLON.Color3(0.06, 0.05, 0.03));
    const rope1 = BABYLON.MeshBuilder.CreateCylinder("mineRope",
      { diameter: 0.05, height: 2.15, tessellation: 6 }, scene);
    rope1.position.set(mx, FLOOR_Y + 4.18, mz);
    rope1.material = ropeMat; rope1.parent = root; rope1.isPickable = false;

    const weightY0 = FLOOR_Y + 2.5;
    const weight = BABYLON.MeshBuilder.CreateBox("mineCounterweight",
      { width: 0.5, height: 0.7, depth: 0.42 }, scene);
    weight.position.set(mx, weightY0, mz);
    weight.material = stoneMat; weight.parent = root; weight.isPickable = false;
    const rope2 = BABYLON.MeshBuilder.CreateCylinder("mineRope",
      { diameter: 0.05, height: 1, tessellation: 6 }, scene);
    rope2.material = ropeMat; rope2.parent = root; rope2.isPickable = false;
    const pulleyPos = new BABYLON.Vector3(mx, FLOOR_Y + 5.25, mz);
    // Стартовое положение троса: от блока вниз к противовесу.
    stretchBetween(rope2, pulleyPos, new BABYLON.Vector3(mx, weightY0 + 0.35, mz));

    // Мигающее кольцо: показывает, по чему стрелять.
    const markerMat = new BABYLON.StandardMaterial("mineMarkerMat" + i, scene);
    markerMat.diffuseColor = BABYLON.Color3.Black();
    markerMat.emissiveColor = new BABYLON.Color3(1, 0.22, 0.08);
    markerMat.alpha = 0.85;
    const marker = BABYLON.MeshBuilder.CreateTorus("mineMarker" + i,
      { diameter: 1.25, thickness: 0.045, tessellation: 24 }, scene);
    // Кольцо всегда развёрнуто к игроку: механизм стоит сбоку, и плоское
    // кольцо в плоскости стены читалось бы как случайная дуга.
    marker.rotation.x = Math.PI / 2;
    marker.bakeCurrentTransformIntoVertices();
    marker.rotation.set(0, 0, 0);
    marker.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    marker.material = markerMat; marker.parent = root; marker.isPickable = false;

    const parts = [];
    let targetPos, markerPos, labelTop, labelSub;
    if (variant === "pin") {
      // Стальная чека, вставленная в барабан лебёдки: вертикальный стержень
      // с кольцом снизу. Видна сбоку как красная планка на колесе.
      const pin = BABYLON.MeshBuilder.CreateBox("minePin",
        { width: 0.16, height: 0.6, depth: 0.16 }, scene);
      pin.position.set(mx - side * 0.26, my, mz + 0.05);
      pin.material = redMat; pin.parent = root;
      pin.metadata = { kind: "mineTarget", index: i };
      pin.isPickable = true;
      parts.push(pin);
      const ring = BABYLON.MeshBuilder.CreateTorus("minePinRing",
        { diameter: 0.24, thickness: 0.04, tessellation: 14 }, scene);
      ring.position.set(mx - side * 0.36, my - 0.38, mz + 0.05);
      ring.rotation.y = Math.PI / 2;
      ring.material = darkMetalMat; ring.parent = root; ring.isPickable = false;
      parts.push(ring);
      targetPos = pin.position.add(new BABYLON.Vector3(0, 0.1, -0.5));
      markerPos = new BABYLON.Vector3(mx - side * 0.26, my - 0.02, mz + 0.05);
      labelTop = "ЧЕКА ЛЕБЁДКИ"; labelSub = "WINCH PIN";
    } else if (variant === "lock") {
      // Цепь на барабане заперта навесным замком.
      const lockRoot = new BABYLON.TransformNode("mineLockRoot" + i, scene);
      lockRoot.position.set(mx - side * 0.3, my - 0.3, mz + 0.12);
      lockRoot.rotation.y = side * Math.PI / 2;
      lockRoot.parent = root;
      const body = BABYLON.MeshBuilder.CreateBox("mineLockBody",
        { width: 0.3, height: 0.32, depth: 0.14 }, scene);
      body.material = redMat; body.parent = lockRoot;
      body.metadata = { kind: "mineTarget", index: i }; body.isPickable = true;
      const shackle = BABYLON.MeshBuilder.CreateTorus("mineLockShackle",
        { diameter: 0.26, thickness: 0.045, tessellation: 14 }, scene);
      shackle.position.y = 0.18; shackle.material = darkMetalMat;
      shackle.parent = lockRoot; shackle.isPickable = false;
      parts.push(body, shackle);
      targetPos = new BABYLON.Vector3(mx - side * 0.3, my - 0.3, mz - 0.5);
      markerPos = new BABYLON.Vector3(mx - side * 0.3, my - 0.28, mz + 0.12);
      labelTop = "ЗАМОК НА ЦЕПИ"; labelSub = "CHAIN LOCK";
    } else {
      // Бочка пороха у рамы: взрыв срывает запор и ворота идут вверх.
      const keg = BABYLON.MeshBuilder.CreateCylinder("mineKeg",
        { diameter: 0.62, height: 0.78, tessellation: 16 }, scene);
      keg.position.set(mx, FLOOR_Y + 0.42, z - 0.9);
      keg.material = cartMat; keg.parent = root;
      keg.metadata = { kind: "mineTarget", index: i }; keg.isPickable = true;
      const band = BABYLON.MeshBuilder.CreateCylinder("mineKegBand",
        { diameter: 0.65, height: 0.14, tessellation: 16 }, scene);
      band.position.copyFrom(keg.position); band.position.y += 0.05;
      band.material = redMat; band.parent = root; band.isPickable = false;
      const fuse = BABYLON.MeshBuilder.CreateCylinder("mineFuse",
        { diameter: 0.035, height: 0.42, tessellation: 6 }, scene);
      fuse.position.copyFrom(keg.position);
      fuse.position.y += 0.58;
      fuse.rotation.z = 0.35; fuse.material = ropeMat;
      fuse.parent = root; fuse.isPickable = false;
      parts.push(keg, band, fuse);
      targetPos = new BABYLON.Vector3(keg.position.x, FLOOR_Y + 1.1, keg.position.z);
      markerPos = new BABYLON.Vector3(keg.position.x, keg.position.y + 0.35, keg.position.z);
      labelTop = "БОЧКА ПОРОХА"; labelSub = "POWDER KEG";
    }

    // Кольцо и подпись над самим механизмом: без них непонятно, что это.
    marker.position.copyFrom(markerPos);
    const labelX = variant === "keg" ? side * 3.95 : side * 4.35;
    const labelY = variant === "keg" ? FLOOR_Y + 2.7 : my + 0.95;
    const labelZ = variant === "keg" ? z - 1.65 : mz - 0.25;
    const label = makeSign(labelTop, labelSub, 1.65, 0.62);
    label.position.set(labelX, labelY, labelZ);
    label.rotation.y = side * 0.5;
    // Табличка висит на цепочке с потолка, а не парит в воздухе.
    const chainLen = Math.max(0.2, (FLOOR_Y + 5.6) - (labelY + 0.31));
    const signChain = BABYLON.MeshBuilder.CreateCylinder("mineSignChain",
      { diameter: 0.025, height: chainLen, tessellation: 6 }, scene);
    signChain.position.set(labelX, labelY + 0.31 + chainLen / 2, labelZ);
    signChain.material = darkMetalMat; signChain.parent = root; signChain.isPickable = false;

    // Подсветка у ворот, чтобы их было видно издалека.
    makeLantern(0, FLOOR_Y + 5.1, z - 0.2, 0, true);

    // Мягкий отсвет на раме: без него вдали ворота тонут в темноте.
    const gateLight = new BABYLON.PointLight("mineGateLight" + i,
      new BABYLON.Vector3(0, FLOOR_Y + 3.4, z - 2.6), scene);
    gateLight.diffuse = new BABYLON.Color3(1, 0.38, 0.2);
    gateLight.intensity = 0.65;
    gateLight.range = 13;
    gateLight.setEnabled(false);

    gates.push({
      index: i, z, side, variant, gRoot, targetPos, parts, marker, markerMat,
      label, weight, weightY0, pulley, pulleyPos, rope2, light: gateLight,
      open: false, openK: 0, openTime: variant === "keg" ? 0.7 : 1.6,
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

  // ---------- Пасхалки ----------
  const eggs = [];
  const eggColliderMat = new BABYLON.StandardMaterial("mineEggCollider", scene);
  eggColliderMat.alpha = 0;
  function addEggCollider(x, y, z, r, index) {
    const s = BABYLON.MeshBuilder.CreateSphere("mineEggHit" + index,
      { diameter: r * 2, segments: 8 }, scene);
    s.position.set(x, y, z);
    s.material = eggColliderMat;
    s.visibility = 0;
    s.isPickable = true;
    s.parent = root;
    s.metadata = { kind: "mineEgg", index };
    return s;
  }

  // 1. Золотая шестерёнка на металлическом кронштейне у стены.
  {
    const gx = -5.22, gy = FLOOR_Y + 3.4, gz = 128;
    const gearRoot = new BABYLON.TransformNode("mineGearRoot", scene);
    gearRoot.position.set(gx, gy, gz);
    gearRoot.rotation.y = Math.PI / 2; // плоскость колеса вдоль стены
    gearRoot.parent = root;
    const hubMat = darkMetalMat;
    // Крепление к стене: стойка и пластина (локальное -Z смотрит в стену).
    const shaft = BABYLON.MeshBuilder.CreateCylinder("mineGearShaft",
      { diameter: 0.09, height: 0.34, tessellation: 10 }, scene);
    shaft.rotation.x = Math.PI / 2; shaft.position.z = -0.14;
    shaft.material = hubMat; shaft.parent = gearRoot; shaft.isPickable = false;
    const plate = BABYLON.MeshBuilder.CreateBox("mineGearPlate",
      { width: 0.34, height: 0.34, depth: 0.05 }, scene);
    plate.position.z = -0.31; plate.material = hubMat;
    plate.parent = gearRoot; plate.isPickable = false;
    // Обод, ступица и спицы.
    const rim = BABYLON.MeshBuilder.CreateTorus("mineGearRim",
      { diameter: 0.62, thickness: 0.15, tessellation: 24 }, scene);
    rim.material = goldMat; rim.parent = gearRoot; rim.isPickable = false;
    const hub = BABYLON.MeshBuilder.CreateCylinder("mineGearHub",
      { diameter: 0.17, height: 0.16, tessellation: 14 }, scene);
    hub.rotation.x = Math.PI / 2; hub.material = goldMat;
    hub.parent = gearRoot; hub.isPickable = false;
    for (let k = 0; k < 4; k++) {
      const a = k / 4 * Math.PI * 2 + Math.PI / 4;
      const spoke = BABYLON.MeshBuilder.CreateBox("mineGearSpoke",
        { width: 0.5, height: 0.07, depth: 0.1 }, scene);
      spoke.rotation.z = a;
      spoke.material = goldMat; spoke.parent = gearRoot; spoke.isPickable = false;
    }
    // Зубья по ободу.
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2;
      const tooth = BABYLON.MeshBuilder.CreateBox("mineGearTooth",
        { width: 0.13, height: 0.16, depth: 0.16 }, scene);
      tooth.position.set(Math.cos(a) * 0.37, Math.sin(a) * 0.37, 0);
      tooth.rotation.z = a - Math.PI / 2;
      tooth.material = goldMat; tooth.parent = gearRoot; tooth.isPickable = false;
    }
    const collider = addEggCollider(gx, gy, gz, 0.6, 0);
    eggs.push({ index: 0, root: gearRoot, hits: [collider], pos: new BABYLON.Vector3(gx, gy, gz),
      r: 0.95, done: false, msg: "Пасхалка: золотая шестерёнка!" });
  }

  // 2. Канарейка в клетке — прострелите клетку, птица улетит.
  {
    const cx = 5.2, cy = FLOOR_Y + 1.55, cz = 200;
    const cageRoot = new BABYLON.TransformNode("mineCageRoot", scene);
    cageRoot.position.set(cx, cy, cz);
    cageRoot.parent = root;
    const barMat = darkMetalMat;
    for (let k = -2; k <= 2; k++) {
      const bar = BABYLON.MeshBuilder.CreateBox("mineCageBar",
        { width: 0.04, height: 0.8, depth: 0.04 }, scene);
      bar.position.set(k * 0.14, 0, 0.14);
      bar.material = barMat; bar.parent = cageRoot; bar.isPickable = false;
      const bar2 = bar.clone("mineCageBar2");
      bar2.position.z = -0.14; bar2.parent = cageRoot; bar2.isPickable = false;
    }
    const top = BABYLON.MeshBuilder.CreateCylinder("mineCageTop",
      { diameter: 0.75, height: 0.05, tessellation: 12 }, scene);
    top.position.y = 0.42; top.material = barMat; top.parent = cageRoot; top.isPickable = false;
    const bottom = top.clone("mineCageBottom");
    bottom.position.y = -0.42; bottom.parent = cageRoot; bottom.isPickable = false;
    // Клетка подвешена к крепи — иначе она висит в воздухе без опоры.
    const chain = BABYLON.MeshBuilder.CreateCylinder("mineCageChain",
      { diameter: 0.03, height: 3.9, tessellation: 6 }, scene);
    chain.position.set(cx, cy + 2.4, cz);
    chain.material = barMat; chain.parent = root; chain.isPickable = false;
    const birdMat = makeMat(scene, "mineBirdMat",
      new BABYLON.Color3(0.95, 0.75, 0.15), new BABYLON.Color3(0.45, 0.3, 0.03));
    const bird = BABYLON.MeshBuilder.CreateSphere("mineBird",
      { diameter: 0.2, segments: 8 }, scene);
    bird.position.set(0, -0.2, 0);
    bird.scaling.set(1, 0.85, 1.25);
    bird.material = birdMat; bird.parent = cageRoot; bird.isPickable = false;
    const collider = addEggCollider(cx, cy, cz, 0.55, 1);
    eggs.push({ index: 1, root: cageRoot, hits: [collider], pos: new BABYLON.Vector3(cx, cy, cz),
      r: 0.85, done: false, bird, flyT: null, msg: "Пасхалка: канарейка на свободе!" });
  }

  // 3. Скелет шахтёра в каске с киркой.
  {
    const sx = -5.0, sy = FLOOR_Y + 0.75, sz = 224;
    const skel = new BABYLON.TransformNode("mineSkeleton", scene);
    skel.position.set(sx, sy, sz);
    skel.rotation.y = Math.PI / 2;
    skel.parent = root;
    const skull = BABYLON.MeshBuilder.CreateSphere("mineSkull",
      { diameter: 0.28, segments: 10 }, scene);
    skull.position.y = 0.55; skull.material = boneMat; skull.parent = skel; skull.isPickable = false;
    const jaw = BABYLON.MeshBuilder.CreateBox("mineJaw",
      { width: 0.16, height: 0.08, depth: 0.14 }, scene);
    jaw.position.set(0, 0.42, 0.03); jaw.material = boneMat; jaw.parent = skel; jaw.isPickable = false;
    for (let k = 0; k < 4; k++) {
      const rib = BABYLON.MeshBuilder.CreateBox("mineRib",
        { width: 0.34, height: 0.04, depth: 0.1 }, scene);
      rib.position.set(0, 0.3 - k * 0.1, 0); rib.material = boneMat;
      rib.parent = skel; rib.isPickable = false;
    }
    const helmet = BABYLON.MeshBuilder.CreateCylinder("mineHelmet",
      { diameterTop: 0.24, diameterBottom: 0.3, height: 0.16, tessellation: 12 }, scene);
    helmet.position.set(0, 0.72, 0);
    helmet.material = makeMat(scene, "mineHelmetMat",
      new BABYLON.Color3(0.7, 0.48, 0.12), new BABYLON.Color3(0.25, 0.16, 0.03));
    helmet.parent = skel; helmet.isPickable = false;
    const brim = BABYLON.MeshBuilder.CreateTorus("mineHelmetBrim",
      { diameter: 0.34, thickness: 0.035, tessellation: 14 }, scene);
    brim.position.set(0, 0.66, 0); brim.parent = skel; brim.isPickable = false;
    brim.material = helmet.material;
    const handle = BABYLON.MeshBuilder.CreateCylinder("minePickHandle",
      { diameter: 0.045, height: 1.0, tessellation: 6 }, scene);
    handle.position.set(0.3, 0.3, 0.12); handle.rotation.z = 0.5;
    handle.material = woodMat; handle.parent = skel; handle.isPickable = false;
    const head = BABYLON.MeshBuilder.CreateBox("minePickHead",
      { width: 0.36, height: 0.07, depth: 0.07 }, scene);
    head.position.set(0.52, 0.72, 0.12); head.rotation.z = 0.5;
    head.material = darkMetalMat; head.parent = skel; head.isPickable = false;
    const collider = addEggCollider(sx, sy + 0.55, sz, 0.5, 2);
    eggs.push({ index: 2, root: skel, hits: [collider], pos: new BABYLON.Vector3(sx, sy + 0.55, sz),
      r: 0.9, done: false, helmet, helmetT: null, msg: "Пасхалка: шахтёрская каска" });
  }

  // ---------- Вагонетка ----------
  const cart = new BABYLON.TransformNode("mineCart", scene);
  cart.parent = root;
  cart.position.set(0, FLOOR_Y + 0.3, START_Z);
  const addBox = (w, h, d, x, y, z) => {
    const m = BABYLON.MeshBuilder.CreateBox("mineCartPart",
      { width: w, height: h, depth: d }, scene);
    m.position.set(x, y, z); m.material = cartMat; m.parent = cart;
    m.isPickable = false;
    return m;
  };
  addBox(1.7, 0.22, 2.4, 0, 0.16, 0);
  addBox(0.12, 0.8, 2.4, -0.8, 0.55, 0);
  addBox(0.12, 0.8, 2.4, 0.8, 0.55, 0);
  addBox(1.7, 0.62, 0.12, 0, 0.5, -1.14);
  // Передний борт — невысокий: в первом лице он читается тонкой деревянной
  // кромкой снизу и не закрывает рельсы и механизмы на воротах.
  addBox(1.7, 0.56, 0.12, 0, 0.47, 1.14);
  for (const wx of [-0.88, 0.88]) {
    for (const wz of [-0.72, 0.72]) {
      const wheel = BABYLON.MeshBuilder.CreateCylinder("mineWheel",
        { diameter: 0.48, height: 0.14, tessellation: 12 }, scene);
      wheel.position.set(wx, -0.02, wz);
      wheel.rotation.z = Math.PI / 2;
      wheel.material = railMat; wheel.parent = cart;
      wheel.isPickable = false;
    }
  }
  dust.emitter = cart;

  const lamp = new BABYLON.PointLight("mineLamp",
    new BABYLON.Vector3(0, FLOOR_Y + 3, START_Z + 4), scene);
  lamp.diffuse = new BABYLON.Color3(1, 0.7, 0.38);
  lamp.intensity = 2.4;
  lamp.range = 22;
  lamp.setEnabled(false);

  const hudEl = document.getElementById("mineHud");
  const statusEl = document.getElementById("mineStatus");
  const secretsEl = document.getElementById("mineSecrets");
  const camCountEl = document.getElementById("camCount");
  function showHud(on) {
    if (hudEl) hudEl.style.display = on ? "block" : "none";
    if (camCountEl) camCountEl.style.display = on ? "none" : "block";
  }
  let lastStatus = "";
  onLangChange(() => { lastStatus = ""; updateSecrets(); });

  const state = {
    active: false, finished: false, z: START_Z, speed: 0,
    gates, bob: 0, hint: "", time: 0, bumpT: 0, pebbleT: 1.5,
    secrets: 0,
  };
  const pebbles = [];

  function updateSecrets() {
    if (secretsEl) {
      secretsEl.textContent = t("Секреты: {n} / {m}",
        { n: state.secrets, m: SECRETS_TOTAL });
    }
  }

  function resetGates() {
    for (const g of gates) {
      g.open = false; g.openK = 0;
      g.gRoot.position.y = FLOOR_Y;
      g.gRoot.rotation.z = 0;
      g.weight.position.y = g.weightY0;
      g.pulley.rotation.z = 0;
      for (const part of g.parts) part.setEnabled(true);
      g.marker.setEnabled(true);
      g.label.setEnabled(true);
      g.markerMat.emissiveColor.set(1, 0.22, 0.08);
      g.light.diffuse.set(1, 0.38, 0.2);
      g.light.intensity = 0.65;
    }
  }

  function resetEggs() {
    state.secrets = 0;
    updateSecrets();
    for (const egg of eggs) {
      egg.done = false;
      egg.root.setEnabled(true);
      for (const h of egg.hits) h.setEnabled(true);
      if (egg.bird) {
        egg.bird.setEnabled(true);
        egg.bird.position.set(0, -0.2, 0);
        egg.bird.rotation.set(0, 0, 0);
        egg.flyT = null;
      }
      if (egg.helmet) {
        egg.helmet.setEnabled(true);
        egg.helmet.position.set(0, 0.72, 0);
        egg.helmet.rotation.set(0, 0, 0);
        egg.helmetT = null;
      }
    }
  }

  function clearPebbles() {
    for (const p of pebbles) p.dispose();
    pebbles.length = 0;
  }

  function start() {
    state.active = true; state.finished = false;
    state.z = START_Z; state.speed = 0; state.bob = 0; state.hint = "";
    state.time = 0; state.bumpT = 0; state.pebbleT = 1.2;
    resetGates();
    resetEggs();
    clearPebbles();
    root.setEnabled(true);
    lamp.setEnabled(true);
    for (const g of gates) g.light.setEnabled(true);
    for (const b of bats) b.setEnabled(false);
    if (sunLight) sunLight.intensity = 0.12;
    if (hemiLight) hemiLight.intensity = 0.16;
    showHud(true);
    dust.emitRate = 0;
    cart.position.set(0, FLOOR_Y + 0.3, START_Z);
    player.mesh.position.set(0, FLOOR_Y + 0.95, START_Z);
    player.st.vel.set(0, 0, 0);
    player.st.grounded = true;
    player.st.yaw = 0;
    player.st.pitch = 0;
    camera.position.set(0, FLOOR_Y + 1.55, START_Z + 0.15);
    camera.rotation.set(0, 0, 0);
    lastStatus = ""; state.hint = "";
    if (toast) toast(t("Вагонетка покатилась! Ищите красный механизм на воротах"));
  }

  function finish() {
    if (!state.active) return;
    state.active = false; state.finished = true;
    showHud(false);
    lamp.setEnabled(false);
    for (const g of gates) g.light.setEnabled(false);
    for (const b of bats) b.setEnabled(false);
    clearPebbles();
    dust.emitRate = 0;
    if (sunLight) sunLight.intensity = baseSun;
    if (hemiLight) hemiLight.intensity = baseHemi;
    if (onFinish) onFinish();
  }

  // Аварийная/тестовая остановка: гасим шахту и прячем её целиком, не
  // показывая финальный экран. Нужна тестовым сценам (R / смена сцены).
  function stop() {
    if (!state.active && !state.finished) return;
    state.active = false; state.finished = false;
    showHud(false);
    lamp.setEnabled(false);
    for (const g of gates) g.light.setEnabled(false);
    for (const b of bats) b.setEnabled(false);
    clearPebbles();
    dust.emitRate = 0;
    if (sunLight) sunLight.intensity = baseSun;
    if (hemiLight) hemiLight.intensity = baseHemi;
    root.setEnabled(false);
  }

  function flashAt(pos, color, power) {
    const l = new BABYLON.PointLight("mineBoom", pos.clone(), scene);
    l.diffuse = color;
    l.intensity = power; l.range = 15;
    setTimeout(() => l.dispose(), 340);
  }

  function openGate(g) {
    if (g.open) return;
    g.open = true; g.openK = 0;
    for (const part of g.parts) part.setEnabled(false);
    g.marker.setEnabled(false);
    g.label.setEnabled(false);
    g.markerMat.emissiveColor.set(0.2, 1, 0.3);
    g.light.diffuse.set(0.35, 1, 0.45);
    g.light.intensity = 0.5;
    if (g.variant === "keg") {
      burstAt(scene, g.targetPos, getFireTexture(scene), 90);
      sparksAt(scene, g.targetPos, 34);
      flashAt(g.targetPos, new BABYLON.Color3(1, 0.5, 0.15), 7);
      if (toast) toast(t("Порох рванул — ворота сорвало с рамы"));
    } else if (g.variant === "lock") {
      sparksAt(scene, g.targetPos, 30);
      burstAt(scene, g.targetPos, getFireTexture(scene), 14);
      if (toast) toast(t("Замок сбит — цепь разматывается, ворота идут вверх"));
    } else {
      sparksAt(scene, g.targetPos, 26);
      burstAt(scene, g.targetPos, getFireTexture(scene), 12);
      if (toast) toast(t("Клин выбит — противовес поднимает ворота"));
    }
  }

  function nextClosedGate() {
    let next = null;
    for (const g of gates) {
      if (g.open || g.z < state.z + 0.5) continue;
      if (!next || g.z < next.z) next = g;
    }
    return next;
  }

  function spawnPebble() {
    const m = BABYLON.MeshBuilder.CreateIcoSphere("minePebble",
      { radius: 0.05 + Math.random() * 0.09, subdivisions: 0, flat: true }, scene);
    m.scaling.set(1, 0.7 + Math.random() * 0.5, 0.8 + Math.random() * 0.5);
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    m.material = stoneMat; m.parent = root; m.isPickable = false;
    m.position.set((Math.random() - 0.5) * 8.6, FLOOR_Y + 5.55,
      state.z + 4 + Math.random() * 14);
    m.meta = { vy: 0 };
    pebbles.push(m);
  }

  function takeEgg(egg) {
    if (egg.done) return;
    egg.done = true;
    for (const h of egg.hits) h.setEnabled(false);
    state.secrets++;
    updateSecrets();
    if (egg.index === 0) {
      sparksAt(scene, egg.pos, 26);
      burstAt(scene, egg.pos, getFireTexture(scene), 20);
      egg.root.setEnabled(false);
    } else if (egg.index === 1) {
      sparksAt(scene, egg.pos, 16);
      egg.flyT = 0;
      egg.bird.setEnabled(true);
    } else {
      sparksAt(scene, egg.pos, 16);
      egg.helmetT = 0;
    }
    if (toast) toast(t(egg.msg));
  }

  function update(dt) {
    if (!state.active) return;
    state.time += dt;

    // Попадание: стрела остановилась у механизма или пасхалки.
    for (const a of arrows) {
      if (!a.stopped) continue;
      for (const g of gates) {
        if (g.open) continue;
        const r = g.variant === "keg" ? 1.5 : 1.1;
        if (a.mesh.position.subtract(g.targetPos).length() < r) openGate(g);
      }
      for (const egg of eggs) {
        if (egg.done) continue;
        if (a.mesh.position.subtract(egg.pos).length() < egg.r) takeEgg(egg);
      }
    }
    // Стрелы позади вагонетки больше не нужны — чистим, чтобы не копились.
    for (let i = arrows.length - 1; i >= 0; i--) {
      if (arrows[i].mesh.position.z < state.z - 10) {
        arrows[i].mesh.dispose();
        arrows.splice(i, 1);
      }
    }

    // Механизм: противовес падает, блок крутится, створка уезжает вверх.
    // Трос тянется за противовесом каждый кадр — и во время движения, и после
    // остановки, поэтому камень и верёвка никогда не расходятся.
    for (const g of gates) {
      if (g.open && g.openK < 1) {
        g.openK = Math.min(1, g.openK + dt / g.openTime);
        const k = g.openK * g.openK * (3 - 2 * g.openK);
        g.gRoot.position.y = FLOOR_Y + 6.1 * k;
        g.weight.position.y = g.weightY0 - 1.8 * k;
        g.pulley.rotation.z += dt * 9 * (1 - k);
        if (g.variant === "keg") g.gRoot.rotation.z = Math.sin(k * 22) * 0.035 * (1 - k);
      }
      ropeTo.set(g.weight.position.x, g.weight.position.y + 0.35, g.weight.position.z);
      stretchBetween(g.rope2, g.pulleyPos, ropeTo);
    }
    // Мигающее кольцо закрытых ворот — куда стрелять, видно издалека.
    const pulse = 0.55 + 0.45 * Math.sin(state.time * 5.5);
    for (const g of gates) {
      if (g.open) continue;
      g.marker.scaling.setAll(0.92 + 0.12 * pulse);
      g.markerMat.emissiveColor.set(1, 0.16 + 0.18 * pulse, 0.05);
      g.label.visibility = 0.75 + 0.25 * pulse;
    }

    // Тряска на разбитых путях + искры из-под колёс.
    const bump = BUMPS.find((b) => Math.abs(state.z - b.z) < b.len);
    let shake = 0;
    if (bump && state.speed > 2) {
      shake = 0.035;
      state.bumpT -= dt;
      if (state.bumpT <= 0) {
        state.bumpT = 0.22 + Math.random() * 0.2;
        const p = cart.position.clone();
        p.x += (Math.random() - 0.5) * 1.7;
        p.z += 0.9;
        sparksAt(scene, p, 7);
        if (Math.random() < 0.4) spawnPebble();
      }
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
    cart.rotation.z = Math.sin(state.bob * 1.3) * 0.012 + Math.sin(state.time * 41) * shake;
    cart.rotation.x = Math.sin(state.bob * 0.9) * 0.008;

    player.mesh.position.set(0, FLOOR_Y + 0.95 + bob, state.z);
    camera.position.set(
      Math.sin(state.time * 37) * shake * 0.8,
      FLOOR_Y + 1.55 + bob + Math.sin(state.time * 29) * shake * 0.5,
      state.z + 0.15);
    camera.rotation.set(player.st.pitch, player.st.yaw, 0);
    lamp.position.set(0, FLOOR_Y + 3.2 + bob, state.z + 4);

    // Пыль из-под вагонетки.
    dust.emitRate = Math.min(120, state.speed * 9);

    // Падающие камешки с крепи.
    state.pebbleT -= dt;
    if (state.speed > 1.5 && state.pebbleT <= 0) {
      state.pebbleT = (bump ? 0.5 : 1.4) + Math.random() * 1.4;
      spawnPebble();
    }
    for (let i = pebbles.length - 1; i >= 0; i--) {
      const p = pebbles[i];
      p.meta.vy -= 9.8 * dt;
      p.position.y += p.meta.vy * dt;
      p.rotation.x += dt * 4; p.rotation.z += dt * 3;
      if (p.position.y < FLOOR_Y + 0.08) {
        p.dispose(); pebbles.splice(i, 1);
      }
    }

    // Летучие мыши: тревожатся, когда вагонетка входит в их тоннель.
    const batsOn = state.z > 118 && state.z < 206;
    for (const b of bats) {
      b.setEnabled(batsOn);
      if (!batsOn) continue;
      const a = state.time * b.meta.speed + b.meta.phase;
      b.position.set(
        Math.cos(a) * b.meta.r,
        FLOOR_Y + b.meta.y + Math.sin(state.time * 3.1 + b.meta.phase) * 0.4,
        state.z + 4 + Math.sin(a * 0.7) * b.meta.r * 0.6);
      b.rotation.y = a + Math.PI / 2;
      b.scaling.x = 0.65 + Math.abs(Math.sin(state.time * 17 + b.meta.phase)) * 0.75;
    }

    // Пасхалки: канарейка улетает, каска падает со скелета.
    for (const egg of eggs) {
      if (egg.flyT !== null && egg.flyT !== undefined) {
        egg.flyT += dt;
        egg.bird.position.y += dt * 2.0;
        egg.bird.position.x += dt * 0.65;
        egg.bird.rotation.z = Math.sin(egg.flyT * 14) * 0.5;
        egg.bird.scaling.x = 0.7 + Math.abs(Math.sin(egg.flyT * 18)) * 0.9;
        if (egg.flyT > 2.2) { egg.bird.setEnabled(false); egg.flyT = null; }
      }
      if (egg.helmetT !== null && egg.helmetT !== undefined) {
        egg.helmetT += dt;
        egg.helmet.position.y -= dt * 0.9;
        egg.helmet.position.x += dt * 0.5;
        egg.helmet.rotation.z += dt * 5;
        if (egg.helmetT > 0.9) egg.helmetT = null;
      }
    }

    // Подсказка и HUD.
    const HINT = {
      pin: "Чека лебёдки держит створку — прострелите красный клин",
      lock: "Цепь заперта навесным замком — сбейте красный замок",
      keg: "Бочка пороха подпирает запор — подорвите её выстрелом",
    };
    state.hint = "";
    if (next) {
      const dist = next.z - state.z;
      if (state.speed < 0.3) state.hint = t("Ворота закрыты! {hint}", { hint: t(HINT[next.variant]) });
      else if (dist < 42) state.hint = t("Впереди ворота — {hint}", { hint: t(HINT[next.variant]) });
    }
    const opened = gates.filter((g) => g.open).length;
    const status = next
      ? t("Ворота {n} из {m} · {d} м",
        { n: next.index + 1, m: gates.length, d: Math.max(0, Math.round(next.z - state.z)) })
      : t("Ворота {n} из {m} · до выхода {d} м",
        { n: opened, m: gates.length, d: Math.max(0, Math.round(FINISH_Z - state.z)) });
    if (status !== lastStatus) {
      lastStatus = status;
      if (statusEl) statusEl.textContent = status;
    }

    if (state.z >= FINISH_Z) finish();
  }

  return {
    start,
    stop,
    update,
    get active() { return state.active; },
    get finished() { return state.finished; },
    get state() { return state; },
    get hint() { return state.hint; },
    light: lamp,
    gates,
    eggs,
    openGate,
  };
}
