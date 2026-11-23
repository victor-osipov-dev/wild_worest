// Террейн бесконечный как в terrain.gd: чанки 32м (tile 2м) догружаются вокруг
// игрока 9x9 (VIEW_RADIUS=4), дальние выгружаются. Растительность — по клеткам
// внутри чанка (оригинальный алгоритм: spacing/density/jitter/clear/slope).
// Всё через InstancedMesh + общие материалы (иначе Out of Memory).
// getHeight() из noise.js — единый источник высоты для игрока и мобов.
import * as BABYLON from "@babylonjs/core";
import { getHeight, cellHash, rand01, HOUSE_POS, PIT_CENTER, PIT_R, PIT_EDGE } from "./noise.js";
import { asset } from "./assets.js";

export const TILE = 2.0, CHUNK_TILES = 8, CHUNK_WORLD = 16, VIEW_RADIUS = 4, TREE_3D_R = 1;

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
attribute vec3 tint;
uniform mat4 view;
uniform mat4 viewProjection;
uniform float vFlip;
uniform float uTime;
varying vec2 vUV;
varying vec3 vTint;
varying float vInf;
varying float vPhase;
#include<fogVertexDeclaration>
void main() {
  // Первая строка view-матрицы = ось X камеры в мировых координатах (право
  // экрана). Обнуляем Y — карточка не должна наклоняться вместе с камерой.
  vec3 right = vec3(view[0][0], view[1][0], view[2][0]);
  right.y = 0.0;
  vec3 d = position - anchor; // плоская заготовка карточки: (u, v, 0)
  vec3 worldPos = anchor + right * d.x + vec3(0.0, 1.0, 0.0) * d.y;
  // Здоровый тинт = (1,1,1), заражённый — зелёный (r<0.9). По фазе из координат
  // основания карточки качаем её, как живую: лишний изгиб кроны и покачивание.
  vInf = step(tint.r, 0.9);
  vPhase = anchor.x * 0.37 + anchor.z * 0.61;
  if (vInf > 0.5) {
    float h = max(0.0, position.y - anchor.y);
    worldPos.x += sin(uTime * 1.9 + vPhase) * 0.03 * h;
    worldPos.y += sin(uTime * 3.0 + vPhase * 1.7) * 0.035 * h;
  }
  gl_Position = viewProjection * vec4(worldPos, 1.0);
  // vFlip: канвас-атлас (v=0 — верх) и GPU-атлас RT (v=0 — низ кадра) — разные
  vUV = vec2(uv.x, mix(uv.y, 1.0 - uv.y, vFlip));
  vTint = tint;
#ifdef FOG
  vFogDistance = (view * vec4(worldPos, 1.0)).xyz;
#endif
}
`;
BABYLON.Effect.ShadersStore["impostorFragmentShader"] = `
uniform sampler2D map;
uniform vec2 texSize;
uniform float uTime;
varying vec2 vUV;
varying vec3 vTint;
varying float vInf;
varying float vPhase;
#include<fogFragmentDeclaration>
void main() {
  vec4 color = texture2D(map, vUV);
  if (color.a < 0.5) discard;
  // bleed-approx на GPU: у RT-атласа нет CPU-разлива цвета, прозрачные тексели
  // (rgb=0) затемняют кромку при билинейной фильтрации — подмешиваем цвет
  // соседа с бОльшей альфой
  if (color.a < 0.95) {
    vec2 o = 1.0 / texSize;
    vec4 n1 = texture2D(map, vUV + vec2(o.x, 0.0));
    vec4 n2 = texture2D(map, vUV - vec2(o.x, 0.0));
    vec4 n3 = texture2D(map, vUV + vec2(0.0, o.y));
    vec4 n4 = texture2D(map, vUV - vec2(0.0, o.y));
    vec4 best = n1;
    if (n2.a > best.a) best = n2;
    if (n3.a > best.a) best = n3;
    if (n4.a > best.a) best = n4;
    color.rgb = mix(color.rgb, best.rgb, clamp((0.95 - color.a) * 3.0, 0.0, 1.0));
  }
  color.rgb *= vTint;
  if (vInf > 0.5) {
    // Гнилостная подсветка: пульс + уход в ядовито-жёлтый/фиолетовый.
    float pulse = 0.90 + 0.20 * sin(uTime * 2.9 + vPhase);
    color.rgb *= pulse;
    color.rgb = mix(color.rgb, color.rgb * vec3(0.72, 1.18, 0.52), 0.6);
  }
#ifdef FOG
  color.rgb = mix(vFogColor, color.rgb, CalcFogFactor());
#endif
  gl_FragColor = color;
#include<imageProcessingCompatibility>
}
`;

// Запекание НАСТОЯЩИХ 3D-деревьев/кустов в атлас-текстуры импостеров:
// те же шаблоны геометрии и материалов, тот же свет сцены — совпадение идеальное.
// GPU-путь: рендерим ВСЕ ВАРИАНТЫ В ОДИН КАДР — расставляем их по смещениям
// так, чтобы каждое попало в СВОЮ ячейку атласа (ячейка = ширина карточки в
// мире), и RT становится текстурой материала НАПРЯМУЮ. Никаких readPixels/
// canvas/dataURL: чтение пикселей FBO сломано в headless (нулевой буфер даже
// у рабочего фида), а bleed кромки делаем 4-тами в шейдере импостеров.
// При любой ошибке — null (фолбэк на рисованные).
// Alpha-bleed фолбэка (ниже) остался: разлив цвета в прозрачные тексели
// против чёрной кромки при билинейной фильтрации.
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
// Ожидание n кадров: RTT рендерится движком ПОКА кадры идут (customRenderTargets)
function waitFrames(n) {
  return new Promise((res) => {
    let c = 0;
    const f = () => { if (++c >= n) return res(); requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
}

async function bakeImpostorAtlas(st, infected = false) {
  const scene = st.scene;
  const SITE = new BABYLON.Vector3(infected ? 2400 : 2000, 0, infected ? 2400 : 2000);
  const suffix = infected ? "Inf" : "";
  const bakedParts = [];
  try {
    // --- деревья: 3 варианта в одном кадре 512x256 ---
    // Камера dist 10, fovY .48, RT 512x256 (aspect 2): высота кадра 4.895м,
    // ширина 9.79м = 4 ячейки по 2.447м, ось камеры — граница ячеек 1|2.
    const treeRT = new BABYLON.RenderTargetTexture("bakeTree" + suffix,
      { width: 512, height: 256 }, scene, false);
    treeRT.clearColor = new BABYLON.Color4(0, 0, 0, 0);
    treeRT.hasAlpha = true;
    const treeCam = new BABYLON.UniversalCamera("bakeTreeCam" + suffix,
      SITE.add(new BABYLON.Vector3(0, 2.1, 10)), scene);
    treeCam.fov = 0.48;
    treeCam.minZ = 0.1; treeCam.maxZ = 50;
    treeCam.setTarget(SITE.add(new BABYLON.Vector3(0, 2.1, 0)));
    treeRT.activeCamera = treeCam;
    // Проекцию ФИКСИРУЕМ: иначе RTT рендерится с аспектом окна (1.78), а не
    // своего RT (2.0), и содержимое ячеек атласа съезжает — карточки срезают
    // кроны вертикально. Замороженная матрица гарантирует frame 9.79x4.895м.
    treeCam.freezeProjectionMatrix(BABYLON.Matrix.PerspectiveFovLH(0.48, 2.0, 0.1, 50));
    scene.customRenderTargets.push(treeRT);
    const CELL_W = 2.447; // ширина ячейки атласа в мире (см. addTreeSprite)
    const LEAF_OFFS = [[0, 2.75, 0, 1.6], [0.1, 3.1, -0.1, 1.3], [-0.1, 3.45, 0.1, 1.0]];
    // Те же смещения, что у ближней заражённой модели (makeInfectedTree).
    const TUMOR_OFFS = [[0, 2.55, 0, 2.05], [0.18, 3.15, -0.12, 1.6], [-0.14, 3.6, 0.14, 1.25]];
    const BOIL_OFFS = [[-0.5, 1.95, 0.22, 0.5], [0.52, 2.25, -0.18, 0.42]];
    const tint = (m, c) => {
      if (!m.instancedBuffers) m.instancedBuffers = {};
      m.instancedBuffers.color = c.clone();
    };
    const treeList = [];
    for (let v = 0; v < 3; v++) {
      const cx = (-1.5 + v) * CELL_W; // центры ячеек 0,1,2 относительно оси камеры
      // createInstance от ВЫКЛЮЧЕННОГО шаблона молча не рендерится в RTT —
      // клоны с общей геометрией рендерятся
      const trunk = st.trunkTpl.clone("bt" + suffix + v);
      trunk.setEnabled(true);
      trunk.position.set(SITE.x + cx, SITE.y + 1.3, SITE.z);
      if (infected) tint(trunk, INFECT_TRUNK);
      treeList.push(trunk);
      bakedParts.push(trunk);
      const crown = infected ? TUMOR_OFFS : LEAF_OFFS;
      for (let i = 0; i < crown.length; i++) {
        const [ox, oy, oz, d] = crown[i];
        const part = (infected ? st.tumorTpl : st.leafTpls[v]).clone(`bl${suffix}${v}_${i}`);
        part.setEnabled(true);
        part.position.set(SITE.x + cx + ox, SITE.y + oy, SITE.z + oz);
        part.scaling.setAll(d);
        if (infected) tint(part, i === 1 ? INFECT_TUMOR_B : INFECT_TUMOR_A);
        treeList.push(part);
        bakedParts.push(part);
      }
      if (infected) {
        for (let i = 0; i < BOIL_OFFS.length; i++) {
          const [ox, oy, oz, d] = BOIL_OFFS[i];
          const boil = st.boilTpl.clone(`bb${suffix}${v}_${i}`);
          boil.setEnabled(true);
          boil.position.set(SITE.x + cx + ox, SITE.y + oy, SITE.z + oz);
          boil.scaling.setAll(d);
          tint(boil, INFECT_BOIL);
          treeList.push(boil);
          bakedParts.push(boil);
        }
      }
    }
    treeRT.renderList = treeList;
    await waitFrames(10); // шейдеры/матрицы/текстуры оседают в кадрах
    // --- кусты: 2 варианта в одном кадре 256x128 (ячейка 2.211м) ---
    const bushRT = new BABYLON.RenderTargetTexture("bakeBush" + suffix,
      { width: 256, height: 128 }, scene, false);
    bushRT.clearColor = new BABYLON.Color4(0, 0, 0, 0);
    bushRT.hasAlpha = true;
    const bushCam = new BABYLON.UniversalCamera("bakeBushCam" + suffix,
      SITE.add(new BABYLON.Vector3(0, 0.45, 10)), scene);
    bushCam.fov = 0.22;
    bushCam.minZ = 0.1; bushCam.maxZ = 50;
    bushCam.setTarget(SITE.add(new BABYLON.Vector3(0, 0.45, 0)));
    bushRT.activeCamera = bushCam;
    bushCam.freezeProjectionMatrix(BABYLON.Matrix.PerspectiveFovLH(0.22, 2.0, 0.1, 50));
    scene.customRenderTargets.push(bushRT);
    const BC = 2.211; // ширина ячейки атласа кустов в мире
    const BUSH_OFFS = [[0, 0.4, 0, 0.8], [0.3, 0.3, 0.2, 0.6], [-0.3, 0.3, -0.15, 0.5]];
    const bushList = [];
    for (let v = 0; v < 2; v++) {
      const cx = (-0.5 + v) * BC; // центры ячеек 0,1
      for (let i = 0; i < BUSH_OFFS.length; i++) {
        const [ox, oy, oz, d] = BUSH_OFFS[i];
        const b = (infected ? st.tumorTpl : st.leafTpls[v]).clone(`bi${suffix}${v}_${i}`);
        b.setEnabled(true);
        b.position.set(SITE.x + cx + ox, SITE.y + oy, SITE.z + oz);
        b.scaling.setAll(d);
        if (infected) tint(b, i === 1 ? INFECT_TUMOR_B : INFECT_TUMOR_A);
        bushList.push(b);
        bakedParts.push(b);
      }
      if (infected) {
        const boil = st.boilTpl.clone(`bio${v}`);
        boil.setEnabled(true);
        boil.position.set(SITE.x + cx + 0.12, SITE.y + 0.78, SITE.z - 0.08);
        boil.scaling.setAll(0.46);
        tint(boil, INFECT_BOIL);
        bushList.push(boil);
        bakedParts.push(boil);
      }
    }
    bushRT.renderList = bushList;
    await waitFrames(10);
    // RT больше НЕ рендерим, но и НЕ диспозим — они теперь текстуры материала
    for (const rt of [treeRT, bushRT]) {
      rt.renderList = null;
      const i = scene.customRenderTargets.indexOf(rt);
      if (i >= 0) scene.customRenderTargets.splice(i, 1);
    }
    treeCam.dispose(); bushCam.dispose();
    for (const p of bakedParts) p.dispose();
    return { treeTex: treeRT, bushTex: bushRT };
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

// Фолбэк-атлас ЗАРАЖЁННОГО леса, если GPU-запекание недоступно. Раскладка
// ячеек та же (3 дерева / 2 куста), но силуэт неровный, с фиолетовыми нарывами.
function infectedTreeSpriteURL() {
  const c = document.createElement("canvas"); c.width = 512; c.height = 256;
  const g = c.getContext("2d");
  const tints = ["#3c5c11", "#2c470b", "#456a14"];
  for (let v = 0; v < 3; v++) {
    g.save(); g.translate(v * 128, 0);
    let seed = 71 + v * 13;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) | 0, ((seed >>> 0) % 1000) / 1000);
    g.fillStyle = "#1b2410"; g.fillRect(58, 150, 12, 106);
    g.fillStyle = tints[v];
    // Крона — колючий многоугольник вместо гладких кругов.
    g.beginPath();
    for (let i = 0; i <= 28; i++) {
      const a = i / 28 * Math.PI * 2;
      const rr = (i % 2 ? 34 : 49) + rnd() * 7;
      const x = 64 + Math.cos(a) * rr, y = 88 + Math.sin(a) * rr * 0.82;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.closePath(); g.fill();
    for (const [x, y, r] of [[38, 108, 19], [91, 104, 17], [64, 46, 22]]) {
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    g.globalCompositeOperation = "source-atop";
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? "rgba(150,70,205,.9)" : "rgba(198,120,245,.92)";
      g.beginPath(); g.arc(32 + rnd() * 66, 50 + rnd() * 92, 3 + rnd() * 6, 0, 7); g.fill();
    }
    for (let i = 0; i < 55; i++) {
      g.fillStyle = rnd() < 0.5 ? "#12200a" : "#0b1606";
      g.beginPath(); g.arc(rnd() * 128, 20 + rnd() * 145, 1 + rnd() * 2.5, 0, 7); g.fill();
    }
    g.globalCompositeOperation = "source-over";
    g.restore();
  }
  bleedAlpha(g, 512, 256);
  return c.toDataURL("image/png");
}
function infectedBushSpriteURL() {
  const c = document.createElement("canvas"); c.width = 256; c.height = 128;
  const g = c.getContext("2d");
  const tints = ["#3c5c11", "#2c470b"];
  for (let v = 0; v < 2; v++) {
    g.save(); g.translate(v * 128, 0);
    let seed = 83 + v * 17;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) | 0, ((seed >>> 0) % 1000) / 1000);
    g.fillStyle = tints[v];
    g.beginPath();
    for (let i = 0; i <= 20; i++) {
      const a = i / 20 * Math.PI * 2;
      const rr = (i % 2 ? 33 : 45) + rnd() * 6;
      const x = 64 + Math.cos(a) * rr, y = 76 + Math.sin(a) * rr * 0.7;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.closePath(); g.fill();
    g.globalCompositeOperation = "source-atop";
    for (let i = 0; i < 5; i++) {
      g.fillStyle = i % 2 ? "rgba(150,70,205,.9)" : "rgba(198,120,245,.92)";
      g.beginPath(); g.arc(38 + rnd() * 54, 50 + rnd() * 52, 3 + rnd() * 5, 0, 7); g.fill();
    }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = rnd() < 0.5 ? "#12200a" : "#0b1606";
      g.beginPath(); g.arc(rnd() * 128, 30 + rnd() * 80, 1 + rnd() * 2, 0, 7); g.fill();
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
// vFlip=1 у GPU-атласа RT (v=0 — низ кадра), 0 у канвас-фолбэка (v=0 — верх).
function makeImpostorMaterial(scene, name, url, texW, texH) {
  const fogOn = scene.fogEnabled && scene.fogMode !== BABYLON.Scene.FOGMODE_NONE;
  const m = new BABYLON.ShaderMaterial(name, scene,
    { vertex: "impostor", fragment: "impostor" }, {
      attributes: ["position", "uv", "anchor", "tint"],
      uniforms: ["view", "viewProjection", "vFlip", "texSize", "uTime",
        "vFogInfos", "vFogColor"],
      samplers: ["map"],
      defines: fogOn ? ["FOG"] : [],
    });
  m.setTexture("map",
    new BABYLON.Texture(url, scene, true, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE));
  m.setFloat("vFlip", 0);
  m.setVector2("texSize", new BABYLON.Vector2(texW, texH));
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

// Шаблон «опухоли»: неровный шипастый ком вместо гладкой листвы. Вершины
// икосаэдра вытягиваются детерминированным шумом, затем грани разворачиваются
// во flat-shaded — силуэт читается как больной нарост даже вдалеке.
function makeTumorTpl(scene, name, mat, seed) {
  const m = BABYLON.MeshBuilder.CreateIcoSphere(name,
    { radius: 0.5, subdivisions: 2, flat: false }, scene);
  const p = m.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    const len = Math.hypot(x, y, z) || 1;
    const n = Math.sin(x * 13.7 + seed) * Math.cos(y * 11.3 - seed) * Math.sin(z * 9.1 + seed * 2);
    const k = 0.80 + 0.30 * Math.abs(n) + 0.18 * Math.max(0, n);
    p[i] = x / len * 0.5 * k;
    p[i + 1] = y / len * 0.5 * k;
    p[i + 2] = z / len * 0.5 * k;
  }
  m.updateVerticesData(BABYLON.VertexBuffer.PositionKind, p);
  m.convertToFlatShadedMesh();
  m.material = mat;
  m.registerInstancedBuffer("color", 4);
  m.setEnabled(false);
  return m;
}

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
  // Индивидуальный цвет инстансов: деревьям в заражённой зоне можно поменять
  // оттенок, не трогая общий материал и не разбивая батчинг.
  trunkTpl.registerInstancedBuffer("color", 4);
  for (const t of leafTpls) t.registerInstancedBuffer("color", 4);

  // Заражённая растительность: гнилостный нарост + фиолетовые споры.
  // Материалы общие, поэтому пульсация подсветки — одно обновление на кадр.
  const infLeafMat = new BABYLON.StandardMaterial("infTumorMat", scene);
  infLeafMat.diffuseColor = new BABYLON.Color3(0.16, 0.34, 0.05);
  infLeafMat.emissiveColor = new BABYLON.Color3(0.18, 0.42, 0.03);
  infLeafMat.specularColor = new BABYLON.Color3(0, 0, 0);
  const infBoilMat = new BABYLON.StandardMaterial("infBoilMat", scene);
  infBoilMat.diffuseColor = new BABYLON.Color3(0.21, 0.06, 0.24);
  infBoilMat.emissiveColor = new BABYLON.Color3(0.32, 0.08, 0.42);
  infBoilMat.specularColor = new BABYLON.Color3(0.05, 0, 0.06);
  const tumorTpl = makeTumorTpl(scene, "tumorTpl", infLeafMat, 1.7);
  const boilTpl = makeTumorTpl(scene, "boilTpl", infBoilMat, 4.3);

  // Материалы импостеров дальнего леса: ВЕСЬ дальний лес = 1 draw call на чанк
  // (одна слитая карточка для деревьев + одна для кустов).
  // Текстура — запечённые настоящие 3D (3 варианта деревьев, 2 кустов);
  // если запекание не удалось — рисованный фолбэк.
  // Раскладка атласа: 4 колонки по 128px на 512 у деревьев (3 из 4 заняты),
  // 2 колонки на 256 у кустов; строка одна — v идёт от верха картинки к низу.
  let resolveReady;
  const ready = new Promise((r) => { resolveReady = r; });
  const st = {
    scene, mat, trunkTpl, leafTpls, chunks: new Map(), bakeError: null,
    treeCells: 3, bushCells: 2, treeCols: 4, bushCols: 2,
    tumorTpl, boilTpl, infLeafMat, infBoilMat, animated: [],
    ready, // резолвится, когда атлас запечён (или фолбэк/таймаут)
  };
  // Стартово — рисованный фолбэк (держит чанки, что строятся ДО запекания).
  st.treeMat = makeImpostorMaterial(scene, "impostorTreeMat", treeSpriteURL(), 512, 256);
  st.bushMat = makeImpostorMaterial(scene, "impostorBushMat", bushSpriteURL(), 256, 128);
  st.infTreeMat = makeImpostorMaterial(scene, "impostorInfTreeMat", infectedTreeSpriteURL(), 512, 256);
  st.infBushMat = makeImpostorMaterial(scene, "impostorInfBushMat", infectedBushSpriteURL(), 256, 128);
  // Запекание — ПОСЛЕ готовности НУЖНЫХ ЕМУ текстур (кора/трава): в момент
  // initTerrain jpg ещё в сети, материалы не готовы и RTT рендерит чёрный
  // кадр — фолбэк оставался навсегда. Глобальный scene.isReady() в headless
  // не резолвится, поэтому ждём именно требуемые текстуры, поллом с таймаутом.
  // Материал общий: подмена texture+flip обновляет и уже построенные карточки.
  let tries = 200; // ~20с
  const poll = async () => {
    if (tries-- > 0 && !(grassTex.isReady() && birchTex.isReady())) {
      setTimeout(poll, 100);
      return;
    }
    if (tries <= 0) { st.bakeError = "assets not ready"; resolveReady(); return; }
    try {
      const baked = await bakeImpostorAtlas(st, false);
      if (baked) {
        st.treeMat.setTexture("map", baked.treeTex);
        st.treeMat.setFloat("vFlip", 1);
        st.bushMat.setTexture("map", baked.bushTex);
        st.bushMat.setFloat("vFlip", 1);
      }
      // Второй атлас — с заражённых 3D-моделей (опухоли + споры).
      const sick = await bakeImpostorAtlas(st, true);
      if (sick) {
        st.infTreeMat.setTexture("map", sick.treeTex);
        st.infTreeMat.setFloat("vFlip", 1);
        st.infBushMat.setTexture("map", sick.bushTex);
        st.infBushMat.setFloat("vFlip", 1);
      }
    } catch { /* bakeError уже записан, фолбэк остаётся */ }
    finally { resolveReady(); }
  };
  poll();
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
const CONE_DEPTH = 14; // 14x16=224м, как раньше при чанках 32м
const CONE_HALF = 74 * Math.PI / 180; // 68.5° (полу-fov) + 5.5° запас на поворот
const FEED_RETAIN = 8;
const FEED_FULL_R = 2; // 3x3x16м=48м вокруг фида — полное 3D-качество (как у игрока),
// иначе у фида вместо леса плоские спрайты-импостеры: wantFar раньше смотрел
// только на игрока, и стоило отойти к монитору — лес у камеры схлопывался.
const CHUNK_HALF_DIAG = (CHUNK_WORLD * Math.SQRT2) / 2;

// Каждый кадр из main.js: догрузка вокруг игрока, вокруг активной камеры
// монитора (ex, ez — второй центр; без него в кадре фида дыры в земле) и
// конусом вдоль её взгляда (efx, efz), выгрузка дальних. Строим ВСЁ
// недостающее сразу (как _reload_chunks в Godot): бюджет по 2 давал
// дыры без земли на границах — игрок проваливался. Постройка чанка ~1мс.
// playerRadius: радиус кольца вокруг игрока. В режиме монитора игрок стоит
// на месте — можно грузить 5x5 вместо 9x9. Кольцо/конус фида не зависят от него.
export function updateTerrain(st, px, pz, ex, ez, efx, efz, playerRadius = VIEW_RADIUS) {
  const ccx = Math.floor(px / CHUNK_WORLD), ccz = Math.floor(pz / CHUNK_WORLD);
  const want = new Set();
  const missing = [];
  // Чанки 16м: far только ПОЗАДИ 3D-ядра игрока (3x3=48м) — на границе чанка
  // рядом со спрайтом уже не окажешься, дерево-спрайт не стоит у самого носа.
  // Дальше — спрайты (тот же лес по клеткам — позиции совпадают, подмена
  // бесшовна), спрайты живут также в дальнем конусе камеры монитора.
  const wantFarFor = (cx, cz) => {
    const feedFull = hasFeed && Math.max(Math.abs(cx - fcx), Math.abs(cz - fcz)) <= FEED_FULL_R;
    return Math.max(Math.abs(cx - ccx), Math.abs(cz - ccz)) > TREE_3D_R && !feedFull;
  };
  const add = (cx, cz) => {
    const k = chunkKey(cx, cz);
    if (want.has(k)) return;
    want.add(k);
    if (!st.chunks.has(k)) {
      const rx = cx - ccx, rz = cz - ccz;
      missing.push([cx, cz, rx * rx + rz * rz]); // ближе к игроку — строим раньше
    }
  };
  const ring = (ecx, ecz, radius) => {
    for (let dx = -radius; dx <= radius; dx++)
      for (let dz = -radius; dz <= radius; dz++)
        add(ecx + dx, ecz + dz);
  };
  ring(ccx, ccz, playerRadius);
  const hasFeed = ex !== null && ex !== undefined;
  let fcx = 0, fcz = 0;
  if (hasFeed) {
    fcx = Math.floor(ex / CHUNK_WORLD); fcz = Math.floor(ez / CHUNK_WORLD);
    ring(fcx, fcz, VIEW_RADIUS); // камеру монитора не трогаем — как было 9x9
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
      disposeChunk(st, ch); st.chunks.delete(k); continue;
    }
    // Чанк был спрайтовым, а теперь внутри кольца вида игрока или колец фида —
    // перестроить в полном 3D (и наоборот). Спрайтами остаётся ТОЛЬКО дальний
    // конус монитора за пределами кольца игрока.
    const [chx, chz] = k.split(",").map(Number);
    const wantFar = wantFarFor(chx, chz);
    if (ch.far !== wantFar) missing.push([chx, chz, 0]);
  }
  if (!missing.length) return;
  missing.sort((a, b) => a[2] - b[2]);
  for (const [cx, cz] of missing) {
    const k = chunkKey(cx, cz);
    if (st.chunks.has(k)) { disposeChunk(st, st.chunks.get(k)); st.chunks.delete(k); }
    st.chunks.set(k, buildChunk(st, cx, cz, wantFarFor(cx, cz)));
  }
}

function disposeChunk(st, ch) {
  ch.ground.dispose();
  const owned = new Set(ch.nodes);
  for (let i = st.animated.length - 1; i >= 0; i--) {
    if (owned.has(st.animated[i].node)) st.animated.splice(i, 1);
  }
  for (const n of ch.nodes) n.dispose();
  for (const s of ch.sprites) s.dispose();
}

function disposeNodes(st, ch, nodes) {
  if (!nodes || !nodes.length) return;
  for (const n of nodes) {
    for (let i = st.animated.length - 1; i >= 0; i--) {
      if (st.animated[i].node === n) { st.animated.splice(i, 1); break; }
    }
    const j = ch.nodes.indexOf(n);
    if (j >= 0) ch.nodes.splice(j, 1);
    n.dispose();
  }
}

function addAnimated(st, node, base, phase, x, z) {
  st.animated.push({ node, base, phase, x, z });
}

function buildChunk(st, cx, cz, far = false) {
  const { scene } = st;
  const cxw = cx * CHUNK_WORLD, czw = cz * CHUNK_WORLD;
  // У ямы сетка 2м грубее самого склона (край шириной 1м): меш показывал
  // пологий визуальный наклон там, где getHeight() ещё равен нулю, — игрок
  // «не реагировал» на яму и проваливался сквозь неё. У чанков рядом с воронкой
  // уплотняем сетку до 0.5м, чтобы меш совпадал с аналитической высотой.
  const nearPit = Math.hypot(cxw + CHUNK_WORLD / 2 - PIT_CENTER.x,
    czw + CHUNK_WORLD / 2 - PIT_CENTER.z) < PIT_R + PIT_EDGE + CHUNK_WORLD;
  const divisions = nearPit ? 32 : CHUNK_TILES;
  // CreateGround даёт гарантированно правильный winding (+Y),
  // затем сдвигаем вершины по getHeight() и пересчитываем нормали.
  const ground = BABYLON.MeshBuilder.CreateGround(`chunk_${cx}_${cz}`,
    { width: CHUNK_WORLD, height: CHUNK_WORLD, subdivisions: divisions }, scene);
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
  // Земля больше не участвует в moveWithCollisions: высоту игрока задаёт
  // getHeight() в updatePlayer. Иначе эллипсоид застревает на крутых склонах
  // воронки. isPickable остаётся — стрелы и лучи по-прежнему попадают в землю.
  ground.checkCollisions = false;
  ground.isPickable = true;
  ground.metadata = { kind: "terrain" };
  ground.freezeWorldMatrix();

  const ch = {
    cx, cz, far, ground, nodes: [], sprites: [], visible: true,
    cards: { tree: [], bush: [] }, treePts: [], bushRecs: [],
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

// Убирает уже построенные кусты в радиусе (x,z): сюжет расчищает обзор
// у остатков растворённой камеры. Будущие чанки режет st.bushClearAt.
export function clearBushes(st, x, z, radius) {
  const r2 = radius * radius;
  for (const ch of st.chunks.values()) {
    for (let i = ch.bushRecs.length - 1; i >= 0; i--) {
      const b = ch.bushRecs[i];
      const dx = b.x - x, dz = b.z - z;
      if (dx * dx + dz * dz > r2) continue;
      disposeNodes(st, ch, b.nodes);
      ch.bushRecs.splice(i, 1);
    }
  }
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
  // Ячейка принадлежит ТОЛЬКО чанку, в котором lies его центр gx*SPACING:
  // floor с обеих сторон границы давал дубли — на границе стояли и 3D-инстанс
  // и спрайт одной и той же клетки (проблема «две версии дерева на одном месте»).
  const minCx = Math.ceil(ox / TREE_SPACING - 1e-6);
  const maxCx = Math.ceil((ox + CHUNK_WORLD) / TREE_SPACING - 1e-6) - 1;
  const minCz = Math.ceil(oz / TREE_SPACING - 1e-6);
  const maxCz = Math.ceil((oz + CHUNK_WORLD) / TREE_SPACING - 1e-6) - 1;
  // ЕДИНАЯ плотность для 3D и спрайтов: спрайт-чанк должен быть ТЕМ ЖЕ лесом,
  // что и 3D-версия, иначе пересборка чанка меняла количество деревьев на глазах
  const density = TREE_DENSITY;
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
      const rot = rand01(rng) * Math.PI * 2;
      const infected = !!(st.infectionAt && st.infectionAt(px, pz));
      const rec = { x: px, y, z: pz, r, r2: r * r, s, rot, far, nodes: [], infected };
      if (!far) setTreeLook(st, ch, rec, infected);
      ch.treePts.push(rec);
      if (far) addTreeSprite(st, ch, px, y, pz, s, Math.abs(Math.round(px * 3 + pz)) % 3);
    }
  }
}

function populateBushes(st, ch, ox, oz, far = false) {
  // Ячейка одного хозяина — как в populateTrees.
  const minCx = Math.ceil(ox / BUSH_SPACING - 1e-6);
  const maxCx = Math.ceil((ox + CHUNK_WORLD) / BUSH_SPACING - 1e-6) - 1;
  const minCz = Math.ceil(oz / BUSH_SPACING - 1e-6);
  const maxCz = Math.ceil((oz + CHUNK_WORLD) / BUSH_SPACING - 1e-6) - 1;
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
      // Сюжет может попросить не заращивать кустами место остатков камеры.
      if (st.bushClearAt && st.bushClearAt(px, pz)) continue;
      if (far) {
        addBushSprite(st, ch, px, y, pz, s, Math.abs(Math.round(px * 5 + pz * 2)) % 2);
      } else {
        const infected = !!(st.infectionAt && st.infectionAt(px, pz));
        const rec = { x: px, y, z: pz, s, infected, nodes: [] };
        rec.nodes = makeBushInst(st, ch, px, y, pz, s, infected);
        ch.bushRecs.push(rec);
      }
    }
  }
}

// Импостеры: те же позиции/масштабы, что у 3D — переход незаметен.
// cellIndex = запечённый вариант (тот же оттенок, что выбрало бы 3D).
// Размер карточки = РАМКА запекающей камеры в метрах: деревья — дист.10,
// fov 0.48 → высота 2*10*tan(0.24)=4.895, ширина * (128/256) = 2.447; рамка по y
// = [-0.347, 4.547] (центр 2.1). Кусты — fov 0.22 → 2.211 обоих, y=[-0.656, 1.556].
// Раньше 2.4x4.4/1.1x0.8 сжимали/уменьшали силуэт — «2D шире и меньше 3D».
// Индекс берётся по модулю числа ячеек, поэтому даже при фолбэке атласа
// карточка не вылезет за пределы текстуры (и не станет пустой).
// Карточки копим на чанк, mesh'ы строит buildImpostorChunk. Жёсткого лимита
// больше нет: дальних чанков всего 16 — ~400 деревьев и ~1900 кустов на лес.
function addTreeSprite(st, ch, x, y, z, s, v) {
  const h = 4.895 * s;
  ch.cards.tree.push({
    x, z, y: y + 2.1 * s - h / 2, w: 2.447 * s, h,
    cell: ((v % st.treeCells) + st.treeCells) % st.treeCells,
    infected: !!(st.infectionAt && st.infectionAt(x, z)),
  });
}
function addBushSprite(st, ch, x, y, z, s, v) {
  const h = 2.211 * s;
  ch.cards.bush.push({
    x, z, y: y + 0.45 * s - h / 2, w: 2.211 * s, h,
    cell: ((v % st.bushCells) + st.bushCells) % st.bushCells,
    infected: !!(st.infectionAt && st.infectionAt(x, z)),
  });
}

// Одна слитая карточка на чанк и на тип (1 draw call). Позиции — мировые,
// база карточки (anchor) лежит отдельно: по ней шейдер доворачивает карточку
// по yaw вокруг основания. Габарит по Z считаем как ±w/2, а не 0 — карточка
// вращается вокруг основания и из плоской заготовки вылезает за её пределы.
function buildImpostorChunk(st, ch) {
  for (const kind of ["tree", "bush"]) {
    const cols = kind === "tree" ? st.treeCols : st.bushCols;
    // Здоровые и заражённые карточки идут в РАЗНЫЕ меши: у них разные атласы.
    // По-прежнему 1 draw call на группу — обычно 2 на чанк вместо одного.
    for (const infected of [false, true]) {
      const cards = ch.cards[kind].filter((c) => !!c.infected === infected);
      if (!cards.length) continue;
      const positions = [], uvs = [], anchors = [], normals = [], indices = [];
      const tint = [];
      const min = new BABYLON.Vector3(Infinity, Infinity, Infinity);
      const max = new BABYLON.Vector3(-Infinity, -Infinity, -Infinity);
      for (const c of cards) {
        const b = positions.length / 3;
        const x0 = c.x - c.w / 2, x1 = c.x + c.w / 2, y1 = c.y + c.h;
        positions.push(x0, y1, c.z, x1, y1, c.z, x0, c.y, c.z, x1, c.y, c.z);
        for (let i = 0; i < 4; i++) { anchors.push(c.x, c.y, c.z); normals.push(0, 0, -1); }
        const tc = infected ? INFECT_SPRITE : NORMAL_SPRITE;
        for (let i = 0; i < 4; i++) tint.push(tc.r, tc.g, tc.b);
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
      const mesh = new BABYLON.Mesh(`${kind}Imp_${ch.cx}_${ch.cz}${infected ? "_inf" : ""}`, st.scene);
      const vd = new BABYLON.VertexData();
      vd.positions = positions; vd.uvs = uvs; vd.normals = normals; vd.indices = indices;
      vd.applyToMesh(mesh);
      mesh.setVerticesData("anchor", anchors, false, 3);
      mesh.setVerticesData("tint", new Float32Array(tint), false, 3);
      mesh.setBoundingInfo(new BABYLON.BoundingInfo(min, max));
      const mat = infected
        ? (kind === "tree" ? st.infTreeMat : st.infBushMat)
        : (kind === "tree" ? st.treeMat : st.bushMat);
      mesh.material = mat;
      mesh.isPickable = true;
      mesh.metadata = { kind: kind === "tree" ? "tree" : "bush" };
      mesh.checkCollisions = false;
      mesh.freezeWorldMatrix();
      ch.sprites.push(mesh);
      if (!ch.tints) ch.tints = [];
      ch.tints.push({ mesh, cards, values: new Float32Array(tint) });
    }
  }
}

// Обновляет «заражённость» леса: 3D-инстансы деревьев и слитые карточки
// дальнего леса. Предикат задаёт story: terrain.infectionAt = (x, z) => outside.
// Вызывается по таймеру, когда стена сжимается; новые чанки красятся сразу
// при сборке (см. makeTreeInst / buildImpostorChunk).
export function refreshInfection(st) {
  const fn = st.infectionAt;
  if (!fn) return;
  for (const ch of st.chunks.values()) {
    for (const t of ch.treePts) {
      if (t.far) continue; // дальний лес — только карточки с тинтом
      const inf = !!fn(t.x, t.z);
      if (t.infected === inf) continue;
      setTreeLook(st, ch, t, inf); // меняем САМУ модель: листва → опухоли + споры
    }
    // Кусты за стеной тоже превращаются в гнилостные комки.
    for (const b of ch.bushRecs) {
      const inf = !!fn(b.x, b.z);
      if (b.infected === inf) continue;
      disposeNodes(st, ch, b.nodes);
      b.infected = inf;
      b.nodes = makeBushInst(st, ch, b.x, b.y, b.z, b.s, inf);
    }
    // Дальний лес: если у карточки сменился статус, пересобираем меши чанка —
    // здоровые и заражённые карточки лежат в разных атласах и разных мешах.
    let farChanged = false;
    for (const kind of ["tree", "bush"]) {
      for (const c of ch.cards[kind]) {
        const inf = !!fn(c.x, c.z);
        if (c.infected === inf) continue;
        c.infected = inf;
        farChanged = true;
      }
    }
    if (farChanged && ch.sprites.length) {
      for (const s of ch.sprites) s.dispose();
      ch.sprites.length = 0;
      if (ch.tints) ch.tints.length = 0;
      buildImpostorChunk(st, ch);
      setChunkVisible(ch, ch.visible); // новые меши не должны зажечься в скрытом чанке
    }
  }
}

const INFECT_SPRITE = new BABYLON.Color3(0.5, 0.82, 0.25);
const NORMAL_SPRITE = new BABYLON.Color3(1, 1, 1);
const INFECT_TRUNK = new BABYLON.Color4(0.22, 0.30, 0.09, 1);
const INFECT_TUMOR_A = new BABYLON.Color4(0.72, 1.0, 0.30, 1);
const INFECT_TUMOR_B = new BABYLON.Color4(0.42, 0.80, 0.16, 1);
const INFECT_BOIL = new BABYLON.Color4(0.85, 0.55, 1.0, 1);
const NORMAL_INST = new BABYLON.Color4(1, 1, 1, 1);

// Полная замена модели дерева при заражении: ствол темнеет, вместо трёх шаров
// листвы — неровные опухоли, плюс два фиолетовых мешка спор под кроной.
function setTreeLook(st, ch, t, infected) {
  if (t.nodes.length) disposeNodes(st, ch, t.nodes);
  t.nodes = infected
    ? makeInfectedTree(st, ch, t.x, t.y, t.z, t.s, t.rot)
    : makeTreeInst(st, ch, t.x, t.y, t.z, t.s, t.rot);
  t.infected = infected;
}

function makeTreeInst(st, ch, x, y, z, s, rotY) {
  const nodes = [];
  const trunk = st.trunkTpl.createInstance("trunk");
  trunk.instancedBuffers.color = NORMAL_INST.clone();
  trunk.position.set(x, y + 1.3 * s, z);
  trunk.scaling.setAll(s);
  trunk.rotation.y = rotY;
  trunk.isPickable = true;
  trunk.checkCollisions = true;
  trunk.metadata = { kind: "tree" };
  trunk.freezeWorldMatrix(); // статика: без пересчёта матриц каждый кадр
  ch.nodes.push(trunk); nodes.push(trunk);
  const leafTpl = st.leafTpls[Math.abs(Math.round(x * 3 + z)) % 3];
  [[0, 2.75, 0, 1.6], [0.1, 3.1, -0.1, 1.3], [-0.1, 3.45, 0.1, 1.0]].forEach(([ox, oy, oz, d]) => {
    const leaf = leafTpl.createInstance("leaf");
    leaf.instancedBuffers.color = NORMAL_INST.clone();
    const ca = Math.cos(rotY), sa = Math.sin(rotY);
    leaf.position.set(x + (ox * ca - oz * sa) * s, y + oy * s, z + (ox * sa + oz * ca) * s);
    leaf.scaling.setAll(d * s);
    leaf.isPickable = false;
    leaf.freezeWorldMatrix();
    ch.nodes.push(leaf); nodes.push(leaf);
  });
  return nodes;
}

function makeInfectedTree(st, ch, x, y, z, s, rotY) {
  const nodes = [];
  // Тот же ствол, но почти чёрный, с гнилостным зелёным оттенком.
  const trunk = st.trunkTpl.createInstance("trunkInf");
  trunk.instancedBuffers.color = INFECT_TRUNK.clone();
  trunk.position.set(x, y + 1.3 * s, z);
  trunk.scaling.setAll(s);
  trunk.rotation.y = rotY;
  trunk.isPickable = true;
  trunk.checkCollisions = true;
  trunk.metadata = { kind: "tree" };
  trunk.freezeWorldMatrix();
  ch.nodes.push(trunk); nodes.push(trunk);

  const ca = Math.cos(rotY), sa = Math.sin(rotY);
  const place = (n, ox, oy, oz, d, color, animated) => {
    n.instancedBuffers.color = color.clone();
    n.position.set(x + (ox * ca - oz * sa) * s, y + oy * s, z + (ox * sa + oz * ca) * s);
    n.scaling.setAll(d * s);
    n.isPickable = false;
    n.metadata = { kind: "tree" };
    if (animated) addAnimated(st, n, d * s, (x * 0.31 + z * 0.17) % 6.28, x, z);
    else n.freezeWorldMatrix();
    ch.nodes.push(n); nodes.push(n);
  };
  // Крона из трёх опухолей разного размера — силуэт уже не «шарик на палке».
  const tumors = [[0, 2.55, 0, 2.05], [0.18, 3.15, -0.12, 1.6], [-0.14, 3.6, 0.14, 1.25]];
  tumors.forEach(([ox, oy, oz, d], i) =>
    place(st.tumorTpl.createInstance("tumor"), ox, oy, oz, d,
      i === 1 ? INFECT_TUMOR_B : INFECT_TUMOR_A, true));
  // Мешки спор на нижних ветках — фиолетовый контраст зелени.
  [[-0.5, 1.95, 0.22, 0.5], [0.52, 2.25, -0.18, 0.42]].forEach(([ox, oy, oz, d]) =>
    place(st.boilTpl.createInstance("boil"), ox, oy, oz, d, INFECT_BOIL, true));
  return nodes;
}

function makeBushInst(st, ch, x, y, z, s, infected = false) {
  const nodes = [];
  const tpl = infected ? st.tumorTpl : st.leafTpls[Math.abs(Math.round(x * 5 + z * 2)) % 3];
  [[0, 0.4, 0, 0.8], [0.3, 0.3, 0.2, 0.6], [-0.3, 0.3, -0.15, 0.5]].forEach(([ox, oy, oz, d], i) => {
    const b = tpl.createInstance(infected ? "bushInf" : "bush");
    b.instancedBuffers.color = (infected
      ? (i === 1 ? INFECT_TUMOR_B : INFECT_TUMOR_A) : NORMAL_INST).clone();
    b.position.set(x + ox * s, y + oy * s, z + oz * s);
    b.scaling.setAll(d * s);
    b.isPickable = false;
    b.metadata = { kind: "bush" };
    if (infected) addAnimated(st, b, d * s, (x * 0.41 + z * 0.23) % 6.28, x, z);
    else b.freezeWorldMatrix();
    ch.nodes.push(b); nodes.push(b);
  });
  if (infected) {
    // Один крупный нарыв сверху — куст тоже читается как заражённый.
    const boil = st.boilTpl.createInstance("bushBoil");
    boil.instancedBuffers.color = INFECT_BOIL.clone();
    boil.position.set(x + 0.12 * s, y + 0.78 * s, z - 0.08 * s);
    boil.scaling.setAll(0.46 * s);
    boil.isPickable = false;
    boil.metadata = { kind: "bush" };
    addAnimated(st, boil, 0.46 * s, (x * 0.41 + z * 0.23) % 6.28, x, z);
    ch.nodes.push(boil); nodes.push(boil);
  }
  return nodes;
}

// Раз в кадр: пульс подсветки (две строки), покачивание ближайших наростов и
// время для шейдера импостеров. Дальше 35м анимация не нужна — там cardio
// не видно, а перебирать тысячи инстансов каждый кадр незачем.
export function updateInfected(st, time, pos) {
  if (!st) return;
  st.treeMat?.setFloat?.("uTime", time);
  st.bushMat?.setFloat?.("uTime", time);
  st.infTreeMat?.setFloat?.("uTime", time);
  st.infBushMat?.setFloat?.("uTime", time);
  const p = 0.75 + 0.25 * Math.sin(time * 2.9);
  st.infLeafMat?.emissiveColor.set(0.18 * p, 0.42 * p, 0.03 * p);
  const b = 0.55 + 0.45 * Math.sin(time * 2.1 + 1.3);
  st.infBoilMat?.emissiveColor.set(0.32 * b, 0.08 * b, 0.42 * b);
  const px = pos?.x ?? 0, pz = pos?.z ?? 0;
  for (const a of st.animated) {
    const dx = a.x - px, dz = a.z - pz;
    if (dx * dx + dz * dz > 35 * 35) continue;
    const k = 1 + 0.09 * Math.sin(time * 2.4 + a.phase);
    a.node.scaling.setAll(a.base * k);
    a.node.rotation.y = a.phase * 0.4 + Math.sin(time * 1.2 + a.phase) * 0.14;
  }
}
