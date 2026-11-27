// Изолированные сцены для ручного тестирования: ?scene=hunt|survival|camera|house|mine.
// Сцены НЕ подменяют игровые механики — они только готовят начальное состояние
// через те же функции (spawnAnimal/placeCamera/костёр/урон) и очищают его между запусками.
// Обычная игра без ?scene= не знает об этом модуле.
import * as BABYLON from "@babylonjs/core";
import { getHeight, HOUSE_POS, PIT_CENTER } from "./noise.js";
import { spawnAnimal, animals, arrows, meats, resins } from "./entities.js";
import { t, onLangChange } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const EYE = 0.45; // смещение камеры над центром капсулы (как в updatePlayer)
const at = (x, z, dy = 0.6) => new BABYLON.Vector3(x, getHeight(x, z) + dy, z);
// Направление «от academia к цели» для курса игрока (Babylon: вперёд = +Z при yaw=0).
const yawTo = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);

export function createTestScenes(ctx) {
  const { scene, player, camera, campfire, door, glass, mgr, hud, buildCamera, mine } = ctx;

  function placePlayer(x, z, yaw, opts = {}) {
    const { mesh, st } = player;
    const y = opts.y !== undefined ? opts.y : getHeight(x, z) + 0.6;
    mesh.position.set(x, y, z);
    st.spawn.set(x, y, z);
    st.vel.set(0, 0, 0);
    st.grounded = false;
    st.hp = opts.hp !== undefined ? opts.hp : 100;
    st.meat = opts.meat !== undefined ? opts.meat : 0;
    st.yaw = yaw;
    st.pitch = opts.pitch || 0;
    st.flash = 0;
    $("dmgFlash").style.opacity = "0";
    camera.position.set(x, y + EYE, z);
    camera.rotation.set(st.pitch, yaw, 0);
    hud();
  }

  // Сброс всего, что сцена могла изменить: стрелы, звери, мясо, камеры, дверь,
  // стекло, костёр и состояние ямы/пещеры в основном модуле.
  function resetAll() {
    if (mine) mine.stop();
    ctx.resetRuntime();

    for (const a of arrows) if (!a.mesh.isDisposed()) a.mesh.dispose();
    arrows.length = 0;
    for (const m of meats) if (!m.mesh.isDisposed()) m.mesh.dispose();
    meats.length = 0;
    for (const c of resins) if (!c.mesh.isDisposed()) c.mesh.dispose();
    resins.length = 0;
    for (const an of animals) if (an.mesh && !an.mesh.isDisposed()) an.mesh.dispose();
    animals.length = 0;
    for (const cam of mgr.list) if (!cam.isDisposed()) cam.dispose();
    mgr.list.length = 0;
    mgr.active = -1;
    mgr.marked = -1;
    mgr.monitorActive = false;
    $("camLabel").style.display = "none";
    $("monitorHelp").style.display = "none";

    // Осколки разбитого окна живут 2–4с сами; при перезапуске убираем сразу.
    for (const m of scene.meshes.slice()) if (m.name === "shard") m.dispose();
    glass.broken = false;
    glass.mesh.setEnabled(true);

    door.open = false;
    door.target = 0;
    door.pivot.rotation.y = 0;

    campfire.phase = "idle";
    campfire.t = 0;
    campfire.readyFlash = false;
    campfire.meat.setEnabled(false);
  }

  // spawnAnimal асинхронно грузит .glb; опционально фиксируем скорость только
  // у этого экземпляра (клон info — глобальные KINDS не трогаем).
  function spawn(kind, x, z, opts = {}) {
    return spawnAnimal(scene, kind, at(x, z, 0.5)).then((an) => {
      if (opts.speed !== undefined) an.info = { ...an.info, speed: opts.speed };
      return an;
    });
  }

  const SCENES = [
    {
      id: "hunt",
      name: "Стрелы · две жизни · урон",
      goal: "Проверить застревание стрел и две жизни лисы/волка, урон и смерть игрока.",
      mechanics: [
        "ЛКМ — натяжение лука, полёт и гравитация стрелы",
        "попадание по хитбоксу зверя, урон 1",
        "стрела застревает в звере и следует за ним",
        "лиса/волк: 2 жизни, после первого попадания — агрессия",
        "смерть зверя и отлипание стрелы",
        "урон игроку, красная вспышка, смерть и респавн",
      ],
      start: "Поляна. HP 40, 0 мяса. Лиса в ~10 м, волк в ~13 м. Их скорость обнулена, чтобы было удобно целиться.",
      steps: [
        "Кликните по экрану — захват мыши.",
        "Выстрелите в лису один раз (удержите ЛКМ 0.5–1 с и отпустите).",
        "Проверьте: стрела торчит в лисе, лиса жива и смотрит на вас.",
        "Выстрелите в лису второй раз — она умрёт, стрела упадёт.",
        "Повторите оба выстрела на волке.",
        "Подойдите к зверю вплотную и дайте ему ударить — HP упадёт, экран покраснеет.",
        "Доведите HP до нуля — смерть и возврат на старт сцены.",
      ],
      expected: "После 1-го попадания зверь жив (1 HP) и стрела видна в нём; после 2-го — смерть, тело исчезает через 0.7 с, стрела падает и подбирается ЛКМ. Удар волка — 12 HP, лисы — 8. При 0 HP игрок воскресает на старте сцены со 100 HP.",
      notCovered: "Кролик и мясо, костёр, камеры, дом, шахта. Обычное преследование зверей здесь не проверяется (speed=0).",
      setup() {
        placePlayer(0, -20, 0, { hp: 40, meat: 0 });
        spawn("fox", -2.5, -10, { speed: 0 });
        spawn("wolf", 3, -7, { speed: 0 });
      },
    },
    {
      id: "survival",
      name: "Кролик · мясо · костёр",
      goal: "Проверить цикл добычи и лечения: кролик → мясо → жарка → еда.",
      mechanics: [
        "кролик: 1 HP, убегает от игрока ближе 4.2 м",
        "дроп мяса при смерти кролика",
        "автоподбор мяса в радиусе 1.2 м и счётчик в HUD",
        "костёр: ЛКМ жарит 8 с, готовое мясо лечит до 100 HP",
        "сообщения «нет мяса» и «здоровье полное»",
      ],
      start: "У костра (HP 40, 0 мяса), два кролика в 8–11 м. Хищников нет.",
      steps: [
        "Нажмите ЛКМ у костра без мяса — появится сообщение «Нет сырого мяса».",
        "Застрелите кролика и подойдите к выпавшему мясу — оно подберётся само.",
        "Нажмите ЛКМ у костра — начнётся жарка (8 с), на шампуре появится мясо.",
        "Дождитесь готовности и нажмите ЛКМ ещё раз — HP станет 100.",
        "Убейте второго кролика, возьмите мясо и попробуйте жарить при полном HP.",
      ],
      expected: "Мясо падает рядом с кроликом и исчезает при подходе, счётчик «Мясо» растёт. Во время жарки подсказка считает секунды; после еды HP = 100 и при полном здоровье отображается «Здоровье и так полное».",
      notCovered: "Хищники и их урон, застревание стрел, камеры, дом, шахта.",
      setup() {
        placePlayer(HOUSE_POS.x + 2.6, HOUSE_POS.z - 2.6, Math.PI, { hp: 40, meat: 0 });
        spawn("rabbit", -13, -15);
        spawn("rabbit", -12, -12);
      },
    },
    {
      id: "camera",
      name: "Камеры и монитор",
      goal: "Проверить монитор, фид, переключение камер, метку и снятие камеры.",
      mechanics: [
        "E у экрана — вход в режим монитора",
        "фид активной камеры на экране",
        "C/X — переключение, WASD/стрелки — поворот",
        "M — метка, стрелка-навигатор после выхода",
        "E по камере в радиусе 8 м — снять камеру",
      ],
      start: "Внутри дома перед монитором. Две камеры уже установлены (одна у двери, вторая над поляной), 3 слота свободны. HP 100.",
      steps: [
        "Кликните по экрану, нажмите E, глядя на монитор.",
        "Покрутите камеру стрелками/WASD, переключите C и X — проверьте фид.",
        "Поставьте метку M, выйдите E или Esc и посмотрите на стрелку-навигатор.",
        "Выйдите из дома, посмотрите на камеру у двери и нажмите E — камера снимется.",
      ],
      expected: "Экран загорается картинкой с камеры; счётчик «Камеры: 2 / 5». У отмеченной камеры рядом с номером появляется «— метка». Метка переживает выход по E/Esc, стрелка указывает на неё. E по камере удаляет её и уменьшает счётчик.",
      notCovered: "Постановка камеры на ствол дерева (деревья начинаются за 26 м от центра), урон/охота, костёр, шахта.",
      setup() {
        placePlayer(HOUSE_POS.x + 0.7, HOUSE_POS.z - 0.6, Math.PI / 2, { y: 0.8 });
        const mount = (x, y, z, tx, tz) => {
          const from = new BABYLON.Vector3(x, y, z);
          buildCamera(from, new BABYLON.Vector3(tx - x, 0, tz - z).normalize());
        };
        mount(2, 7, -12, PIT_CENTER.x, PIT_CENTER.z);
        mount(-4.5, 2.2, -9.5, HOUSE_POS.x, HOUSE_POS.z);
      },
    },
    {
      id: "house",
      name: "Дом: дверь и стекло",
      goal: "Проверить открытие двери и разбивание окна стрелой.",
      mechanics: [
        "E в радиусе 4 м — открыть/закрыть дверь",
        "плавный доворот створки (-100°, 2.2 рад/с)",
        "попадание стрелы в стекло → 16 осколков",
      ],
      start: "Перед домом, в 2 м от двери. Дверь закрыта, окно цело. HP 100.",
      steps: [
        "Нажмите E — дверь откроется; нажмите ещё раз — закроется.",
        "Обойдите дом слева и встаньте так, чтобы окно (левая стена) было перед вами.",
        "Выстрелите в стекло — оно должно разбиться.",
        "Нажмите R, чтобы вернуть дверь и стекло в исходное состояние.",
      ],
      expected: "Подсказка «E — открыть/закрыть дверь», створка плавно поворачивается. После попадания стекло исчезает и сыплются 16 осколков (живут 2–4 с).",
      notCovered: "Внутренняя мебель, монитор и камеры, охота, шахта.",
      setup() {
        placePlayer(HOUSE_POS.x, HOUSE_POS.z - 4.2, yawTo(HOUSE_POS.x, HOUSE_POS.z - 4.2, HOUSE_POS.x + 0.45, HOUSE_POS.z - 2.17));
      },
    },
    {
      id: "mine",
      name: "Шахта · вагонетка",
      goal: "Проверить поездку в вагонетке, механизмы ворот, динамику тоннеля и пасхалки.",
      mechanics: [
        "вагонетка едет сама, тормозит перед закрытыми воротами",
        "три механизма: чека лебёдки, замок на цепи, бочка пороха",
        "противовес падает и тянет трос, створка уезжает вверх",
        "пыль, падающие камни, тряска на битых путях, летучие мыши",
        "три пасхалки: шестерёнка, канарейка, скелет шахтёра",
      ],
      start: "Вы уже в вагонетке в начале тоннеля. HP 100. Впереди трое ворот.",
      steps: [
        "Кликните по экрану — захват мыши.",
        "Подъезжая к воротам, найдите красный механизм с пульсирующим кольцом и табличкой.",
        "Выстрелите в него и проследите: противовес падает, трос тянется за ним, створка поднимается.",
        "На среднем участке проверьте тряску и искры на битых путях, летучих мышей.",
        "Простерелите пасхалки: шестерёнку на стене, клетку с канарейкой, каску скелета.",
        "Доедьте до зелёной арки — HUD покажет, что шахта пройдена.",
        "Нажмите R для повтора.",
      ],
      expected: "Вагонетка останавливается перед закрытыми воротами. После попадания в механизм трос остаётся соединённым с падающим противовесом, створка уходит вверх, движение продолжается. Счётчик «Секреты» растёт до 3 / 3, у каждой пасхалки свой эффект.",
      notCovered: "Сюжетная решётка над ямой и переход из леса в шахту (проверяются в обычной игре), звери, дом, камеры.",
      setup() {
        player.st.hp = 100; player.st.meat = 0; hud();
        mine.start();
      },
    },
  ];

  const panel = document.createElement("div");
  panel.id = "testScenePanel";
  panel.style.cssText = [
    "position:fixed", "left:10px", "top:10px", "z-index:80",
    "width:min(380px,calc(100vw - 20px))", "max-height:calc(100vh - 20px)",
    "overflow:auto", "padding:10px 12px", "border:1px solid #3f6",
    "border-radius:6px", "background:rgba(8,14,10,.88)",
    "color:#d8f5dc", "font:12px/1.4 monospace", "pointer-events:none",
  ].join(";");
  document.body.appendChild(panel);

  function renderPanel(def) {
    const li = (arr) => arr.map((s) => `<li>${t(s)}</li>`).join("");
    panel.innerHTML = `
      <div style="font:bold 13px monospace;color:#8f8">${t("ТЕСТ: {name}", { name: t(def.name) })}</div>
      <div style="margin:6px 0;color:#9c9">${t("Цель: {goal}", { goal: t(def.goal) })}</div>
      <div><b>${t("Механики:")}</b><ul style="margin:2px 0 0 16px;padding:0">${li(def.mechanics)}</ul></div>
      <div style="margin-top:6px"><b>${t("Старт:")}</b> ${t(def.start)}</div>
      <div style="margin-top:6px"><b>${t("Сделайте:")}</b><ol style="margin:2px 0 0 16px;padding:0">${li(def.steps)}</ol></div>
      <div style="margin-top:6px"><b>${t("Ожидается:")}</b> ${t(def.expected)}</div>
      <div style="margin-top:6px;color:#f99"><b>${t("Не покрывает:")}</b> ${t(def.notCovered)}</div>
      <div style="margin-top:8px;color:#8f8">${t("R — перезапустить · N/P — следующая/предыдущая сцена")}</div>
      <div style="margin-top:6px;pointer-events:auto">
        <select id="testSceneSelect" style="font:12px monospace;background:#111;color:#dfd">
          ${SCENES.map((s) => `<option value="${s.id}"${s.id === def.id ? " selected" : ""}>${t(s.name)}</option>`).join("")}
        </select>
      </div>`;
    $("testSceneSelect").onchange = (e) => switchTo(e.target.value);
  }
  onLangChange(() => {
    const def = SCENES.find((s) => s.id === current) || SCENES[0];
    renderPanel(def);
  });

  let current = SCENES[0].id;
  function switchTo(id) {
    const def = SCENES.find((s) => s.id === id) || SCENES[0];
    current = def.id;
    resetAll();
    renderPanel(def);
    def.setup();
  }
  function step(delta) {
    const i = SCENES.findIndex((s) => s.id === current);
    switchTo(SCENES[(i + delta + SCENES.length) % SCENES.length].id);
  }

  ctx.autoStart();
  const requested = new URLSearchParams(location.search).get("scene");
  switchTo(requested);

  return {
    restart: () => switchTo(current),
    next: () => step(1),
    prev: () => step(-1),
    switchTo,
    get current() { return current; },
    ids: SCENES.map((s) => s.id),
  };
}
