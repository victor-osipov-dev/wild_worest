// Первый срез сюжета: «Последний день в лесу».
// Связывает уже существующие системы (камеры/монитор/лук/костёр/яму/пещеру)
// в линейную цепочку целей. Не подменяет механики — только задаёт цели и
// реагирует на события через состояние игрока и список камер.
import * as BABYLON from "@babylonjs/core";
import { getHeight, PIT_CENTER, HOUSE_POS } from "./noise.js";
import { DangerZone } from "./dangerZone.js";
import { refreshInfection, clearBushes } from "./terrain.js";
import { removeCamera } from "./entities.js";
import { t, onLangChange } from "./i18n.js";

export function createStory(ctx) {
  const { scene, player, mgr, hud, toast, buildCamera, terrain, screen, camera } = ctx;

  const state = {
    grateIntact: true, melting: false, meltT: 0,
    completed: false, index: 0,
    monitorViewed: false,
    cameraDown: false,
    remainsSeen: false,
    resinTaken: false,
    poking: false, pokeT: 0,
    infectT: 0,
    inMine: false,
  };

  // Безопасная зона вокруг дома. Всё снаружи покрыто кислотно-зелёной
  // заразой: деревья становятся «зомби», камеры растворяются, игрок теряет HP.
  const zone = new DangerZone(scene, player, hud, {
    x: HOUSE_POS.x, z: HOUSE_POS.z,
    startRadius: 55, targetRadius: 18, duration: 150, damage: 1.5,
    terrain,
  });
  zone.onOutside = () => toast(t("КИСЛОТНАЯ ЗОНА — возвращайтесь к дому!"));
  // Весь лес за стеной заражён: terrain красит 3D-инстансы и дальние карточки.
  terrain.infectionAt = (x, z) => zone.isOutside(x, z);
  refreshInfection(terrain);

  // Игрок стартует внутри дома лицом к монитору.
  player.mesh.position.set(HOUSE_POS.x + 0.7, 0.8, HOUSE_POS.z - 0.6);
  player.st.spawn.copyFrom(player.mesh.position);
  player.st.yaw = Math.PI / 2; // смотреть на экран (+X)
  player.st.pitch = 0;
  ctx.camera.position.set(player.mesh.position.x, player.mesh.position.y + 0.45, player.mesh.position.z);
  ctx.camera.rotation.set(0, player.st.yaw, 0);

  // ---------- Камеры: 4 штуки уже стоят вокруг дома ----------
  const treePts = [];
  for (const ch of terrain.chunks.values()) {
    for (const t of ch.treePts) treePts.push(t);
  }
  const distHouse = (t) => Math.hypot(t.x - HOUSE_POS.x, t.z - HOUSE_POS.z);

  const perimeter = [[], [], [], []];
  for (const t of treePts) {
    const d = distHouse(t);
    if (d < 26 || d > 46) continue;
    const a = Math.atan2(t.z - HOUSE_POS.z, t.x - HOUSE_POS.x);
    const q = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 4) % 4;
    perimeter[q].push(t);
  }
  const spots = [];
  for (let q = 0; q < 3; q++) {
    perimeter[q].sort((a, b) => distHouse(b) - distHouse(a));
    const t = perimeter[q].find(c => spots.every(p => Math.hypot(p.x - c.x, p.z - c.z) > 6))
      || perimeter[q][0];
    const a = q / 4 * Math.PI * 2 + 0.4;
    spots.push(t ? { x: t.x, z: t.z } : {
      x: HOUSE_POS.x + Math.cos(a) * 34,
      z: HOUSE_POS.z + Math.sin(a) * 34,
    });
  }

  // Обречённая камера — уже за границей безопасной зоны: добежать невозможно.
  // Берём ближайшее дерево сразу за стеной (58–66 м): остатки должны быть
  // достижимы, пока кислотный урон ещё терпим.
  const farTrees = treePts.filter(t => {
    const d = distHouse(t);
    return d > 58 && d < 70 && spots.every(p => Math.hypot(p.x - t.x, p.z - t.z) > 8);
  }).sort((a, b) => distHouse(a) - distHouse(b));
  const fallbackAngle = 2.1;
  const doomedSpot = farTrees[0] ? { x: farTrees[0].x, z: farTrees[0].z } : {
    x: HOUSE_POS.x + Math.cos(fallbackAngle) * 61,
    z: HOUSE_POS.z + Math.sin(fallbackAngle) * 61,
  };

  // Кусты вокруг остатков убираем: слизь и осколки должны читаться издалека,
  // а не тонуть в листве.
  const clearR = 5;
  terrain.bushClearAt = (x, z) =>
    Math.hypot(x - doomedSpot.x, z - doomedSpot.z) < clearR;
  clearBushes(terrain, doomedSpot.x, doomedSpot.z, clearR);

  function mount(tree, doomed) {
    // Автоматические камеры не прячем в листве: держим их ниже кроны.
    // Ручная установка по подсказке на стволе остаётся на выбранной высоте.
    const pos = new BABYLON.Vector3(tree.x, getHeight(tree.x, tree.z) + 1.2, tree.z);
    // Нормаль — к дому: камера смотрит ОТ ствола в лес (в заражённую зону).
    const n = new BABYLON.Vector3(HOUSE_POS.x - tree.x, 0, HOUSE_POS.z - tree.z).normalize();
    buildCamera(pos, n);
    const root = mgr.list[mgr.list.length - 1];
    return { root, x: tree.x, z: tree.z, baseY: root.position.y, t: 0, gone: false, doomed, lastK: -1 };
  }

  const cams = spots.map(s => mount(s, false));
  const doomed = mount(doomedSpot, true);
  cams.push(doomed);
  // Точка, к которой ведёт стрелка, даже если сама камера уже рассыпалась.
  const doomedPoint = new BABYLON.Vector3(doomed.x,
    getHeight(doomed.x, doomed.z) + 1.2, doomed.z);
  // Монитор при входе сразу показывает именно гибнущую камеру.
  mgr.active = mgr.list.indexOf(doomed.root);
  // Метки на камере нет, пока игрок ни разу не посмотрел монитор.
  mgr.marked = -1;
  // Пока игрок не увидел «нет сигнала», сломанная камера остаётся в списке.
  let doomedListed = true;

  const monitorPos = screen ? screen.getAbsolutePosition().clone() : null;

  // ---------- Растворение камер в кислотной зоне ----------
  const DISSOLVE_TIME = 10;
  let remainsPos = null;

  function applyDissolve(c, k) {
    if (Math.abs(k - c.lastK) < 0.01) return;
    c.lastK = k;
    const s = 1 - 0.75 * k;
    c.root.scaling.setAll(s);
    c.root.position.y = c.baseY - 0.45 * k;
    for (const part of c.root.getChildMeshes()) {
      if (part.name !== "cambody" && part.name !== "camled") continue;
      const mat = part.material;
      if (mat && mat.emissiveColor) mat.emissiveColor.set(0.55 * k, 1.0 * k, 0.14 * k);
    }
  }

  function spawnRemains(x, z) {
    if (remainsPos) return;
    const dir = new BABYLON.Vector3(HOUSE_POS.x - x, 0, HOUSE_POS.z - z).normalize();
    const rx = x + dir.x * 0.9, rz = z + dir.z * 0.9;
    const gy = getHeight(rx, rz);
    remainsPos = new BABYLON.Vector3(rx, gy + 0.35, rz);

    const group = new BABYLON.TransformNode("camRemains", scene);
    const slimeMat = new BABYLON.StandardMaterial("slimeMat", scene);
    slimeMat.diffuseColor = new BABYLON.Color3(0.14, 0.38, 0.03);
    slimeMat.emissiveColor = new BABYLON.Color3(0.24, 0.68, 0.05);
    slimeMat.alpha = 0.92;

    const puddle = BABYLON.MeshBuilder.CreateCylinder("slimePuddle",
      { diameter: 1.5, height: 0.07, tessellation: 18 }, scene);
    puddle.position.set(rx, gy + 0.05, rz);
    puddle.material = slimeMat; puddle.parent = group; puddle.isPickable = false;

    const fragMat = new BABYLON.StandardMaterial("camFragMat", scene);
    fragMat.diffuseColor = new BABYLON.Color3(0.12, 0.15, 0.11);
    fragMat.emissiveColor = new BABYLON.Color3(0.1, 0.28, 0.03);
    for (let i = 0; i < 3; i++) {
      const f = BABYLON.MeshBuilder.CreateBox("camFrag",
        { width: 0.12, height: 0.05, depth: 0.16 }, scene);
      f.position.set(rx + (Math.random() - 0.5) * 0.6, gy + 0.08,
        rz + (Math.random() - 0.5) * 0.6);
      f.rotation.y = Math.random() * Math.PI;
      f.material = fragMat; f.parent = group; f.isPickable = false;
    }
    const drip = BABYLON.MeshBuilder.CreateSphere("slimeDrip",
      { diameter: 0.32, segments: 8 }, scene);
    drip.position.set(x, gy + 0.5, z);
    drip.scaling.set(0.7, 1.7, 0.7);
    drip.material = slimeMat; drip.parent = group; drip.isPickable = false;
  }

  // Обречённая камера: визуально рассыпается, но до первого просмотра
  // монитора остаётся в списке как камера «без сигнала». Игрок сам увидит
  // поломку, а не прочитает про неё в тексте.
  function lostCamera(c, manual = false) {
    if (c.doomed) {
      state.cameraDown = true;
      spawnRemains(c.x, c.z);
      if (!manual && !c.root.isDisposed()) c.root.setEnabled(false);
      hud();
      return;
    }
    if (!manual) {
      removeCamera(mgr, c.root);
      c.root.dispose();
    }
    hud();
  }

  function updateCams(dt) {
    for (const c of cams) {
      if (c.gone) continue;
      if (c.root.isDisposed()) {
        c.gone = true;
        lostCamera(c, true);
        continue;
      }
      if (!zone.isOutside(c.x, c.z)) {
        c.t = Math.max(0, c.t - dt * 1.5);
        applyDissolve(c, c.t / DISSOLVE_TIME);
        continue;
      }
      c.t += dt;
      const k = Math.min(1, c.t / DISSOLVE_TIME);
      applyDissolve(c, k);
      if (k >= 1) {
        c.gone = true;
        lostCamera(c);
      }
    }
  }

  // ---------- Стрела со смолой ----------
  // Стрела в руке (viewmodel): появляется после того, как смола осталась на
  // наконечнике, и висит перед камерой до расплавления решётки.
  function makeArrowModel(name) {
    const root = new BABYLON.TransformNode(name, scene);
    const wood = new BABYLON.StandardMaterial(name + "Wood", scene);
    wood.diffuseColor = new BABYLON.Color3(0.55, 0.35, 0.15);
    const shaft = BABYLON.MeshBuilder.CreateBox(name + "Shaft",
      { width: 0.018, height: 0.018, depth: 0.62 }, scene);
    shaft.material = wood; shaft.parent = root; shaft.isPickable = false;
    const metal = new BABYLON.StandardMaterial(name + "Metal", scene);
    metal.diffuseColor = new BABYLON.Color3(0.3, 0.3, 0.35);
    metal.specularColor = new BABYLON.Color3(0.6, 0.6, 0.6);
    const head = BABYLON.MeshBuilder.CreateBox(name + "Head",
      { width: 0.034, height: 0.034, depth: 0.1 }, scene);
    head.material = metal; head.position.z = 0.29; head.parent = root; head.isPickable = false;
    const fletch = new BABYLON.StandardMaterial(name + "Fletch", scene);
    fletch.diffuseColor = new BABYLON.Color3(0.85, 0.18, 0.1);
    for (const side of [-1, 1]) {
      const f = BABYLON.MeshBuilder.CreateBox(name + "Fletch",
        { width: 0.002, height: 0.055, depth: 0.11 }, scene);
      f.material = fletch; f.position.set(0, side * 0.022, -0.24);
      f.rotation.z = side * 0.5; f.parent = root; f.isPickable = false;
    }
    // Смола — не ровный шарик, а неровный комок из нескольких капель.
    const rm = new BABYLON.StandardMaterial(name + "ResinMat", scene);
    rm.diffuseColor = new BABYLON.Color3(0.16, 0.48, 0.03);
    rm.emissiveColor = new BABYLON.Color3(0.28, 0.72, 0.05);
    rm.specularColor = new BABYLON.Color3(0.18, 0.4, 0.12);
    rm.alpha = 0.95;
    const lumps = [];
    for (const [x, y, z, sx, sy, sz] of [
      [0, 0, 0, 0.075, 0.06, 0.09],
      [0.035, 0.012, 0.012, 0.045, 0.04, 0.05],
      [-0.03, -0.012, 0.018, 0.04, 0.036, 0.05],
      [0.006, -0.05, 0.03, 0.028, 0.06, 0.034],
    ]) {
      const s = BABYLON.MeshBuilder.CreateSphere(name + "ResinPart",
        { diameter: 1, segments: 8 }, scene);
      s.position.set(x, y, z); s.scaling.set(sx, sy, sz);
      s.material = rm; s.isPickable = false; lumps.push(s);
    }
    const resin = BABYLON.Mesh.MergeMeshes(lumps, true, true, undefined, false, false);
    resin.name = name + "Resin";
    resin.material = rm; resin.isPickable = false;
    resin.position.z = 0.32; resin.parent = root;
    resin.scaling.setAll(0);
    root.resin = resin;
    return root;
  }

  // Держим стрелу в левой руке: наконечник со смолой смотрит вверх-вправо,
  // древко уходит к нижнему левому краю. Подняли выше, чтобы стрела была
  // видна целиком — и оперение, и наконечник.
  const heldPivot = new BABYLON.TransformNode("heldArrowPivot", scene);
  heldPivot.parent = ctx.camera;
  heldPivot.position.set(-0.32, -0.18, 0.66);

  const held = makeArrowModel("heldArrow");
  held.parent = heldPivot;
  held.position.set(0, 0, 0);
  held.rotationQuaternion = BABYLON.Quaternion.FromUnitVectorsToRef(
    new BABYLON.Vector3(0, 0, 1),
    new BABYLON.Vector3(0.5, 0.78, 0.24).normalize(),
    new BABYLON.Quaternion());
  held.scaling.setAll(0.82);
  held.resin.scaling.setAll(1);
  held.setEnabled(false);
  let heldT = 0;

  // Капли смолы падают с наконечника стрелы.
  const dripTex = (() => {
    const dt = new BABYLON.DynamicTexture("resinDripTex", 32, scene, false);
    const g = dt.getContext();
    g.clearRect(0, 0, 32, 32);
    const rg = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    rg.addColorStop(0, "rgba(235,255,200,1)");
    rg.addColorStop(0.5, "rgba(120,220,40,0.7)");
    rg.addColorStop(1, "rgba(40,120,0,0)");
    g.fillStyle = rg; g.fillRect(0, 0, 32, 32);
    dt.update();
    dt.hasAlpha = true;
    return dt;
  })();
  const drips = new BABYLON.ParticleSystem("resinDrips", 200, scene);
  drips.particleTexture = dripTex;
  drips.emitter = held.resin;
  drips.minEmitBox = new BABYLON.Vector3(-0.02, -0.01, -0.02);
  drips.maxEmitBox = new BABYLON.Vector3(0.02, 0.02, 0.02);
  drips.color1 = new BABYLON.Color4(0.45, 0.95, 0.12, 0.95);
  drips.color2 = new BABYLON.Color4(0.25, 0.7, 0.04, 0.85);
  drips.colorDead = new BABYLON.Color4(0.12, 0.35, 0.02, 0);
  drips.minSize = 0.015; drips.maxSize = 0.035;
  drips.minLifeTime = 0.35; drips.maxLifeTime = 0.8;
  drips.emitRate = 14;
  drips.direction1 = new BABYLON.Vector3(-0.12, -1, -0.12);
  drips.direction2 = new BABYLON.Vector3(0.12, -0.35, 0.12);
  drips.minEmitPower = 0.08; drips.maxEmitPower = 0.25;
  drips.gravity = new BABYLON.Vector3(0, -1.6, 0);
  drips.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;

  let pokeArrow = null;
  let pokeBaseY = 0;

  function nearRemains() {
    return !!remainsPos && player.mesh.position.subtract(remainsPos).length() < 2.9;
  }

  function tryPoke() {
    if (state.poking || !state.remainsSeen || !remainsPos || player.st.resin) return false;
    if (!nearRemains()) return false;
    state.poking = true;
    state.pokeT = 0;
    pokeArrow = makeArrowModel("pokeArrow");
    pokeArrow.resin.scaling.setAll(0);
    pokeArrow.position.copyFrom(remainsPos);
    pokeBaseY = remainsPos.y;
    pokeArrow.position.y = pokeBaseY + 0.45;
    pokeArrow.rotation.set(Math.PI / 2, 0.6, 0);
    toast(t("Вы ковыряете слизь стрелой…"));
    return true;
  }

  function finishPoke() {
    state.poking = false;
    if (pokeArrow) { pokeArrow.dispose(); pokeArrow = null; }
    player.st.resin = true;
    state.resinTaken = true;
    held.setEnabled(true);
    drips.start();
    toast(t("Смола на стреле. Похоже, она растворяет всё, кроме дерева."));
    mgr.toastT = 6;
    hud();
  }

  // ---------- Решётка над ямой ----------
  const grate = new BABYLON.TransformNode("pitGrate", scene);
  grate.position.set(PIT_CENTER.x, 0.12, PIT_CENTER.z);
  const grateMat = new BABYLON.StandardMaterial("grateMat", scene);
  grateMat.diffuseColor = new BABYLON.Color3(0.22, 0.24, 0.27);
  grateMat.specularColor = new BABYLON.Color3(0.5, 0.5, 0.5);
  grateMat.emissiveColor = new BABYLON.Color3(0, 0, 0);
  const bars = [];
  for (let i = -4; i <= 4; i++) {
    const bar = BABYLON.MeshBuilder.CreateBox("grateBar", { width: 0.12, height: 0.1, depth: 8.6 }, scene);
    bar.position.set(i * 1.0, 0, 0);
    bar.material = grateMat; bar.parent = grate;
    bar.isPickable = false; bars.push(bar);
  }
  for (let i = -3; i <= 3; i++) {
    const bar = BABYLON.MeshBuilder.CreateBox("grateCross", { width: 8.6, height: 0.1, depth: 0.1 }, scene);
    bar.position.set(0, 0.02, i * 1.25);
    bar.material = grateMat; bar.parent = grate;
    bar.isPickable = false; bars.push(bar);
  }

  // ---------- Панель целей (справа, чтобы не наезжать на HUD) ----------
  const panel = document.createElement("div");
  panel.id = "storyPanel";
  panel.style.cssText = [
    "position:fixed", "right:14px", "top:14px", "z-index:70",
    "width:min(330px,calc(100vw - 28px))", "padding:10px 12px",
    "border:1px solid #4a6a2a", "border-right:4px solid #8f3",
    "background:rgba(9,16,7,.88)", "color:#e9ffd9",
    "font:14px/1.4 monospace", "pointer-events:none", "border-radius:4px",
  ].join(";");
  document.body.appendChild(panel);

  const end = document.createElement("div");
  end.id = "storyEnd";
  end.style.cssText = [
    "position:fixed", "inset:0", "z-index:85", "display:none",
    "align-items:center", "justify-content:center", "flex-direction:column",
    "gap:16px", "background:rgba(0,0,0,.92)", "color:#eee",
    "font:22px monospace", "text-align:center",
  ].join(";");
  function renderEnd() {
    end.innerHTML = `<div style="font-size:32px;color:#9f4">${t("ШАХТА ПРОЙДЕНА")}</div>
      <div>${t("Вы выбрались из-под земли, пока лес наверху поглощала кислота.")}</div>
      <button id="storyRestart" style="pointer-events:auto;font:18px monospace;padding:10px 24px;cursor:pointer">${t("Начать заново")}</button>`;
    end.querySelector("#storyRestart").onclick = () => location.reload();
  }
  renderEnd();
  document.body.appendChild(end);

  const STEPS = [
    { title: "Посмотрите монитор",
      text: "В лесу что-то грохнуло. Проверьте камеры — E у монитора в доме.",
      done: () => state.monitorViewed },
    { title: "Проверьте камеру",
      text: "Одна камера не отвечает. Дойдите до неё и снимите остальные (E).",
      done: () => state.remainsSeen },
    { title: "Исследуйте остатки",
      text: "Кислота растворила камеру — у дерева осталась слизь. Нажмите E и поковыряйте её стрелой.",
      done: () => !!player.st.resin },
    { title: "Расплавьте решётку",
      text: "Смола растворяет всё, кроме дерева. Опустите её на железную решётку над ямой (E).",
      done: () => !state.grateIntact },
    { title: "Спуститесь под землю",
      text: "Прыгните в открывшуюся яму.",
      done: () => state.inMine },
    { title: "Пройдите шахту",
      text: "Стреляйте по красным меткам на воротах, чтобы вагонетка ехала дальше.",
      done: () => state.completed },
  ];

  function renderPanel() {
    const s = STEPS[state.index];
    if (!s) return;
    panel.innerHTML = `<div style="font-size:11px;color:#9b9;letter-spacing:2px">${t("НОВАЯ ЦЕЛЬ · {n}/{m}", { n: state.index + 1, m: STEPS.length })}</div>
      <div style="font-size:17px;color:#fff;margin:3px 0">${t(s.title)}</div>
      <div>${t(s.text)}</div>`;
  }
  renderPanel();
  onLangChange(() => { renderPanel(); renderEnd(); });
  toast(t("Грохот в лесу… зелёная стена уже близко"));

  function advance() {
    state.index++;
    if (state.index < STEPS.length) {
      renderPanel();
      hud();
    }
  }

  function nearGrate() {
    return Math.hypot(player.mesh.position.x - PIT_CENTER.x,
      player.mesh.position.z - PIT_CENTER.z) < 5.5;
  }

  return {
    state,
    get grateIntact() { return state.grateIntact; },
    grateHint() {
      return state.grateIntact && !!player.st.resin && !state.melting && nearGrate();
    },
    pokeHint() {
      return state.remainsSeen && !player.st.resin && !state.poking && nearRemains();
    },
    // Монитор показывает «нет сигнала» для камеры, которую съела кислота.
    feedBroken(cam) { return cam === doomed.root; },
    // Находится ли камера за стеной заражения — фид тогда видит зелёное небо.
    zoneOutside(x, z) { return zone.isOutside(x, z); },
    // Куда ведёт жёлтая стрелка: монитор → камера/остатки → решётка.
    navTarget() {
      if (state.completed || state.melting || state.inMine) return null;
      if (!state.monitorViewed) return monitorPos;
      if (!state.resinTaken) return remainsPos || doomedPoint;
      if (state.grateIntact) return new BABYLON.Vector3(PIT_CENTER.x, 0.5, PIT_CENTER.z);
      return null;
    },
    tryPoke,
    tryMelt() {
      if (!(state.grateIntact && player.st.resin && nearGrate()) || state.melting) return false;
      // Не плавим мгновенно: сначала игрок «машет» стрелой над решёткой,
      // и с наконечника льётся много смолы.
      state.melting = true; state.meltT = 0;
      drips.emitRate = 120;
      drips.minSize = 0.025; drips.maxSize = 0.06;
      drips.minLifeTime = 0.55; drips.maxLifeTime = 1.05;
      toast(t("Вы проводите смолой над решёткой…"));
      hud();
      return true;
    },
    notifyCave() {
      if (state.completed || state.inMine) return;
      // Падение в вагонетку: сюжетная панель уступает место HUD шахты.
      state.inMine = true;
      panel.style.display = "none";
      hud();
    },
    finishMine() {
      if (state.completed) return;
      state.completed = true;
      state.inMine = false;
      end.style.display = "flex";
    },
    update(dt) {
      // Первый вход в монитор: игрок сам увидит камеру без сигнала.
      if (mgr.monitorActive && !state.monitorViewed) {
        state.monitorViewed = true;
        // Даже если игрок успел повесить камеру, первый обзор — сломанная.
        const i = mgr.list.indexOf(doomed.root);
        if (i >= 0) mgr.active = i;
        if (state.index === 0) advance();
        hud();
      }

      // Кислотная зона сжимается к дому; всё за ней заражается.
      if (!state.completed && !state.inMine) {
        zone.update(dt);
        state.infectT -= dt;
        if (state.infectT <= 0) {
          state.infectT = 0.4;
          refreshInfection(terrain);
        }
        updateCams(dt);

        // Список камер чистим только после выхода из монитора, иначе фид
        // переключится на другую камеру прямо во время просмотра.
        if (state.monitorViewed && !mgr.monitorActive && doomedListed) {
          doomedListed = false;
          if (!doomed.root.isDisposed()) doomed.root.dispose();
          removeCamera(mgr, doomed.root);
          hud();
        }

        // Игрок должен САМ увидеть, что осталось от камеры: близко и в кадре.
        if (!state.remainsSeen && state.cameraDown && remainsPos && !mgr.monitorActive) {
          const to = remainsPos.subtract(camera.position);
          const dist = to.length();
          if (dist < 11) {
            const fwd = camera.getDirection(new BABYLON.Vector3(0, 0, 1));
            if (BABYLON.Vector3.Dot(to.scale(1 / Math.max(dist, 0.001)), fwd) > 0.8) {
              state.remainsSeen = true;
              if (state.index === 1) advance();
            }
          }
        }
      }

      // Ковыряние стрелой: стрела стучит по слизи, на наконечнике растёт смола.
      if (state.poking) {
        state.pokeT += dt;
        const t = state.pokeT;
        const stab = Math.abs(Math.sin(t * 9));
        pokeArrow.position.y = pokeBaseY + 0.16 + stab * 0.3;
        pokeArrow.resin.scaling.setAll(Math.min(1, Math.max(0, (t - 0.45) / 0.7)));
        if (t >= 1.5) finishPoke();
      }

      // Стрела в руке слегка покачивается, как предмет в руке.
      if (player.st.resin && held.isEnabled()) {
        heldT += dt;
        heldPivot.rotation.z = Math.sin(heldT * 1.8) * 0.04;
        heldPivot.position.y = -0.18 + Math.sin(heldT * 2.3) * 0.008;
      }

      if (state.melting) {
        state.meltT += dt;
        const t = state.meltT;
        const k = Math.min(1, t / 2.4);
        // Машем стрелой над решёткой: наконечник ходит влево-вправо, а смола
        // льётся с него сплошным потоком.
        const swing = Math.sin(t * 7.5);
        heldPivot.position.x = -0.32 + swing * 0.24;
        heldPivot.position.y = -0.16 + Math.sin(t * 9.2) * 0.09;
        heldPivot.rotation.z = swing * 0.24;
        heldPivot.rotation.y = Math.cos(t * 7.5) * 0.16;
        drips.emitRate = 90 + 70 * k;
        grateMat.emissiveColor.set(0.9 * k, 0.12 * k, 0.02 * k);
        for (const b of bars) b.scaling.y = Math.max(0.01, 1 - k);
        if (k >= 1) {
          state.melting = false;
          state.grateIntact = false;
          grate.setEnabled(false);
          // Возвращаем стрелу в исходную позу и убираем её: смола израсходована.
          heldPivot.position.set(-0.32, -0.18, 0.66);
          heldPivot.rotation.set(0, 0, 0);
          held.setEnabled(false);
          player.st.resin = false;
          drips.emitRate = 14;
          drips.minSize = 0.015; drips.maxSize = 0.035;
          drips.minLifeTime = 0.35; drips.maxLifeTime = 0.8;
          drips.stop();
          toast(t("Решётка провалилась — проход в яму открыт"));
        }
      }

      const step = STEPS[state.index];
      if (step && step.done()) advance();
    },
  };
}
