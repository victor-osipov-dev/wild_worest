// Террейн бесконечный как в terrain.gd: чанки 32м (tile 2м) догружаются вокруг
// игрока 5x5 (VIEW_RADIUS=2), дальние выгружаются. Растительность — по клеткам
// внутри чанка (оригинальный алгоритм: spacing/density/jitter/clear/slope).
// Всё через InstancedMesh + общие материалы (иначе Out of Memory).
// getHeight() из noise.js — единый источник высоты для игрока и мобов.
import * as BABYLON from "@babylonjs/core";
import { getHeight, cellHash, rand01, HOUSE_POS } from "./noise.js";
import { asset } from "./assets.js";

export const TILE = 2.0, CHUNK_TILES = 16, CHUNK_WORLD = 32, VIEW_RADIUS = 2;

// Импостеры дальнего леса.
// SpriteManager билбордил карточку ЦЕЛИКОМ — в плоскость камеры и вокруг её
// центра, — поэтому при наклоне камеры деревья заваливались и не стояли ровно
// на земле. Вместо спрайтов: одна слитая карточка на чанк + шейдер, который
// доворачивает КАЖДУЮ карточку только по yaw вокруг ЕЁ основания (чистый
// Y-billboard): карточка всегда вертикальна и всегда стоит там, где посадили.
BABYLON.Effect.ShadersStore["impostorVertexShader"] = `
attribute vec3 position;
attribute vec2 uv;
attribute vec3 anchor;
uniform mat4 view;
uniform mat4 viewProjection;
varying vec2 vUV;
#include<fogVertexDeclaration>
void main() {
  // Первая строка view-матрицы = ось X камеры в мировых координатах (право
  // экрана). Обнуляем Y — карточка не должна наклоняться вместе с камерой.
  vec3 right = vec3(view[0][0], view[1][0], view[2][0]);
  right.y = 0.0;
  vec3 d = position - anchor; // плоская заготовка карточки: (u, v, 0)
  vec3 worldPos = anchor + right * d.x + vec3(0.0, 1.0, 0.0) * d.y;
  gl_Position = viewProjection * vec4(worldPos, 1.0);
  vUV = uv;
#ifdef FOG
  vFogDistance = (view * vec4(worldPos, 1.0)).xyz;
#endif
}
`;
BABYLON.Effect.ShadersStore["impostorFragmentShader"] = `
uniform sampler2D map;
varying vec2 vUV;
#include<fogFragmentDeclaration>
void main() {
  vec4 color = texture2D(map, vUV);
  if (color.a < 0.5) discard;
#ifdef FOG
  color.rgb = mix(vFogColor, color.rgb, CalcFogFactor());
#endif
  gl_FragColor = color;
#include<imageProcessingCompatibility>
}
`;

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
// Alpha-bleed: растекание цвета в прозрачные тексели вокруг силуэта.
// Без него билинейная фильтрация на дальней дистанции смешивает зелёный с ЧЁРНЫМ
// (rgb=0 под a=0) и альфа-тест превращает край в чёрные точки. Альфа не трогаем —
// после размывания такие тексели всё равно отбрасываются тестом.
function bleedAlpha(ctx, w, h, passes = 3) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let p = 0; p < passes; p++) {
    const prev = new Uint8ClampedArray(d);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (prev[i + 3] >= 16) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const j = (yy * w + xx) * 4;
            if (prev[j + 3] < 240) continue;
            r += prev[j]; g += prev[j + 1]; b += prev[j + 2]; n++;
          }
        }
        if (!n) continue;
        d[i] = r / n; d[i + 1] = g / n; d[i + 2] = b / n;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
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
    bleedAlpha(tctx, 512, 256);
    bleedAlpha(bctx, 256, 128);
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
    // Микрошум ТОЛЬКО по силуэту: source-atop гасит точечки, выпавшие в пустоту —
    // иначе они рисуются отдельными тёмными точками вокруг дерева («чёрные точки»).
    g.globalCompositeOperation = "source-atop";
    for (let i = 0; i < 70; i++) {
      g.fillStyle = rnd() < 0.5 ? "#16240f" : "#101d0b";
      g.beginPath(); g.arc(rnd() * 128, rnd() * 170, 1 + rnd() * 2, 0, 7); g.fill();
    }
    g.globalCompositeOperation = "source-over";
    g.restore();
  }
  bleedAlpha(g, 512, 256);
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
    g.globalCompositeOperation = "source-atop"; // микрошум — только внутри силуэта
    for (let i = 0; i < 60; i++) {
      g.fillStyle = rnd() < 0.5 ? "#16240f" : "#101d0b";
      g.beginPath(); g.arc(rnd() * 128, 30 + rnd() * 90, 1 + rnd() * 2, 0, 7); g.fill();
    }
    g.globalCompositeOperation = "source-over";
    g.restore();
  }
  bleedAlpha(g, 256, 128);
  return c.toDataURL("image/png");
}

// Материал импостеров: как у SpriteManager — без мипов и без инверсии
// (v=0 — верхняя строка картинки), туман сцены берём тот же, что у спрайтов.
// Альфа-тест вместо блендинга: карточка пишет глубину и не требует сортировки.
function makeImpostorMaterial(scene, name, url) {
  const fogOn = scene.fogEnabled && scene.fogMode !== BABYLON.Scene.FOGMODE_NONE;
  const m = new BABYLON.ShaderMaterial(name, scene,
    { vertex: "impostor", fragment: "impostor" }, {
      attributes: ["position", "uv", "anchor"],
      uniforms: ["view", "viewProjection", "vFogInfos", "vFogColor"],
      samplers: ["map"],
      defines: fogOn ? ["FOG"] : [],
    });
  m.setTexture("map",
    new BABYLON.Texture(url, scene, true, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE));
  if (fogOn) {
    m.setVector4("vFogInfos",
      new BABYLON.Vector4(scene.fogMode, scene.fogStart, scene.fogEnd, scene.fogDensity));
    m.setColor3("vFogColor", scene.fogColor);
  }
  m.backFaceCulling = false; // карточку видно с любой стороны
  m.transparencyMode = BABYLON.Material.MATERIAL_ALPHATEST;
  return m;
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

  // Материалы импостеров дальнего леса: ВЕСЬ дальний лес = 1 draw call на чанк
  // (одна слитая карточка для деревьев + одна для кустов).
  // Текстура — запечённые настоящие 3D (3 варианта деревьев, 2 кустов);
  // если запекание не удалось — рисованный фолбэк.
  // Раскладка атласа: 4 колонки по 128px на 512 у деревьев (3 из 4 заняты),
  // 2 колонки на 256 у кустов; строка одна — v идёт от верха картинки к низу.
  const st = {
    scene, mat, trunkTpl, leafTpls, chunks: new Map(), bakeError: null,
    treeCells: 3, bushCells: 2, treeCols: 4, bushCols: 2,
  };
  const baked = bakeImpostorAtlas(st);
  if (baked) { st.treeAtlasURL = baked.treeURL; st.bushAtlasURL = baked.bushURL; }
  st.treeMat = makeImpostorMaterial(scene, "impostorTreeMat",
    baked ? baked.treeURL : treeSpriteURL());
  st.bushMat = makeImpostorMaterial(scene, "impostorBushMat",
    baked ? baked.bushURL : bushSpriteURL());
  // Стартовые чанки вокруг спавна (0,-14) — сразу все, без поп-ина под меню
  updateTerrain(st, 0, -14);
  return st;
}

function chunkKey(cx, cz) { return cx + "," + cz; }

// Конус взгляда фида: грузим землю/лес ВПЕРЁД по направлению камеры монитора,
// дальше кольца ±80м. Сектором на ВЕСЬ горизонтальный fov (110° вертикальный при
// RT 480x270 → ±68.5°) + запас: иначе боковые thirds экрана дальше80м остаются
// пустыми при любом повороте. Глубина224м — туман EXP2 0.008 к250м почти
// непрозрачен, край сектора в дымке. FEED_RETAIN: чанки вокруг фида не
// выгружаем, чтобы повороты туда-сюда не перестраивали их заново (~1мс на чанк).
const CONE_DEPTH = 7;
const CONE_HALF = 74 * Math.PI / 180; // 68.5° (полу-fov) + 5.5° запас на поворот
const FEED_RETAIN = 8;
const FEED_FULL_R = 1; // 3x3 вокруг фида — полное 3D-качество (как у игрока),
// иначе у фида вместо леса плоские спрайты-импостеры: wantFar раньше смотрел
// только на игрока, и стоило отойти к монитору — лес у камеры схлопывался.
const CHUNK_HALF_DIAG = (CHUNK_WORLD * Math.SQRT2) / 2;

// Каждый кадр из main.js: догрузка вокруг игрока, вокруг активной камеры
// монитора (ex, ez — второй центр; без него в кадре фида дыры в земле) и
// конусом вдоль её взгляда (efx, efz), выгрузка дальних. Строим ВСЁ
// недостающее сразу (как _reload_chunks в Godot): бюджет по 2 давал
// дыры без земли на границах — игрок проваливался. Постройка чанка ~1мс.
export function updateTerrain(st, px, pz, ex, ez, efx, efz) {
  const ccx = Math.floor(px / CHUNK_WORLD), ccz = Math.floor(pz / CHUNK_WORLD);
  const want = new Set();
  const missing = [];
  const add = (cx, cz) => {
    const k = chunkKey(cx, cz);
    if (want.has(k)) return;
    want.add(k);
    if (!st.chunks.has(k)) {
      const rx = cx - ccx, rz = cz - ccz;
      missing.push([cx, cz, rx * rx + rz * rz]); // ближе к игроку — строим раньше
    }
  };
  const ring = (ecx, ecz) => {
    for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++)
      for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz++)
        add(ecx + dx, ecz + dz);
  };
  ring(ccx, ccz);
  const hasFeed = ex !== null && ex !== undefined;
  let fcx = 0, fcz = 0;
  if (hasFeed) {
    fcx = Math.floor(ex / CHUNK_WORLD); fcz = Math.floor(ez / CHUNK_WORLD);
    ring(fcx, fcz);
    const fl = Math.hypot(efx, efz);
    if (fl > 1e-6) {
      const fx = efx / fl, fz = efz / fl;
      // Полярный сектор: чанк попадает, если его центр ближе maxR к камере и
      // угол к оси взгляда меньше CONE_HALF. Запас atan(полудиагональ/дистанция):
      // у чанка, у которого в fov угла только, грузим весь — иначе ступеньки.
      const maxR = CONE_DEPTH * CHUNK_WORLD + CHUNK_HALF_DIAG;
      const lim2 = maxR * maxR;
      const rmax = CONE_DEPTH + 1;
      for (let cx = fcx - rmax; cx <= fcx + rmax; cx++) {
        for (let cz = fcz - rmax; cz <= fcz + rmax; cz++) {
          const mx = cx * CHUNK_WORLD + CHUNK_WORLD / 2 - ex;
          const mz = cz * CHUNK_WORLD + CHUNK_WORLD / 2 - ez;
          const d2 = mx * mx + mz * mz;
          if (d2 > lim2) continue;
          const d = Math.sqrt(d2);
          if (d > 1e-3) {
            const cos = (mx * fx + mz * fz) / d;
            const ang = Math.acos(cos < -1 ? -1 : cos > 1 ? 1 : cos);
            if (ang > CONE_HALF + Math.atan2(CHUNK_HALF_DIAG, d)) continue;
          }
          add(cx, cz);
        }
      }
    }
  }
  for (const [k, ch] of st.chunks) {
    if (!want.has(k)) {
      const near = hasFeed &&
        Math.max(Math.abs(ch.cx - fcx), Math.abs(ch.cz - fcz)) <= FEED_RETAIN;
      if (near) continue; // удержание: конус свернул — чанки на своём месте
      disposeChunk(ch); st.chunks.delete(k); continue;
    }
    // Чанк был построен дальним (спрайты), а игрок вошёл в него — перестроить
    // в полном качестве (и наоборот). Полное качество — чанк игрока И кольцо
    // вокруг активной камеры фида (FEED_FULL_R): иначе у фида вместо леса
    // плоские спрайты-импостеры. Дальше колец — 2D-спрайты (жёсткая
    // оптимизация: ~9x меньше инстансов).
    const [chx, chz] = k.split(",").map(Number);
    const feedFull = hasFeed &&
      Math.max(Math.abs(chx - fcx), Math.abs(chz - fcz)) <= FEED_FULL_R;
    const wantFar = Math.max(Math.abs(chx - ccx), Math.abs(chz - ccz)) > 0 && !feedFull;
    if (ch.far !== wantFar) missing.push([chx, chz, 0]);
  }
  if (!missing.length) return;
  missing.sort((a, b) => a[2] - b[2]);
  for (const [cx, cz] of missing) {
    const k = chunkKey(cx, cz);
    if (st.chunks.has(k)) { disposeChunk(st.chunks.get(k)); st.chunks.delete(k); }
    const feedFull = hasFeed &&
      Math.max(Math.abs(cx - fcx), Math.abs(cz - fcz)) <= FEED_FULL_R;
    st.chunks.set(k, buildChunk(st, cx, cz,
      Math.max(Math.abs(cx - ccx), Math.abs(cz - ccz)) > 0 && !feedFull));
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

  const ch = {
    cx, cz, far, ground, nodes: [], sprites: [], visible: true,
    cards: { tree: [], bush: [] }, treePts: [],
  };
  populateTrees(st, ch, cxw, czw, far);
  populateBushes(st, ch, cxw, czw, far);
  buildImpostorChunk(st, ch);
  return ch;
}

// Не отображать чанки, которые камера не видит: только ВНЕШНЕЕ кольцо (chebyshev>=2
// от чанка игрока — земля под ногами и соседи не гаснут никогда) + позади камеры.
// Видимое frustum-culling и так отсекает, это сверху снимает нагрузку с CPU-обхода.
// feedPos/feedFwd (кадр монитора): кольцо вокруг фида не гасим, чанк гасим только
// если он позади ОБЕИХ камер — иначе в кадре фида дыры в земле.
const _toChunk = new BABYLON.Vector3();
const _camDir = new BABYLON.Vector3();
const _feedDir = new BABYLON.Vector3();
export function cullTerrainChunks(st, camPos, camFwd, pcx, pcz, feedPos, feedFwd) {
  _camDir.copyFrom(camFwd);
  const hasFeed = !!(feedPos && feedFwd);
  let ffcx = 0, ffcz = 0;
  if (hasFeed) {
    _feedDir.copyFrom(feedFwd);
    ffcx = Math.floor(feedPos.x / CHUNK_WORLD);
    ffcz = Math.floor(feedPos.z / CHUNK_WORLD);
  }
  const keepVisible = (ch) => {
    if (!ch.visible) { ch.visible = true; setChunkVisible(ch, true); }
  };
  for (const [, ch] of st.chunks) {
    if (Math.max(Math.abs(ch.cx - pcx), Math.abs(ch.cz - pcz)) < 2) { keepVisible(ch); continue; }
    if (hasFeed && Math.max(Math.abs(ch.cx - ffcx), Math.abs(ch.cz - ffcz)) < 2) { keepVisible(ch); continue; }
    _toChunk.set(
      ch.cx * CHUNK_WORLD + CHUNK_WORLD / 2 - camPos.x, 0,
      ch.cz * CHUNK_WORLD + CHUNK_WORLD / 2 - camPos.z);
    let behind = _toChunk.x * _camDir.x + _toChunk.z * _camDir.z < -24;
    if (behind && hasFeed) {
      _toChunk.set(
        ch.cx * CHUNK_WORLD + CHUNK_WORLD / 2 - feedPos.x, 0,
        ch.cz * CHUNK_WORLD + CHUNK_WORLD / 2 - feedPos.z);
      behind = _toChunk.x * _feedDir.x + _toChunk.z * _feedDir.z < -24;
    }
    if (behind === !ch.visible) continue; // уже в нужном состоянии
    ch.visible = !behind;
    setChunkVisible(ch, ch.visible);
  }
}
function setChunkVisible(ch, v) {
  ch.ground.setEnabled(v);
  for (const n of ch.nodes) n.setEnabled(v);
  for (const sp of ch.sprites) sp.setEnabled(v); // слитые карточки-импостеры
}

// Мягкая коллизия со стволами по чанкам игрока (3x3): спрайты-деревья в
// кольце не имеют физических мешей, поэтому выталкиваем позицию сами.
// Радиус = полуствол + радиус эллипсоида игрока; выталкиваем только XZ.
export function pushOutOfTrees(st, pos) {
  if (pos.y < -10) return pos; // пещера/яма: стволы живут на поверхности
  const pcx = Math.floor(pos.x / CHUNK_WORLD), pcz = Math.floor(pos.z / CHUNK_WORLD);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const ch = st.chunks.get(chunkKey(pcx + dx, pcz + dz));
      if (!ch || !ch.treePts.length) continue;
      for (let i = 0; i < ch.treePts.length; i++) {
        const t = ch.treePts[i];
        const ddx = pos.x - t.x, ddz = pos.z - t.z;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 >= t.r2 || d2 < 1e-9) continue;
        const d = Math.sqrt(d2);
        const k = (t.r - d) / d;
        pos.x += ddx * k;
        pos.z += ddz * k;
      }
    }
  }
  return pos;
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
      // Мягкая коллизия игрока: спрайты-деревья сами не коллят, а тонкий
      // ствол-инстанс в своём чанке есть — радиус одинаков, чтобы не спорили.
      const r = 0.12 * s + 0.35;
      ch.treePts.push({ x: px, z: pz, r, r2: r * r });
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
// карточка не вылезет за пределы текстуры (и не станет пустой).
// Карточки копим на чанк, mesh'ы строит buildImpostorChunk. Жёсткого лимита
// больше нет: дальних чанков всего 16 — ~400 деревьев и ~1900 кустов на лес.
function addTreeSprite(st, ch, x, y, z, s, v) {
  const h = 4.4 * s;
  ch.cards.tree.push({
    x, z, y: y + 2.0 * s - h / 2, w: 2.4 * s, h,
    cell: ((v % st.treeCells) + st.treeCells) % st.treeCells,
  });
}
function addBushSprite(st, ch, x, y, z, s, v) {
  const h = 0.8 * s;
  ch.cards.bush.push({
    x, z, y: y + 0.35 * s - h / 2, w: 1.1 * s, h,
    cell: ((v % st.bushCells) + st.bushCells) % st.bushCells,
  });
}

// Одна слитая карточка на чанк и на тип (1 draw call). Позиции — мировые,
// база карточки (anchor) лежит отдельно: по ней шейдер доворачивает карточку
// по yaw вокруг основания. Габарит по Z считаем как ±w/2, а не 0 — карточка
// вращается вокруг основания и из плоской заготовки вылезает за её пределы.
function buildImpostorChunk(st, ch) {
  for (const kind of ["tree", "bush"]) {
    const cards = ch.cards[kind];
    if (!cards.length) continue;
    const cols = kind === "tree" ? st.treeCols : st.bushCols;
    const positions = [], uvs = [], anchors = [], normals = [], indices = [];
    const min = new BABYLON.Vector3(Infinity, Infinity, Infinity);
    const max = new BABYLON.Vector3(-Infinity, -Infinity, -Infinity);
    for (const c of cards) {
      const b = positions.length / 3;
      const x0 = c.x - c.w / 2, x1 = c.x + c.w / 2, y1 = c.y + c.h;
      positions.push(x0, y1, c.z, x1, y1, c.z, x0, c.y, c.z, x1, c.y, c.z);
      for (let i = 0; i < 4; i++) { anchors.push(c.x, c.y, c.z); normals.push(0, 0, -1); }
      const u0 = c.cell / cols, u1 = (c.cell + 1) / cols;
      uvs.push(u0, 0, u1, 0, u0, 1, u1, 1);
      indices.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
      if (x0 < min.x) min.x = x0;
      if (x1 > max.x) max.x = x1;
      if (c.y < min.y) min.y = c.y;
      if (y1 > max.y) max.y = y1;
      if (c.z - c.w / 2 < min.z) min.z = c.z - c.w / 2;
      if (c.z + c.w / 2 > max.z) max.z = c.z + c.w / 2;
    }
    const mesh = new BABYLON.Mesh(`${kind}Imp_${ch.cx}_${ch.cz}`, st.scene);
    const vd = new BABYLON.VertexData();
    vd.positions = positions; vd.uvs = uvs; vd.normals = normals; vd.indices = indices;
    vd.applyToMesh(mesh);
    // stride обязателен: у нестандартного kind нет DeduceStride
    mesh.setVerticesData("anchor", anchors, false, 3);
    mesh.setBoundingInfo(new BABYLON.BoundingInfo(min, max));
    mesh.material = kind === "tree" ? st.treeMat : st.bushMat;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.freezeWorldMatrix();
    ch.sprites.push(mesh);
  }
}

function makeTreeInst(st, ch, x, y, z, s, rotY) {
  const trunk = st.trunkTpl.createInstance(`trunk`);
  trunk.position.set(x, y + 1.3 * s, z);
  trunk.scaling.setAll(s);
  trunk.rotation.y = rotY;
  trunk.isPickable = true;
  trunk.checkCollisions = true;
  trunk.metadata = { kind: "tree" };
  // Статика: без пересчёта world matrix каждый кадр (тысячи инстансов)
  trunk.freezeWorldMatrix();
  ch.nodes.push(trunk);
  const leafTpl = st.leafTpls[Math.abs(Math.round(x * 3 + z)) % 3];
  [[0, 2.75, 0, 1.6], [0.1, 3.1, -0.1, 1.3], [-0.1, 3.45, 0.1, 1.0]].forEach(([ox, oy, oz, d]) => {
    const leaf = leafTpl.createInstance(`leaf`);
    const ca = Math.cos(rotY), sa = Math.sin(rotY);
    leaf.position.set(x + (ox * ca - oz * sa) * s, y + oy * s, z + (ox * sa + oz * ca) * s);
    leaf.scaling.setAll(d * s);
    leaf.isPickable = false;
    leaf.freezeWorldMatrix();
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
    b.freezeWorldMatrix();
    ch.nodes.push(b);
  });
}
