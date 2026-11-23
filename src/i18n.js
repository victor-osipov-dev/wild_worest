// Локализация RU/EN.
// Язык определяется на старте через SDK Яндекс Игр: environment.i18n.lang
// (требование 2.14). Вне платформы — по ?lang= / navigator.language.
// Все строки исходно написаны по-русски: t("русский текст") возвращает
// английский вариант, если выбран язык en. Параметры подставляются в {плейсхолдеры}.

const EN = {
  // --- загрузка / меню ---
  "ПОСЛЕДНИЙ ДЕНЬ В ЛЕСУ": "THE LAST DAY IN THE FOREST",
  "Запуск…": "Starting…",
  "Загружаем текстуры…": "Loading textures…",
  "Запекаем лес…": "Baking the forest…",
  "Грузим модели зверей…": "Loading animal models…",
  "Почти готово…": "Almost there…",
  "Готово": "Ready",
  "Сменить язык": "Change language",

  // --- HUD ---
  "Здоровье: 100<br>Мясо: 0": "Health: 100<br>Meat: 0",
  "Здоровье: {hp}<br>Мясо: {meat}": "Health: {hp}<br>Meat: {meat}",
  "Смола: есть": "Resin: found",
  "Камеры: 0 / 5": "Cameras: 0 / 5",
  "Камеры: {n} / 5": "Cameras: {n} / 5",
  "ШАХТА · ВАГОНЕТКА": "MINE · MINECART",
  "Кликни, чтобы захватить мышь": "Click to capture the mouse",
  "Стрелки / WASD — вращение камеры<br>C — следующая | X — предыдущая | M — метка<br>E или Esc — выйти":
    "Arrows / WASD — rotate camera<br>C — next | X — previous | M — marker<br>E or Esc — exit",
  "ПАУЗА": "PAUSED",
  "Продолжить": "Resume",
  "Заново (дом)": "Restart (home)",
  "WASD — движение, Space — прыжок, ЛКМ (удерживать) — натянуть лук, E — дверь / камеры / монитор":
    "WASD — move, Space — jump, LMB (hold) — draw the bow, E — door / cameras / monitor",
  "Играть": "Play",

  // --- камеры / монитор ---
  "Метка поставлена": "Marker placed",
  "Метка снята": "Marker removed",
  "Камера": "Camera",
  "Следующая / предыдущая": "Next / previous",
  "Поворот камеры": "Rotate camera",
  "Поставить метку": "Place marker",
  "Выйти": "Exit",
  "НЕТ СИГНАЛА": "NO SIGNAL",
  "Камера {n} — нет сигнала": "Camera {n} — no signal",
  " — метка": " — marked",
  "Камера {n} из {m}{mark}": "Camera {n} of {m}{mark}",

  // --- подсказки ---
  "E — поковырять слизь стрелой": "E — poke the slime with an arrow",
  "E — расплавить решётку смолой": "E — melt the grate with resin",
  "E — посмотреть камеры": "E — view the cameras",
  "Мясо жарится… {n}с": "Meat is cooking… {n}s",
  "ЛКМ — съесть жареное мясо": "LMB — eat the cooked meat",
  "ЛКМ — пожарить мясо": "LMB — cook the meat",
  "Костёр: нет сырого мяса": "Campfire: no raw meat",
  "E — повесить камеру на ствол": "E — hang a camera on a tree",
  "Камеры: 5 / 5": "Cameras: 5 / 5",
  "E — открыть/закрыть дверь": "E — open/close the door",

  // --- тосты ---
  "Жареное мясо готово — тыкни по костру": "Cooked meat is ready — click the campfire",
  "Вы загорелись!": "You are on fire!",
  "Вы горите!": "YOU'RE BURNING!",
  "Сожги дом": "Burn down the house",
  "Дом загорелся!": "The house is on fire!",
  "Крыша сгорела!": "The roof burned down!",
  "ВЫПОЛНЕНО": "COMPLETED",
  "АЧИВКА РАЗБЛОКИРОВАНА": "ACHIEVEMENT UNLOCKED",
  "Попал в себя!": "You hit yourself!",
  "Камера взорвалась!": "Camera exploded!",
  "Здоровье и так полное": "Health is already full",
  "Жареное мясо съедено — здоровье восстановлено": "Cooked meat eaten — health restored",
  "Нет сырого мяса — охоться на кролика": "No raw meat — hunt a rabbit",
  "Мясо заряжено на жарку": "Meat put on to cook",
  "Смола получена — используйте её на решётке ямы": "Resin collected — use it on the pit grate",
  "КИСЛОТНАЯ ЗОНА — возвращайтесь к дому!": "ACID ZONE — return to the house!",
  "Вы ковыряете слизь стрелой…": "You poke the slime with an arrow…",
  "Смола на стреле. Похоже, она растворяет всё, кроме дерева.":
    "Resin on the arrow. It seems to dissolve everything except wood.",
  "Грохот в лесу… зелёная стена уже близко": "A rumble in the forest… the green wall is closing in",
  "Вы проводите смолой над решёткой…": "You drip resin over the grate…",
  "Решётка провалилась — проход в яму открыт": "The grate collapsed — the pit is open",
  "Вагонетка покатилась! Стреляйте по красным меткам на воротах":
    "The minecart is rolling! Shoot the red targets on the gates",
  "Метка прострелена — ворота открываются": "Target hit — the gate is opening",

  // --- шахта ---
  "Ворота закрыты! Прострелите красную метку": "Gate closed! Shoot the red target",
  "Впереди ворота — стреляйте по красной метке": "Gate ahead — shoot the red target",
  "Ворота {n} из {m} · {d} м": "Gate {n} of {m} · {d} m",
  "Ворота {n} из {m} · до выхода {d} м": "Gates {n} of {m} · {d} m to exit",

  // --- сюжет: цели ---
  "НОВАЯ ЦЕЛЬ · {n}/{m}": "NEW OBJECTIVE · {n}/{m}",
  "Посмотрите монитор": "Check the monitor",
  "В лесу что-то грохнуло. Проверьте камеры — E у монитора в доме.":
    "Something crashed in the forest. Check the cameras — press E at the monitor in the house.",
  "Проверьте камеру": "Inspect the camera",
  "Одна камера не отвечает. Дойдите до неё и снимите остальные (E).":
    "One camera is offline. Reach it and take down the others (E).",
  "Исследуйте остатки": "Investigate the remains",
  "Кислота растворила камеру — у дерева осталась слизь. Нажмите E и поковыряйте её стрелой.":
    "Acid dissolved the camera — slime remains on the tree. Press E and poke it with an arrow.",
  "Расплавьте решётку": "Melt the grate",
  "Смола растворяет всё, кроме дерева. Опустите её на железную решётку над ямой (E).":
    "Resin dissolves everything except wood. Drip it onto the iron grate over the pit (E).",
  "Спуститесь под землю": "Go underground",
  "Прыгните в открывшуюся яму.": "Jump into the open pit.",
  "Пройдите шахту": "Clear the mine",
  "Стреляйте по красным меткам на воротах, чтобы вагонетка ехала дальше.":
    "Shoot the red targets on the gates to keep the minecart moving.",
  "ШАХТА ПРОЙДЕНА": "MINE CLEARED",
  "Вы выбрались из-под земли, пока лес наверху поглощала кислота.":
    "You made it out from underground while acid consumed the forest above.",
  "Начать заново": "Play again",

  // --- тестовые сцены (?scene=...) ---
  "ТЕСТ: {name}": "TEST: {name}",
  "Цель: {goal}": "Goal: {goal}",
  "Механики:": "Mechanics:",
  "Старт:": "Start:",
  "Сделайте:": "Do this:",
  "Ожидается:": "Expected:",
  "Не покрывает:": "Not covered:",
  "R — перезапустить · N/P — следующая/предыдущая сцена":
    "R — restart · N/P — next/previous scene",
  "Стрелы · две жизни · урон": "Arrows · two lives · damage",
  "Проверить застревание стрел и две жизни лисы/волка, урон и смерть игрока.":
    "Check arrow sticking, two lives of the fox/wolf, damage and player death.",
  "ЛКМ — натяжение лука, полёт и гравитация стрелы": "LMB — draw the bow, arrow flight and gravity",
  "попадание по хитбоксу зверя, урон 1": "hit the animal's hitbox, 1 damage",
  "стрела застревает в звере и следует за ним": "the arrow sticks in the animal and follows it",
  "лиса/волк: 2 жизни, после первого попадания — агрессия":
    "fox/wolf: 2 lives, aggression after the first hit",
  "смерть зверя и отлипание стрелы": "animal death and the arrow falling off",
  "урон игроку, красная вспышка, смерть и респавн":
    "damage to the player, red flash, death and respawn",
  "Поляна. HP 40, 0 мяса. Лиса в ~10 м, волк в ~13 м. Их скорость обнулена, чтобы было удобно целиться.":
    "Clearing. HP 40, 0 meat. Fox at ~10 m, wolf at ~13 m. Their speed is zero to make aiming easier.",
  "Кликните по экрану — захват мыши.": "Click the screen to capture the mouse.",
  "Выстрелите в лису один раз (удержите ЛКМ 0.5–1 с и отпустите).":
    "Shoot the fox once (hold LMB for 0.5–1 s and release).",
  "Проверьте: стрела торчит в лисе, лиса жива и смотрит на вас.":
    "Check: the arrow sticks in the fox, the fox is alive and looking at you.",
  "Выстрелите в лису второй раз — она умрёт, стрела упадёт.":
    "Shoot the fox a second time — it dies and the arrow drops.",
  "Повторите оба выстрела на волке.": "Repeat both shots on the wolf.",
  "Подойдите к зверю вплотную и дайте ему ударить — HP упадёт, экран покраснеет.":
    "Get close to the animal and let it hit you — HP drops and the screen flashes red.",
  "Доведите HP до нуля — смерть и возврат на старт сцены.":
    "Bring HP to zero — death and return to the scene start.",
  "После 1-го попадания зверь жив (1 HP) и стрела видна в нём; после 2-го — смерть, тело исчезает через 0.7 с, стрела падает и подбирается ЛКМ. Удар волка — 12 HP, лисы — 8. При 0 HP игрок воскресает на старте сцены со 100 HP.":
    "After the 1st hit the animal is alive (1 HP) with the arrow visible in it; after the 2nd — death, the body disappears after 0.7 s, the arrow drops and can be picked up with LMB. Wolf hit — 12 HP, fox — 8. At 0 HP the player respawns at the scene start with 100 HP.",
  "Кролик и мясо, костёр, камеры, дом, яма/пещера. Обычное преследование зверей здесь не проверяется (speed=0).":
    "Rabbit and meat, campfire, cameras, house, pit/cave. Normal animal chasing is not tested here (speed=0).",
  "Кролик · мясо · костёр": "Rabbit · meat · campfire",
  "Проверить цикл добычи и лечения: кролик → мясо → жарка → еда.":
    "Check the hunting and healing loop: rabbit → meat → cooking → eating.",
  "кролик: 1 HP, убегает от игрока ближе 4.2 м": "rabbit: 1 HP, flees from the player within 4.2 m",
  "дроп мяса при смерти кролика": "meat drop when the rabbit dies",
  "автоподбор мяса в радиусе 1.2 м и счётчик в HUD": "auto-pickup of meat within 1.2 m and the HUD counter",
  "костёр: ЛКМ жарит 8 с, готовое мясо лечит до 100 HP":
    "campfire: LMB cooks for 8 s, cooked meat heals up to 100 HP",
  "сообщения «нет мяса» и «здоровье полное»": "messages «no meat» and «health full»",
  "У костра (HP 40, 0 мяса), два кролика в 8–11 м. Хищников нет.":
    "By the campfire (HP 40, 0 meat), two rabbits at 8–11 m. No predators.",
  "Нажмите ЛКМ у костра без мяса — появится сообщение «Нет сырого мяса».":
    "Press LMB at the campfire with no meat — the message «No raw meat» appears.",
  "Застрелите кролика и подойдите к выпавшему мясу — оно подберётся само.":
    "Shoot a rabbit and walk to the dropped meat — it is picked up automatically.",
  "Нажмите ЛКМ у костра — начнётся жарка (8 с), на шампуре появится мясо.":
    "Press LMB at the campfire — cooking starts (8 s) and meat appears on the spit.",
  "Дождитесь готовности и нажмите ЛКМ ещё раз — HP станет 100.":
    "Wait until it is ready and press LMB again — HP becomes 100.",
  "Убейте второго кролика, возьмите мясо и попробуйте жарить при полном HP.":
    "Kill the second rabbit, take the meat and try cooking at full HP.",
  "Мясо падает рядом с кроликом и исчезает при подходе, счётчик «Мясо» растёт. Во время жарки подсказка считает секунды; после еды HP = 100 и при полном здоровье отображается «Здоровье и так полное».":
    "Meat drops next to the rabbit and disappears when approached; the «Meat» counter increases. During cooking the hint counts seconds; after eating HP = 100 and at full health «Health is already full» is shown.",
  "Хищники и их урон, застревание стрел, камеры, дом, яма/пещера.":
    "Predators and their damage, arrow sticking, cameras, house, pit/cave.",
  "Камеры и монитор": "Cameras and monitor",
  "Проверить монитор, фид, переключение камер, метку и снятие камеры.":
    "Check the monitor, the feed, camera switching, the marker and camera removal.",
  "E у экрана — вход в режим монитора": "E at the screen — enter monitor mode",
  "фид активной камеры на экране": "active camera feed on the screen",
  "C/X — переключение, WASD/стрелки — поворот": "C/X — switch, WASD/arrows — rotate",
  "M — метка, стрелка-навигатор после выхода": "M — marker, navigator arrow after exit",
  "E по камере в радиусе 8 м — снять камеру": "E on a camera within 8 m — remove it",
  "Внутри дома перед монитором. Две камеры уже установлены (одна у двери, вторая над поляной), 3 слота свободны. HP 100.":
    "Inside the house in front of the monitor. Two cameras are installed (one by the door, one over the clearing), 3 slots free. HP 100.",
  "Кликните по экрану, нажмите E, глядя на монитор.": "Click the screen, then press E while looking at the monitor.",
  "Покрутите камеру стрелками/WASD, переключите C и X — проверьте фид.":
    "Rotate the camera with arrows/WASD, switch with C and X — check the feed.",
  "Поставьте метку M, выйдите E или Esc и посмотрите на стрелку-навигатор.":
    "Place a marker with M, exit with E or Esc and look at the navigator arrow.",
  "Выйдите из дома, посмотрите на камеру у двери и нажмите E — камера снимется.":
    "Leave the house, look at the camera by the door and press E — it is removed.",
  "Экран загорается картинкой с камеры; счётчик «Камеры: 2 / 5». У отмеченной камеры рядом с номером появляется «— метка». Метка переживает выход по E/Esc, стрелка указывает на неё. E по камере удаляет её и уменьшает счётчик.":
    "The screen lights up with the camera feed; the counter reads «Cameras: 2 / 5». The marked camera shows «— marked» next to its number. The marker survives exiting with E/Esc and the arrow points to it. Pressing E on a camera removes it and decreases the counter.",
  "Постановка камеры на ствол дерева (деревья начинаются за 26 м от центра), урон/охота, костёр, яма.":
    "Mounting a camera on a tree trunk (trees start 26 m from the centre), damage/hunting, campfire, pit.",
  "Дом: дверь и стекло": "House: door and glass",
  "Проверить открытие двери и разбивание окна стрелой.": "Check opening the door and breaking the window with an arrow.",
  "E в радиусе 4 м — открыть/закрыть дверь": "E within 4 m — open/close the door",
  "плавный доворот створки (-100°, 2.2 рад/с)": "smooth door rotation (-100°, 2.2 rad/s)",
  "попадание стрелы в стекло → 16 осколков": "arrow hits the glass → 16 shards",
  "Перед домом, в 2 м от двери. Дверь закрыта, окно цело. HP 100.":
    "In front of the house, 2 m from the door. The door is closed, the window intact. HP 100.",
  "Нажмите E — дверь откроется; нажмите ещё раз — закроется.": "Press E — the door opens; press again — it closes.",
  "Обойдите дом слева и встаньте так, чтобы окно (левая стена) было перед вами.":
    "Walk around the house on the left and stand so the window (left wall) is in front of you.",
  "Выстрелите в стекло — оно должно разбиться.": "Shoot the glass — it should break.",
  "Нажмите R, чтобы вернуть дверь и стекло в исходное состояние.":
    "Press R to reset the door and glass to their initial state.",
  "Подсказка «E — открыть/закрыть дверь», створка плавно поворачивается. После попадания стекло исчезает и сыплются 16 осколков (живут 2–4 с).":
    "The hint «E — open/close the door» appears and the door rotates smoothly. After the hit the glass disappears and 16 shards fall (they live 2–4 s).",
  "Внутренняя мебель, монитор и камеры, охота, яма/пещера.":
    "Interior furniture, monitor and cameras, hunting, pit/cave.",
  "Яма и пещера": "Pit and cave",
  "Проверить падение в яму, затемнение и возврат из пещеры.":
    "Check falling into the pit, the fade and returning from the cave.",
  "триггер падения в воронке (центр 8,0)": "fall trigger in the crater (centre 8,0)",
  "fade 0.9 с и телепорт в пещеру": "0.9 s fade and teleport to the cave",
  "зелёная метка выхода и возврат на поверхность": "green exit marker and return to the surface",
  "В 6.5 м к северу от ямы, лицом к ней. HP 100.": "6.5 m north of the pit, facing it. HP 100.",
  "Идите вперёд (W) прямо в воронку до падения.": "Walk forward (W) straight into the crater until you fall.",
  "Дождитесь затемнения — окажетесь в пещере.": "Wait for the fade — you end up in the cave.",
  "Найдите зелёную метку у стены и подойдите к ней.": "Find the green marker by the wall and walk up to it.",
  "Проверьте возврат на поверхность, затем нажмите R для повтора.":
    "Check the return to the surface, then press R to repeat.",
  "После падения экран плавно темнеет за ~0.9 с, игрок появляется в пещере с факелом. Подход к зелёной метке возвращает на поверхность рядом с ямой.":
    "After falling the screen fades over ~0.9 s, the player appears in the cave with a torch. Walking to the green marker returns you to the surface near the pit.",
  "Урон от шипов (они только визуальные), звери, дом, камеры, костёр.":
    "Damage from spikes (they are visual only), animals, house, cameras, campfire.",
};

const CIS = new Set(["be", "kk", "uk", "uz", "ky", "tt"]);
const SUPPORTED = new Set(["ru", "en"]);

function normalize(code) {
  if (!code) return null;
  const s = String(code).toLowerCase();
  if (s.startsWith("ru") || CIS.has(s)) return "ru";
  if (s.startsWith("en")) return "en";
  return "en"; // резервный язык для неподдерживаемых локалей
}

function guessFromUrlOrBrowser() {
  const q = new URLSearchParams(location.search).get("lang");
  if (q && SUPPORTED.has(q.toLowerCase())) return q.toLowerCase();
  return normalize(navigator.language) || "en";
}

let lang = guessFromUrlOrBrowser();
const listeners = new Set();

export function getLang() { return lang; }

export function t(ru, params) {
  const src = lang === "en" ? (EN[ru] ?? ru) : ru;
  if (!params) return src;
  return src.replace(/\{(\w+)\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : m);
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function applyStatic() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  const btn = document.getElementById("langBtn");
  if (btn) {
    const label = btn.querySelector("[data-lang-label]");
    if (label) label.textContent = lang === "ru" ? "English" : "Русский";
    btn.title = t("Сменить язык");
  }
}

export function setLang(next) {
  const norm = normalize(next);
  if (!norm || norm === lang) return;
  lang = norm;
  applyStatic();
  for (const fn of listeners) { try { fn(lang); } catch (e) { console.warn("i18n listener:", e); } }
}

// Загрузка официального скрипта SDK. На сервере Яндекса — относительный путь,
// на своём домене — абсолютный (по документации SDK).
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

const withTimeout = (p, ms) => Promise.race([
  p,
  new Promise((_, reject) => setTimeout(() => reject(new Error("sdk timeout")), ms)),
]);

async function detectYandexLang() {
  const onYandex = /yandex\.(ru|com|com\.tr|kz|by|uz)/i.test(location.hostname);
  const urls = onYandex
    ? ["/sdk.js", "https://sdk.games.s3.yandex.net/sdk.js"]
    : ["https://sdk.games.s3.yandex.net/sdk.js"];
  for (const url of urls) {
    try {
      if (!window.YaGames) await withTimeout(loadScript(url), 4000);
      if (!window.YaGames) continue;
      const ysdk = await withTimeout(window.YaGames.init(), 4000);
      window.ysdk = ysdk;
      const code = ysdk?.environment?.i18n?.lang;
      if (code) return normalize(code);
    } catch { /* не в Яндекс Играх — остаётся язык браузера */ }
  }
  return null;
}

// Вызывается сразу при запуске, пока виден экран загрузки.
export function initI18n() {
  applyStatic();
  detectYandexLang().then((code) => { if (code) setLang(code); });
}
