# 3DGame — Babylon.js port

Порт Godot-проекта `3dgame` (игрок, лук/стрелы, камеры наблюдения, мобы, яма/пещера, дверь, стекло, мясо, террейн) на Babylon.js. Оригинал не тронут — всё здесь.

## Запуск

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # прод-сборка в dist/
```

## Соответствие механик (константы 1:1 из .gd)

| Механика | Оригинал | Порт |
|---|---|---|
| Игрок | SPEED 5, JUMP 4.5, sens 0.002, HP 100 | `entities.js:createPlayer/updatePlayer` |
| Лук | натяжение 0.15–1.2с, 6–25 м/с (t²), гравитация 1.2→0, подбор 8м | `entities.js:createBow/shootArrow` |
| Стрела | урон 1, прилипание, подбор | `entities.js:updateArrows` |
| Мобы | h/speed/hp/dmg rabbit .45/1.7/1/0, fox .55/1.3/1/8, wolf .7/1.1/1/12, bear .95/.7/2/25; aggro 24/16м, атака 1.1/1.9м, кд 1.2с | `entities.js:spawnAnimal/updateAnimals` |
| Камеры | max 5, монитор 5м, поворот 2 рад/с, pitch 85°/yaw 75°, фид 960×540 fov 110 | `main.js` + `entities.js` |
| Террейн | чанки 32м 5×5, noise FBM, деревья 42%, дом (-8,-5), яма (8,0) r3.2 d14 | `terrain.js`, `noise.js` |
| Дверь | 4м, 2.2 рад/с, -100° | `world.js:updateDoor` |
| Стекло | 16 осколков, 2–4с | `world.js:breakGlass` |
| Мясо | +1, жизнь 30с | `entities.js:updateMeats` |
| Яма/пещера | fade 0.9с, триггер r2.8 h8 | `main.js`, `world.js:buildPit/buildCave` |

Модели `.glb` и текстуры скопированы из `../3dgame` в `public/assets/` — мобы пытаются подгрузить свои glb, при отсутствии показывают цветной бокс.

Лиса и волк заменены на модели из Ultimate Animated Animal Pack (Quaternius, CC0, https://quaternius.com): у них есть клипы Attack/Death/Walk/Idle — атака проигрывается клипом, а не только выпадом. Кролик и медведь — оригинальные.
