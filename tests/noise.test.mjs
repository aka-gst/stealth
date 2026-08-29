import test from 'node:test';
import assert from 'node:assert/strict';

import { room, px } from './helpers.mjs';
import { createWorld, emitNoise, throwCoin, updateWorld } from '../src/world.js';
import { NOISE, PLAYER } from '../src/tuning.js';
import { noiseOf, createPlayer, updatePlayer } from '../src/player.js';
import { buildLevel } from '../src/level.js';

const def = (over = {}) => ({
    name: 'тест',
    map: room(30, 14),
    spawn: { x: 2, y: 7 },
    exit: { x: 28, y: 7 },
    lights: [],
    guards: [],
    ...over,
});

const idle = { ax: 0, ay: 0, creep: false, run: false, aimAngle: null };

test('крадущийся шаг ровно беззвучен, а не «тише»', () => {
    const p = createPlayer({ x: 0, y: 0 });
    assert.equal(noiseOf(p, { creep: true, run: false }), 0);
    assert.ok(noiseOf(p, { creep: false, run: false }) > 0);
    assert.ok(noiseOf(p, { creep: false, run: true }) > noiseOf(p, { creep: false, run: false }));
});

test('стены шум не держат: спрятаться за угол и бежать не работает', () => {
    const world = createWorld(def({
        map: room(30, 14, [{ x: 8, y: 7, ch: '#' }]),
        guards: [{ at: { x: 11, y: 7 }, angle: 0, route: [{ x: 11, y: 7, wait: 99 }] }],
    }));
    const g = world.guards[0];
    emitNoise(world, px(6), px(7), NOISE.run, 'step');
    assert.equal(g.state, 'suspect', 'услышал сквозь стену');
    assert.ok(Math.abs(g.suspect.x - px(6)) < 1, 'и пошёл именно на звук');
});

test('страж идёт НА ЗВУК, а не к игроку, — отсюда всё отвлечение', () => {
    const world = createWorld(def({
        guards: [{ at: { x: 14, y: 7 }, angle: Math.PI, route: [{ x: 14, y: 7, wait: 99 }] }],
    }));
    const g = world.guards[0];
    const startX = g.x;
    world.player.x = px(2);
    world.player.y = px(7);

    emitNoise(world, px(18), px(7), NOISE.coin, 'coin');
    for (let i = 0; i < 90; i += 1) updateWorld(world, idle, 1 / 60);

    assert.ok(g.x > startX + 10, 'ушёл в сторону звука, а не к игроку');
});

test('монетка летит и шумит там, куда упала', () => {
    const world = createWorld(def({
        guards: [{ at: { x: 12, y: 7 }, angle: 0, route: [{ x: 12, y: 7, wait: 99 }] }],
    }));
    world.player.angle = 0;
    assert.equal(throwCoin(world), true);
    assert.equal(world.coinsLeft, 2);

    for (let i = 0; i < 120; i += 1) updateWorld(world, idle, 1 / 60);
    const coin = world.coins[0];
    assert.ok(coin.landed, 'долетела и упала');
    assert.ok(coin.x > world.level.spawn.x + 60, 'улетела вперёд, а не под ноги');
    assert.equal(world.guards[0].state, 'suspect');
});

test('монетки кончаются, но их можно подобрать', () => {
    const world = createWorld(def());
    world.player.angle = 0;
    throwCoin(world); throwCoin(world); throwCoin(world);
    assert.equal(throwCoin(world), false, 'четвёртой нет');

    for (let i = 0; i < 200; i += 1) updateWorld(world, idle, 1 / 60);
    const coin = world.coins[0];
    world.player.x = coin.x;
    world.player.y = coin.y;
    updateWorld(world, idle, 1 / 60);
    assert.ok(world.coinsLeft > 0, 'подобрал брошенную');
});
