/**
 * Точка входа: цикл, размер кадра и склейка ввода с миром.
 *
 * Шаг симуляции постоянный, экранный кадр — какой получится. Иначе патруль,
 * по которому игрок считает окно, начинает ходить по-разному на разных
 * машинах, и весь расчёт времени рассыпается.
 */

import { STEP, VIEW, fitView } from './tuning.js';
import { LEVELS } from './levels.js';
import { createWorld, updateWorld, useAction, tryTakedown, toggleBox, throwCoin, firePistol, say } from './world.js';
import { createRenderer, draw } from './render.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';

const canvas = document.getElementById('game');
const renderer = createRenderer(canvas);
const input = createInput(canvas);
const audio = createAudio();

/*
 * Щипок на тачпаде браузер понимает как «увеличить страницу», и игра
 * уезжает из кадра. Для игры это всегда промах пальцем, а не намерение,
 * поэтому масштабирование страницы запрещаем целиком.
 */
window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
for (const evt of ['gesturestart', 'gesturechange', 'gestureend']) {
    window.addEventListener(evt, (e) => e.preventDefault());
}
window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && ['Equal', 'Minus', 'Digit0'].includes(e.code)) e.preventDefault();
});

// Браузер не даёт звучать до первого касания — заводим на первом же.
for (const evt of ['keydown', 'pointerdown', 'touchstart']) {
    window.addEventListener(evt, () => audio.ensure(), { once: true });
}

/*
 * Уровни идут порядком, и порядок — половина игры. Пройденное запоминается,
 * чтобы не проходить обучение заново каждый раз; сбросить можно клавишей
 * «0», перепрыгнуть — «N».
 */
const SAVE = 'perimetr.level';

function loadIndex() {
    try {
        const v = Number(localStorage.getItem(SAVE));
        return Number.isInteger(v) && v >= 0 && v < LEVELS.length ? v : 0;
    } catch { return 0; }
}

function saveIndex(i) {
    try { localStorage.setItem(SAVE, String(i)); } catch { /* приватный режим — не беда */ }
}

let index = loadIndex();
let world = start(index);

function start(i) {
    index = Math.max(0, Math.min(LEVELS.length - 1, i));
    saveIndex(index);
    const level = LEVELS[index];
    const w = createWorld(level);
    // Подсказка по клавишам своя у каждого уровня: перечислять всё сразу
    // значит показать игроку список того, чего он ещё не умеет.
    const keys = document.getElementById('keys');
    if (keys && level.keys) keys.innerHTML = level.keys;
    w.levelName = level.name;
    w.levelNo = index + 1;
    w.levelTotal = LEVELS.length;
    w.last = index === LEVELS.length - 1;
    say(w, level.brief, 6);
    return w;
}

/*
 * Отладочный пульт: ?debug даёт прогнать симуляцию из консоли и нарисовать
 * кадр по требованию. Нужен потому, что смотреть глазами полезно, а
 * проверять числами надёжнее — и потому, что в скрытой вкладке экранного
 * кадра просто нет.
 */
if (location.search.includes('debug')) {
    window.perimetr = {
        world: () => world,
        step(seconds, over = {}) {
            const frame = { ax: 0, ay: 0, creep: false, run: false, aimAngle: null, ...over };
            for (let t = 0; t < seconds; t += STEP) updateWorld(world, frame, STEP);
            return world;
        },
        level: (i) => { world = start(i); return world; },
        act: (lethal = false) => tryTakedown(world, lethal),
        use: () => useAction(world),
        box: () => toggleBox(world),
        coin: () => throwCoin(world),
        fire: () => firePistol(world),
        render: () => draw(renderer, world),
        reset() { world = start(index); return world; },
    };
}

function resize() {
    const rect = canvas.getBoundingClientRect();
    fitView(rect.width, rect.height);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(VIEW.w * dpr);
    canvas.height = Math.round(VIEW.h * dpr);
    // Плотность экрана живёт в матрице, а весь код рисует в логических
    // пикселях кадра. Иначе на ретине игра рисуется в четверть холста.
    renderer.dpr = dpr;
    renderer.ctx.imageSmoothingEnabled = false;
}

window.addEventListener('resize', resize);
// Первый замер до раскладки врёт, поэтому кадр меряется наблюдателем, а
// не одним вызовом на старте: иначе игра остаётся в квадратном кадре.
if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas.parentElement ?? canvas);
resize();

let last = performance.now();
let acc = 0;

function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    const cam = {
        x: renderer.cam.x,
        y: renderer.cam.y,
        s: renderer.cam.s,
        px: world.player.x,
        py: world.player.y,
    };
    const frame = input.frame(dt, cam, VIEW);

    if (frame.restart) world = start(index);
    if (frame.next) world = start(index + 1);
    if (frame.prev) world = start(index - 1);
    if (frame.reset) world = start(0);

    // Уровень сдан — дальше по кнопке, а не сам собой: итог надо прочитать.
    if (world.done === 'win' && world.doneT > 0.6 && (frame.action || frame.fire)) {
        world = start(world.last ? index : index + 1);
    }
    if (world.done === 'lose' && world.doneT > 0.6 && (frame.action || frame.fire)) {
        world = start(index);
    }

    if (!world.done) {
        if (frame.action) useAction(world);
        if (frame.kill) tryTakedown(world, true);
        if (frame.box) toggleBox(world);
        if (frame.mute) say(world, audio.toggle() ? 'Звук выключен.' : 'Звук включён.', 1.4);
        if (frame.coin && !throwCoin(world)) say(world, 'Монеты кончились. Подбери брошенные.', 1.6);
        if (frame.fire && !firePistol(world)) say(world, 'Патронов нет.', 1.4);
    }

    acc += dt;
    let guard = 0;
    while (acc >= STEP && guard < 240) {
        updateWorld(world, frame, STEP);
        for (const e of world.events) audio.play(e);
        acc -= STEP;
        guard += 1;
    }
    audio.update(world.alarm.state, dt);

    input.endFrame();
    draw(renderer, world, dt);

    requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
