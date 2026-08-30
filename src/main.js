/**
 * Точка входа: цикл, размер кадра и склейка ввода с миром.
 *
 * Шаг симуляции постоянный, экранный кадр — какой получится. Иначе патруль,
 * по которому игрок считает окно, начинает ходить по-разному на разных
 * машинах, и весь расчёт времени рассыпается.
 */

import { STEP, VIEW, fitView } from './tuning.js';
import { LEVELS } from './levels.js';
import {
    createWorld, updateWorld, useAction, tryTakedown, toggleBox,
    throwCoin, firePistol, say, fatesOf, rankOf,
} from './world.js';
import { createRenderer, draw, drawEpilogue } from './render.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { pulse } from './pulse.js';

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
/**
 * Кого ты убил, кого оглушил, а мимо кого прошёл, — копится через всю
 * кампанию и всплывает ровно один раз, в самом конце.
 */
const FATES = 'perimetr.fates';

function loadFates() {
    try { return JSON.parse(localStorage.getItem(FATES) ?? '{}') ?? {}; } catch { return {}; }
}

function saveFates(map) {
    try { localStorage.setItem(FATES, JSON.stringify(map)); } catch { /* приватный режим */ }
}

/** Перепрохождение уровня переписывает его судьбы, а не добавляет вторые. */
function recordFates(w) {
    const map = loadFates();
    map[w.levelName] = fatesOf(w).filter((p) => p.name);
    saveFates(map);
}

function epilogueData() {
    const all = Object.values(loadFates()).flat();
    return {
        killed: all.filter((p) => p.fate === 'killed'),
        downed: all.filter((p) => p.fate === 'downed').length,
        spared: all.filter((p) => p.fate === 'spared').length,
    };
}

let epilogue = null;
/** Шаг поставленной сцены для витрины. null — сцена не запущена. */
let scenePlay = null;

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
    pulse.roomStarted(index, level.name);
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
        epilogue: () => { epilogue = epilogueData(); return epilogue; },
        audio: () => audio,

        /*
         * Поставленная сцена для витрины: тёмная комната, страж спиной,
         * герой подходит крадучись и снимает его.
         *
         * Игра даёт снаряд, снимает им кто угодно. Отдавать видеофайл было
         * бы хуже: он устареет на первой же правке света, а вызов всегда
         * покажет то, что в игре есть сегодня.
         *
         *   perimetr.scene();                     // поставить, вернёт длину
         *   perimetr.sceneStep(1 / 60);           // шаг, вернёт время
         *   perimetr.render();                    // и кадр
         */
        scene(opts = {}) {
            world = start(4);
            world.hint = '';
            world.hintT = 0;

            const at = (tx, ty) => ({ x: (tx + 0.5) * 24, y: (ty + 0.5) * 24 });
            // Страж стоит в пятне фонаря, герой выходит на него из темноты
            // снизу. И свет, и темнота, и то, что в ней происходит, попадают
            // в один кадр — иначе сцена не про темноту, а про две фигурки.
            const post = at(8, 6);
            const g = world.guards[0];
            Object.assign(g, { x: post.x, y: post.y, angle: -Math.PI / 2, state: 'patrol', waitLeft: 999 });
            g.route = [{ ...post, wait: 999, look: false }];
            g.routeIndex = 0;
            g.lines = [];

            // Страж стоит в пятне фонаря, герой заходит из темноты: и то и
            // другое видно в кадре, иначе сцена не про свет, а про фигурки.
            const start0 = at(8, 10);

            /*
             * Тёмный вариант: фонарь над стражем гаснет. Так честнее по
             * букве замысла — «в тёмной комнате», — но видно заметно хуже:
             * страж рисуется поверх темноты и остаётся фигурой, а герой в
             * тени тускнеет, и действие приходится угадывать. Решать, что
             * важнее, должен автор, и для этого ему нужны оба кадра.
             */
            if (opts.dark) {
                const lamp = world.lights[0];
                lamp.out = 999;
                lamp.shape = null;
            }
            Object.assign(world.player, { x: start0.x, y: start0.y, angle: 0, vx: 0, vy: 0 });

            let t = 0;
            let struck = false;
            scenePlay = (dt) => {
                t += dt;
                const dx = g.x - world.player.x;
                const dy = g.y - world.player.y;
                const d = Math.hypot(dx, dy) || 1;
                const walking = !struck && t < 2.2;
                updateWorld(world, {
                    ax: walking ? dx / d : 0,
                    ay: walking ? dy / d : 0,
                    creep: true,
                    run: false,
                    aimAngle: null,
                }, dt);
                // Бить раньше, чем страж нащупает: дистанция снятия 32,
                // «чувствует вплотную» — 26 на полном свету. Окно узкое,
                // и сцена обязана попадать в него, а не в его край.
                if (!struck && d < 30) struck = tryTakedown(world, false);
                world.hint = '';
                return t;
            };
            return { length: 2.8, level: world.levelName };
        },

        sceneStep(dt = 1 / 60) { return scenePlay ? scenePlay(dt) : 0; },
        fates: () => loadFates(),
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

    /*
     * Кадр рисуется сразу, не дожидаясь requestAnimationFrame.
     *
     * В скрытой или фоновой вкладке rAF не тикает вовсе, и снимок экрана
     * получается пустым холстом — именно так витрина сайта четыре раза
     * подряд сняла чёрный прямоугольник. Один синхронный кадр стоит доли
     * миллисекунды и снимает весь класс этих проблем.
     */
    if (world) draw(renderer, world, 0);
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

    if (epilogue) {
        const done = input.frame(dt, null, VIEW);
        input.endFrame();
        if (done.action || done.fire) {
            epilogue = null;
            saveFates({});
            world = start(0);
        } else {
            drawEpilogue(renderer, epilogue);
            requestAnimationFrame(loop);
            return;
        }
    }

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
    if (world.done && !world.recorded) {
        world.recorded = true;
        if (world.done === 'win') {
            recordFates(world);
            pulse.roomDone(index, world.levelName, world.time, rankOf(world).rank);
        } else {
            pulse.roomFailed(index, world.levelName, world.time);
        }
    }
    if (world.done === 'win' && world.doneT > 0.6 && (frame.action || frame.fire)) {
        if (world.last) {
            epilogue = epilogueData();
            pulse.escaped(epilogue.killed.length, epilogue.downed, epilogue.spared);
        }
        else world = start(index + 1);
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
