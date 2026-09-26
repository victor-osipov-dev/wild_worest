// Террейн бесконечный как в terrain.gd: чанки 32м (tile 2м) догружаются вокруг
// игрока 5x5 (VIEW_RADIUS=2), дальние выгружаются. Растительность — по клеткам
// внутри чанка (оригинальный алгоритм: spacing/density/jitter/clear/slope).
// Всё через InstancedMesh + общие материалы (иначе Out of Memory).
// getHeight() из noise.js — единый источник высоты для игрока и мобов.
import * as BABYLON from "@babylonjs/core";
import { getHeight, cellHash, rand01, HOUSE_POS } from "./noise.js";
import { asset } from "./assets.js";

export const TILE = 2.0, CHUNK_TILES = 16, CHUNK_WORLD = 32, VIEW_RADIUS = 2;

// Запекание НАСТОЯЩИХ 3D-деревьев/кустов в спрайты-импостеры:
// те же шаблоны геометрии и материалов, тот же свет сцены — совпадение идеальное.
// Рендерим offscreen в RenderTargetTexture с прозрачным фоном, читаем пиксели,
// складываем варианты в атлас. При любой ошибке — null (фолбэк на рисованные).
function blitFlipped(ctx, px, w, h, dx, dy) {
  const img = ctx.createImageData(w, h);
  const row = w * 4;
  for (let y = 0; y < h; y++)
    img.data.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  ctx.putImageData(img, dx, dy);
}
// Самопроверка запекания: непрозрачные пиксели в зоне КРОНЫ.
// ВАЖНО: readPixels() отдаёт строки СНИЗУ вверх (OpenGL), поэтому крона —
// это ВЕРХНИЕ строки буфера, а не нижние. Раньше проверяли низ (ствол) и пропускали
// ячейки без листвы — теперь смотрим верхние 58% кадра.
function countCanopy(px, w, h) {
  const y0 = Math.floor(h * 0.42);
  let n = 0;
  for (let y = y0; y < h; y += 2) {
    const base = y * w * 4;
    for (let x = 3; x < w * 4; x += 32)
      if (px[base + x] > 10) n++;
  }
  return n;
}
function bakeImpostorAtlas(st) {
  const scene = st.scene;
  const SITE = new BABYLON.Vector3(2000, 0, 2000); // далеко от всего
  const bakedParts = [];
  try {
    // --- деревья: атлас 3 варианта (по оттенкам листвы) ---
    const treeRT = new BABYLON.RenderTargetTexture("bakeTree",
      { width: 128, height: 256 }, scene, false);
    treeRT.clearColor = new BABYLON.Color4(0, 0, 0, 0);
    treeRT.hasAlpha = true;
    // samplingMode у RenderTargetTexture только для чтения (геттер) — НЕ ставим.
    // Он и не нужен: RT мы только читаем через readPixels, в текстуру не сэмплируем.
    const treeCam = new BABYLON.UniversalCamera("bakeTreeCam",
      SITE.add(new BABYLON.Vector3(0, 2.1, 10)), scene);
    treeCam.fov = 0.48;
    treeCam.minZ = 0.1; treeCam.maxZ = 50;
    treeCam.setTarget(SITE.add(new BABYLON.Vector3(0, 2.1, 0)));
    treeRT.activeCamera = treeCam;
    // НЕ кладём RT в scene.customRenderTargets: рендерим сами через rtt.render()
    // с явным renderList. Через scene.render() в кадр попадала вся сцена целиком
    // (главная камера, другие RT) — часть вариантов теряла крону.
    const treeCanvas = document.createElement("canvas");
    treeCanvas.width = 512; treeCanvas.height = 256; // POT: 4 ячейки, используем 3
    const tctx = treeCanvas.getContext("2d");
    const LEAF_OFFS = [[0, 2.75, 0, 1.6], [0.1, 3.1, -0.1, 1.3], [-0.1, 3.45, 0.1, 1.0]];
    for (let v = 0; v < 3; v++) {
      const parts = [];
      const trunk = st.trunkTpl.createInstance("bt");
      trunk.position.set(SITE.x, SITE.y + 1.3, SITE.z);
      trunk.alwaysSelectAsActiveMesh = true; // мимо frustum-culling — точно в кадре
      parts.push(trunk);
      for (const [ox, oy, oz, d] of LEAF_OFFS) {
        const leaf = st.leafTpls[v].createInstance("bl");
        leaf.position.set(SITE.x + ox, SITE.y + oy, SITE.z + oz);
        leaf.scaling.setAll(d);
        leaf.alwaysSelectAsActiveMesh = true;
        parts.push(leaf);
      }
      bakedParts.push(...parts);
      treeRT.renderList = parts; // в кадр только это дерево
      treeRT.render();
      treeRT.render(); // второй проход — матрицы/шейдеры точно осели
      const px = treeRT.readPixels();
      parts.forEach((p) => p.dispose());
      if (!px) throw new Error("tree readPixels");
      if (countCanopy(px, 128, 256) < 90) throw new Error("tree variant " + v + " no canopy");
      blitFlipped(tctx, px, 128, 256, v * 128, 0);
    }
    treeRT.renderList = null;
    treeRT.dispose(); treeCam.dispose();
    // --- кусты: атлас 2 варианта ---
    const bushRT = new BABYLON.RenderTargetTexture("bakeBush",
      { width: 128, height: 128 }, scene, false);
    bushRT.clearColor = new BABYLON.Color4(0, 0, 0, 0);
    bushRT.hasAlpha = true;
    const bushCam = new BABYLON.UniversalCamera("bakeBushCam",
      SITE.add(new BABYLON.Vector3(0, 0.45, 10)), scene);
    bushCam.fov = 0.22; // кадр 1.2x1.1 с дистанции 10
    bushCam.minZ = 0.1; bushCam.maxZ = 50;
    bushCam.setTarget(SITE.add(new BABYLON.Vector3(0, 0.45, 0)));
    bushRT.activeCamera = bushCam;
    const bushCanvas = document.createElement("canvas");
    bushCanvas.width = 256; bushCanvas.height = 128;
    const bctx = bushCanvas.getContext("2d");
    const BUSH_OFFS = [[0, 0.4, 0, 0.8], [0.3, 0.3, 0.2, 0.6], [-0.3, 0.3, -0.15, 0.5]];
    for (let v = 0; v < 2; v++) {
      const parts = [];
      for (const [ox, oy, oz, d] of BUSH_OFFS) {
        const b = st.leafTpls[v].createInstance("bb");
        b.position.set(SITE.x + ox, SITE.y + oy, SITE.z + oz);
        b.scaling.setAll(d);
        b.alwaysSelectAsActiveMesh = true;
        parts.push(b);
      }
      bakedParts.push(...parts);
      bushRT.renderList = parts;
      bushRT.render();
      bushRT.render();
      const px = bushRT.readPixels();
      parts.forEach((p) => p.dispose());
      if (!px) throw new Error("bush readPixels");
      if (countCanopy(px, 128, 128) < 60) throw new Error("bush variant " + v + " blank");
      blitFlipped(bctx, px, 128, 128, v * 128, 0);
    }
    bushRT.renderList = null;
    bushRT.dispose(); bushCam.dispose();
    return { treeURL: treeCanvas.toDataURL("image/png"), bushURL: bushCanvas.toDataURL("image/png") };
  } catch (err) {
    for (const p of bakedParts) { try { p.dispose(); } catch { /* noop */ } }
    st.bakeError = String((err && err.message) || err);
    return null;
  }
}

// Процедурные текстуры импостеров для дальнего леса (фолбэк, если запекание упало).
// ВАЖНО: раскладка ячеек ИДЕНТИЧНА запечённому атласу — 3 дерева / 2 куста.
// Раньше фолбэк был одна ячейка 128px, а cellIndex продолжал брать 0..2: варианты
// 1 и 2 уезжали за пределы текстуры и рисовались пустыми («у некоторых нет листвы»).
function treeSpriteURL() {
  const c = document.createElement("canvas"); c.width = 512; c.height = 256;
  const g = c.getContext("2d");
  const tints = ["#1c2f13", "#22401a", "#2b5222"];
  for (let v = 0; v < 3; v++) {
    g.save(); g.translate(v * 128, 0);
    let seed = 21 + v * 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) | 0, ((seed >>> 0) % 1000) / 1000);
    g.fillStyle = "#33261a"; g.fillRect(58, 150, 12, 106); // ствол тёмный
    // Крона ЕДИНЫМ плоским силуэтом: никаких обводок, дуг и центров —
    // именно границы блобов давали «кружочки» и светлые пятна
    g.fillStyle = tints[v];
    const blobs = [[64, 60, 52], [40, 95, 38], [88, 95, 38], [64, 120, 44], [30, 130, 26], [98, 130, 26]];
    for (const [x, y, r] of blobs) {
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    for (let i = 0; i < 70; i++) { // редкий тёмный микрошум в тон
      g.fillStyle = rnd() < 0.5 ? "#16240f" : "#101d0b";
      g.beginPath(); g.arc(rnd() * 128, rnd() * 170, 1 + rnd() * 2, 0, 7); g.fill();
    }
    g.restore();
  }
  return c.toDataURL("image/png");
}
function bushSpriteURL() {
  const c = document.createElement("canvas"); c.width = 256; c.height = 128;
  const g = c.getContext("2d");
  const tints = ["#1c2f13", "#22401a"];
  for (let v = 0; v < 2; v++) {
    g.save(); g.translate(v * 128, 0);
    let seed = 33 + v * 11;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) | 0, ((seed >>> 0) % 1000) / 1000);
    g.fillStyle = tints[v];
    for (const [x, y, r] of [[64, 70, 44], [36, 85, 28], [92, 85, 28], [64, 50, 30]]) {
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    for (let i = 0; i < 60; i++) {
      g.fillStyle = rnd() < 0.5 ? "#16240f" : "#101d0b";
      g.beginPath(); g.arc(rnd() * 128, 30 + rnd() * 90, 1 + rnd() * 2, 0, 7); g.fill();
    }
    g.restore();
  }
  return c.toDataURL("image/png");
}

// Процедурная текстура листвы (общая на всех): тёмная база + светлые вкрапления.
// Убирает «пластилиновость» сфер без внешних ассетов.
function makeLeafTexture(scene) {
  const dt = new BABYLON.DynamicTexture("leafTex", 128, scene, true);
  const ctx = dt.getContext();
  ctx.fillStyle = "#ffffff"; // белый — оттенок задаёт diffuseColor
  ctx.fillRect(0, 0, 128, 128);
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) | 0, ((seed >>> 0) % 1000) / 1000);
  for (let i = 0; i < 700; i++) {
    const x = rnd() * 128, y = rnd() * 128, r = 1 + rnd() * 3.2;
    const v = rnd();
    ctx.fillStyle = v < 0.45 ? "#cfe0b8" : (v < 0.8 ? "#9db884" : "#5d7a4a");
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
  ctx.strokeStyle = "rgba(70,100,55,0.5)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 40; i++) {
    const x = rnd() * 128, y = rnd() * 128;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 22, y + (rnd() - 0.5) * 22); ctx.stroke();
  }
  dt.update();
  dt.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
  dt.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
  return dt;
}
const TREE_SPACING = 2.5, TREE_DENSITY = 0.42;
const BUSH_SPACING = 1.6, BUSH_DENSITY = 0.30;
const SPAWN_CLEAR = 26.0, HOUSE_CLEAR = 14.0;

export function initTerrain(scene) {
  const grassTex = new BABYLON.Texture(asset("assets/textures/grass_diff.jpg"), scene);
  grassTex.uScale = 1; grassTex.vScale = 1; // UV уже мировые (x/4) — тайл 4м
  grassTex.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
  grassTex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
  const mat = new BABYLON.StandardMaterial("grassMat", scene);
  mat.diffuseTexture = grassTex;
  mat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
  mat.backFaceCulling = false; // страховка от зеркального winding

  const birchTex = new BABYLON.Texture(asset("assets/textures/birch_bark.jpg"), scene);
  const trunkMat = new BABYLON.StandardMaterial("trunkMat", scene);
  trunkMat.diffuseTexture = birchTex;
  trunkMat.specularColor = new BABYLON.Color3(0.03, 0.03, 0.03); // кора матовая
  const leafTex = makeLeafTexture(scene);
  const leafMats = [0.25, 0.35, 0.45].map((dark, i) => {
    const m = new BABYLON.StandardMaterial(`leafMat${i}`, scene);
    m.diffuseColor = new BABYLON.Color3(0.16 * dark + 0.08, 0.35 * dark + 0.08, 0.14 * dark + 0.05);
    m.specularColor = new BABYLON.Color3(0, 0, 0); // без блеска
    m.diffuseTexture = leafTex;
    return m;
  });

  // Шаблоны (скрыты, только геометрия для инстансов).
  // Инстансы делят материал шаблона — поэтому 3 шаблона листвы под 3 оттенка.
  // alwaysSelectAsActiveMesh: при запекании рендер-мешем инстансов выступает
  // ШАБЛОН, и отсечение по фрустуму проверяется на нём — без флага листва
  // выпадала из кадра. Шаблоны выключены, на основной проход флаг не влияет.
  const trunkTpl = BABYLON.MeshBuilder.CreateCylinder("trunkTpl",
    { height: 2.6, diameterTop: 0.1, diameterBottom: 0.24, tessellation: 6 }, scene);
  trunkTpl.material = trunkMat;
  trunkTpl.alwaysSelectAsActiveMesh = true;
  trunkTpl.setEnabled(false);
  const leafTpls = leafMats.map((m, i) => {
    const t = BABYLON.MeshBuilder.CreateSphere(`leafTpl${i}`, { diameter: 1, segments: 6 }, scene);
    t.material = m;
    t.alwaysSelectAsActiveMesh = true;
    t.setEnabled(false);
    return t;
  });

  // Менеджеры спрайтов-импостеров: ВЕСЬ дальний лес = 2 draw call.
  // Текстура — запечённые настоящие 3D (3 варианта деревьев, 2 кустов);
  // если запекание не удалось — рисованный фолбэк.
  // Ёмкость с запасом: дальних чанков 16, деревьев ~25/чанк, кустов ~120/чанк.
  // Число используемых ячеек атласа: и запечённый, и фолбэк-атлас рисуются с этим layout.
  const st = {
    scene, mat, trunkTpl, leafTpls, chunks: new Map(), bakeError: null,
    treeCells: 3, bushCells: 2,
  };
  const baked = bakeImpostorAtlas(st);
  if (baked) { st.treeAtlasURL = baked.treeURL; st.bushAtlasURL = baked.bushURL; }
  const treeSM = new BABYLON.SpriteManager("treeSM",
    baked ? baked.treeURL : treeSpriteURL(), 600, { width: 128, height: 256 }, scene);
  const bushSM = new BABYLON.SpriteManager("bushSM",
    baked ? baked.bushURL : bushSpriteURL(), 2500, { width: 128, height: 128 }, scene);
  st.treeSM = treeSM; st.bushSM = bushSM;
  // Стартовые чанки вокруг спавна (0,-14) — сразу все, без поп-ина под меню
  updateTerrain(st, 0, -14);
  return st;
}

function chunkKey(cx, cz) { return cx + "," + cz; }

// Каждый кадр из main.js: догрузка вокруг игрока, выгрузка дальних.
// Строим ВСЁ недостающее сразу (как _reload_chunks в Godot): бюджет по 2 давал
// дыры без земли на границах — игрок проваливался. Постройка чанка дешёвая (~1мс).
export function updateTerrain(st, px, pz) {
  const ccx = Math.floor(px / CHUNK_WORLD), ccz = Math.floor(pz / CHUNK_WORLD);
  const want = new Set();
  const missing = [];
  for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
    for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz++) {
      const cx = ccx + dx, cz = ccz + dz;
      const k = chunkKey(cx, cz);
      want.add(k);
      if (!st.chunks.has(k)) missing.push([cx, cz, dx * dx + dz * dz]);
    }
  }
  for (const [k, ch] of st.chunks) {
    if (!want.has(k)) { disposeChunk(ch); st.chunks.delete(k); continue; }
    // Чанк был построен дальним (без кустов, редкие деревья), а игрок подошёл —
    // перестроить в полном качестве (и наоборот)
    const [chx, chz] = k.split(",").map(Number);
    const wantFar = Math.max(Math.abs(chx - ccx), Math.abs(chz - ccz)) > 1;
    if (ch.far !== wantFar) missing.push([chx, chz, 0]);
  }
  if (!missing.length) return;
  missing.sort((a, b) => a[2] - b[2]);
  for (const [cx, cz] of missing) {
    const k = chunkKey(cx, cz);
    if (st.chunks.has(k)) { disposeChunk(st.chunks.get(k)); st.chunks.delete(k); }
    st.chunks.set(k, buildChunk(st, cx, cz,
      Math.max(Math.abs(cx - ccx), Math.abs(cz - ccz)) > 1));
  }
}

function disposeChunk(ch) {
  ch.ground.dispose();
  for (const n of ch.nodes) n.dispose();
  for (const s of ch.sprites) s.dispose();
}

function buildChunk(st, cx, cz, far = false) {
  const { scene } = st;
  // CreateGround даёт гарантированно правильный winding (+Y),
  // затем сдвигаем вершины по getHeight() и пересчитываем нормали.
  const ground = BABYLON.MeshBuilder.CreateGround(`chunk_${cx}_${cz}`,
    { width: CHUNK_WORLD, height: CHUNK_WORLD, subdivisions: CHUNK_TILES }, scene);
  const cxw = cx * CHUNK_WORLD, czw = cz * CHUNK_WORLD;
  ground.position.set(cxw, 0, czw);
  const pos = ground.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  const uv = ground.getVerticesData(BABYLON.VertexBuffer.UVKind);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i] + cxw, z = pos[i + 2] + czw;
    pos[i + 1] = getHeight(x, z);
    uv[(i / 3) * 2] = x / 4;
    uv[(i / 3) * 2 + 1] = z / 4;
  }
  // setVerticesData(..., updatable=true): updateVerticesData молча дропается
  // на статических буферах MeshBuilder. setVerticesData пересоздаёт буфер и грузит на GPU.
  ground.setVerticesData(BABYLON.VertexBuffer.PositionKind, pos, true);
  ground.setVerticesData(BABYLON.VertexBuffer.UVKind, uv, true);
  const normals = [];
  BABYLON.VertexData.ComputeNormals(pos, ground.getIndices(), normals);
  ground.setVerticesData(BABYLON.VertexBuffer.NormalKind, normals, true);
  ground.refreshBoundingInfo();
  ground.material = st.mat;
  ground.checkCollisions = true;
  ground.isPickable = true;
  ground.metadata = { kind: "terrain" };
  ground.freezeWorldMatrix();

  const ch = { cx, cz, far, ground, nodes: [], sprites: [], visible: true };
  populateTrees(st, ch, cxw, czw, far);
  populateBushes(st, ch, cxw, czw, far);
  return ch;
}

// Не отображать чанки, которые камера не видит: только ВНЕШНЕЕ кольцо (chebyshev>=2
// от чанка игрока — земля под ногами и соседи не гаснут никогда) + позади камеры.
// Видимое frustum-culling и так отсекает, это сверху снимает нагрузку с CPU-обхода.
const _toChunk = new BABYLON.Vector3();
const _camDir = new BABYLON.Vector3();
export function cullTerrainChunks(st, camPos, camFwd, pcx, pcz) {
  _camDir.copyFrom(camFwd);
  for (const [, ch] of st.chunks) {
    if (Math.max(Math.abs(ch.cx - pcx), Math.abs(ch.cz - pcz)) < 2) {
      if (!ch.visible) { ch.visible = true; setChunkVisible(ch, true); }
      continue;
    }
    _toChunk.set(
      ch.cx * CHUNK_WORLD + CHUNK_WORLD / 2 - camPos.x, 0,
      ch.cz * CHUNK_WORLD + CHUNK_WORLD / 2 - camPos.z);
    const proj = _toChunk.x * _camDir.x + _toChunk.z * _camDir.z;
    const behind = proj < -24;
    if (behind === !ch.visible) continue; // уже в нужном состоянии
    ch.visible = !behind;
    setChunkVisible(ch, ch.visible);
  }
}
function setChunkVisible(ch, v) {
  ch.ground.setEnabled(v);
  for (const n of ch.nodes) n.setEnabled(v);
  for (const sp of ch.sprites) { // спрайты прячем нулевым размером
    if (v) { sp.width = sp._w; sp.height = sp._h; }
    else { sp.width = 0.0001; sp.height = 0.0001; }
  }
}

function clearOfSpawn(x, z) {
  if (Math.hypot(x, z) < SPAWN_CLEAR) return false;
  if (Math.hypot(x - HOUSE_POS.x, z - HOUSE_POS.z) < HOUSE_CLEAR) return false;
  return true;
}

function slopeAt(x, z) {
  const e = 0.6;
  return Math.hypot(
    (getHeight(x + e, z) - getHeight(x - e, z)) / (2 * e),
    (getHeight(x, z + e) - getHeight(x, z - e)) / (2 * e));
}

// Детерминированный ГСЧ клетки (аналог _cell_rng): один сид на всё — лес тот же каждый запуск
function cellRng(gx, gz, salt) {
  return { s: ((cellHash(gx + salt * 57, gz - salt * 31) * 2147483647) | 0) || 1 };
}

function populateTrees(st, ch, ox, oz, far = false) {
  const minCx = Math.floor(ox / TREE_SPACING), maxCx = Math.floor((ox + CHUNK_WORLD) / TREE_SPACING);
  const minCz = Math.floor(oz / TREE_SPACING), maxCz = Math.floor((oz + CHUNK_WORLD) / TREE_SPACING);
  const density = far ? TREE_DENSITY / 3 : TREE_DENSITY; // дальний лес реже
  for (let gz = minCz; gz <= maxCz; gz++) {
    for (let gx = minCx; gx <= maxCx; gx++) {
      const rng = cellRng(gx, gz, 1);
      if (rand01(rng) > density) continue;
      const px = (gx + (rand01(rng) - 0.5) * 0.4) * TREE_SPACING;
      const pz = (gz + (rand01(rng) - 0.5) * 0.4) * TREE_SPACING;
      if (!clearOfSpawn(px, pz)) continue;
      if (slopeAt(px, pz) > 2.5) continue;
      const s = 0.7 + rand01(rng) * 0.7;
      const y = getHeight(px, pz);
      if (far) addTreeSprite(st, ch, px, y, pz, s, Math.abs(Math.round(px * 3 + pz)) % 3);
      else makeTreeInst(st, ch, px, y, pz, s, rand01(rng) * Math.PI * 2);
    }
  }
}

function populateBushes(st, ch, ox, oz, far = false) {
  const minCx = Math.floor(ox / BUSH_SPACING), maxCx = Math.floor((ox + CHUNK_WORLD) / BUSH_SPACING);
  const minCz = Math.floor(oz / BUSH_SPACING), maxCz = Math.floor((oz + CHUNK_WORLD) / BUSH_SPACING);
  for (let gz = minCz; gz <= maxCz; gz++) {
    for (let gx = minCx; gx <= maxCx; gx++) {
      const rng = cellRng(gx, gz, 2);
      if (rand01(rng) > BUSH_DENSITY) continue;
      const px = (gx + (rand01(rng) - 0.5) * 0.5) * BUSH_SPACING;
      const pz = (gz + (rand01(rng) - 0.5) * 0.5) * BUSH_SPACING;
      if (!clearOfSpawn(px, pz)) continue;
      if (slopeAt(px, pz) > 3.0) continue;
      const s = 0.6 + rand01(rng) * 0.55;
      const y = getHeight(px, pz);
      if (far) addBushSprite(st, ch, px, y, pz, s, Math.abs(Math.round(px * 5 + pz * 2)) % 2);
      else makeBushInst(st, ch, px, y, pz, s);
    }
  }
}

// Импостеры: те же позиции/масштабы, что у 3D — переход незаметен.
// cellIndex = запечённый вариант (тот же оттенок, что выбрало бы 3D).
// Индекс берётся по модулю числа ячеек, поэтому даже при фолбэке атласа
// спрайт не вылезет за пределы текстуры (и не станет пустым).
function addTreeSprite(st, ch, x, y, z, s, v) {
  if (st.treeSM.sprites.length >= 590) return;
  const sp = new BABYLON.Sprite("ftree", st.treeSM);
  sp.position.set(x, y + 2.0 * s, z);
  sp.width = sp._w = 2.4 * s; sp.height = sp._h = 4.4 * s;
  sp.cellIndex = ((v % st.treeCells) + st.treeCells) % st.treeCells;
  ch.sprites.push(sp);
}
function addBushSprite(st, ch, x, y, z, s, v) {
  if (st.bushSM.sprites.length >= 2490) return;
  const sp = new BABYLON.Sprite("fbush", st.bushSM);
  sp.position.set(x, y + 0.35 * s, z);
  sp.width = sp._w = 1.1 * s; sp.height = sp._h = 0.8 * s;
  sp.cellIndex = ((v % st.bushCells) + st.bushCells) % st.bushCells;
  ch.sprites.push(sp);
}

function makeTreeInst(st, ch, x, y, z, s, rotY) {
  const trunk = st.trunkTpl.createInstance(`trunk`);
  trunk.position.set(x, y + 1.3 * s, z);
  trunk.scaling.setAll(s);
  trunk.rotation.y = rotY;
  trunk.isPickable = true;
  trunk.checkCollisions = true;
  trunk.metadata = { kind: "tree" };
  ch.nodes.push(trunk);
  const leafTpl = st.leafTpls[Math.abs(Math.round(x * 3 + z)) % 3];
  [[0, 2.75, 0, 1.6], [0.1, 3.1, -0.1, 1.3], [-0.1, 3.45, 0.1, 1.0]].forEach(([ox, oy, oz, d]) => {
    const leaf = leafTpl.createInstance(`leaf`);
    const ca = Math.cos(rotY), sa = Math.sin(rotY);
    leaf.position.set(x + (ox * ca - oz * sa) * s, y + oy * s, z + (ox * sa + oz * ca) * s);
    leaf.scaling.setAll(d * s);
    leaf.isPickable = false;
    ch.nodes.push(leaf);
  });
}

function makeBushInst(st, ch, x, y, z, s) {
  const leafTpl = st.leafTpls[Math.abs(Math.round(x * 5 + z * 2)) % 3];
  [[0, 0.4, 0, 0.8], [0.3, 0.3, 0.2, 0.6], [-0.3, 0.3, -0.15, 0.5]].forEach(([ox, oy, oz, d]) => {
    const b = leafTpl.createInstance(`bush`);
    b.position.set(x + ox * s, y + oy * s, z + oz * s);
    b.scaling.setAll(d * s);
    b.isPickable = false;
    ch.nodes.push(b);
  });
}
