/**
 * Точка входа: цикл, размер кадра и склейка ввода с миром.
 *
 * Шаг симуляции постоянный, экранный кадр — какой получится. Иначе патруль,
 * по которому игрок считает окно, начинает ходить по-разному на разных
 * машинах, и весь расчёт времени рассыпается.
 */

import { STEP, VIEW, fitView } from './tuning.js';
import { YARD } from './levels.js';
import { createWorld, updateWorld, tryTakedown, toggleCarry, throwCoin, firePistol, say } from './world.js';
import { createRenderer, draw } from './render.js';
import { createInput } from './input.js';

const canvas = document.getElementById('game');
const renderer = createRenderer(canvas);
const input = createInput(canvas);

let world = createWorld(YARD);
say(world, YARD.brief, 5);

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
        act: (lethal = false) => tryTakedown(world, lethal),
        carry: () => toggleCarry(world),
        coin: () => throwCoin(world),
        fire: () => firePistol(world),
        render: () => draw(renderer, world),
        reset() { world = createWorld(YARD); return world; },
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

    const cam = { x: renderer.cam.x, y: renderer.cam.y, px: world.player.x, py: world.player.y };
    const frame = input.frame(dt, cam, VIEW);

    if (frame.restart) {
        world = createWorld(YARD);
        say(world, YARD.brief, 4);
    }

    if (!world.done) {
        if (frame.action) {
            // Одна кнопка на всё близкое: сначала тело, потом снятие.
            if (!toggleCarry(world) && !tryTakedown(world, false)) say(world, 'Тут никого нет — заходи со спины.', 1.6);
        }
        if (frame.kill) tryTakedown(world, true);
        if (frame.coin && !throwCoin(world)) say(world, 'Монеты кончились. Подбери брошенные.', 1.6);
        if (frame.fire && !firePistol(world)) say(world, 'Патронов нет.', 1.4);
    }

    acc += dt;
    let guard = 0;
    while (acc >= STEP && guard < 240) {
        updateWorld(world, frame, STEP);
        acc -= STEP;
        guard += 1;
    }

    input.endFrame();
    draw(renderer, world);

    requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
