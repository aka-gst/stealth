import test from 'node:test';
import assert from 'node:assert/strict';

import { room, px } from './helpers.mjs';
import { createWorld, updateWorld, knock, flipSwitch, toggleBox } from '../src/world.js';
import { surfaceAt } from '../src/level.js';
import { illumination } from '../src/light.js';
import { SURFACE, NOISE, LIGHT, GUARD } from '../src/tuning.js';

const idle = { ax: 0, ay: 0, creep: false, run: false, aimAngle: null };

const def = (over = {}) => ({
    name: 'тест',
    map: room(30, 14),
    spawn: { x: 2, y: 7 },
    exit: { x: 28, y: 7 },
    lights: [],
    guards: [],
    ambient: 1,
    ...over,
});

/** Прогнать мир, пока не появится первое кольцо шума. */
function firstNoise(world, input, limit = 2) {
    for (let t = 0; t < limit; t += 1 / 120) {
        updateWorld(world, input, 1 / 120);
        if (world.noises.length) return world.noises[0];
    }
    return null;
}

test('гравий выдаёт шаг, мягкая земля его прячет', () => {
    const world = createWorld(def({
        map: room(30, 14, [{ x: 5, y: 7, ch: ':' }, { x: 9, y: 7, ch: '-' }]),
    }));
    assert.equal(surfaceAt(world.level, px(5), px(7)), SURFACE.gravel);
    assert.equal(surfaceAt(world.level, px(9), px(7)), SURFACE.soft);
    assert.equal(surfaceAt(world.level, px(7), px(7)), SURFACE.concrete);
});

test('по гравию нельзя идти, но можно красться — и это ровно ноль', () => {
    const walkOn = (ch) => {
        const world = createWorld(def({ map: room(30, 14, [{ x: 5, y: 7, ch }]) }));
        world.player.x = px(5);
        world.player.y = px(7);
        return firstNoise(world, { ...idle, ax: 0.02, ay: 0 });
    };
    const gravel = walkOn(':');
    const concrete = walkOn('.');
    assert.ok(gravel.radius > concrete.radius * 1.5, 'шаг по гравию слышно куда дальше');

    const creeping = createWorld(def({ map: room(30, 14, [{ x: 5, y: 7, ch: ':' }]) }));
    creeping.player.x = px(5);
    creeping.player.y = px(7);
    assert.equal(firstNoise(creeping, { ...idle, ax: 1, creep: true }), null,
        'крадущийся шаг беззвучен на любой земле — обещание нельзя ломать');
});

test('стук в стену приманивает того, кто за углом', () => {
    const world = createWorld(def({
        map: room(30, 14, [{ x: 8, y: 7, ch: '#' }]),
        guards: [{ at: { x: 10, y: 7 }, angle: 0, route: [{ x: 10, y: 7, wait: 99 }] }],
    }));
    world.player.x = px(7);
    world.player.y = px(7);
    world.player.angle = 0;

    assert.equal(knock(world), true);
    assert.equal(world.guards[0].state, 'suspect', 'услышал сквозь стену и пошёл');
    assert.ok(world.noises[0].radius === NOISE.knock);
});

test('в пустоту не стучат', () => {
    const world = createWorld(def());
    world.player.x = px(5);
    world.player.y = px(7);
    world.player.angle = 0;
    assert.equal(knock(world), false);
});

test('рубильник гасит сектор на время, а не навсегда', () => {
    const world = createWorld(def({
        lights: [{ x: 6, y: 7, r: 110 }],
        switches: [{ x: 5, y: 7, r: 150 }],
    }));
    world.player.x = px(5);
    world.player.y = px(7);
    const at = () => illumination(world.level, world.lights, px(6), px(7));

    assert.ok(at() > 0.5, 'сначала светло');
    assert.equal(flipSwitch(world), true);
    assert.equal(at(), world.level.ambient, 'стало темно');

    for (let t = 0; t < LIGHT.relight + 0.5; t += 1 / 60) updateWorld(world, idle, 1 / 60);
    assert.ok(at() > 0.5, 'и снова загорелось');
});

test('коробка прячет неподвижного и не прячет идущего', () => {
    const world = createWorld(def({
        guards: [{ at: { x: 10, y: 7 }, angle: Math.PI, route: [{ x: 10, y: 7, wait: 99 }] }],
    }));
    world.player.x = px(6);
    world.player.y = px(7);

    // Без коробки страж видит: смотрит прямо на игрока.
    updateWorld(world, idle, 1 / 60);
    for (let t = 0; t < GUARD.notice + 0.2; t += 1 / 60) updateWorld(world, idle, 1 / 60);
    assert.equal(world.guards[0].state, 'chase');

    // В коробке и стоя — не видит.
    const hidden = createWorld(def({
        guards: [{ at: { x: 10, y: 7 }, angle: Math.PI, route: [{ x: 10, y: 7, wait: 99 }] }],
    }));
    hidden.player.x = px(6);
    hidden.player.y = px(7);
    toggleBox(hidden);
    for (let t = 0; t < 2; t += 1 / 60) updateWorld(hidden, idle, 1 / 60);
    assert.equal(hidden.guards[0].state, 'patrol', 'стоящая коробка — просто ящик');
    assert.equal(hidden.player.hidden, true);

    // Пошёл — и коробка перестала помогать.
    for (let t = 0; t < 1; t += 1 / 60) updateWorld(hidden, { ...idle, ax: 1 }, 1 / 60);
    assert.equal(hidden.player.hidden, false, 'движущийся ящик — это человек');
});

test('на кого наткнулись вплотную, того коробка не спасает', () => {
    const world = createWorld(def({
        guards: [{ at: { x: 10, y: 7 }, angle: Math.PI, route: [{ x: 10, y: 7, wait: 99 }] }],
    }));
    world.player.x = px(10) - 12;
    world.player.y = px(7);
    toggleBox(world);
    for (let t = 0; t < GUARD.notice + 0.4; t += 1 / 60) updateWorld(world, idle, 1 / 60);
    assert.equal(world.guards[0].state, 'chase');
});
