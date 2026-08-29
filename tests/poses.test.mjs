import test from 'node:test';
import assert from 'node:assert/strict';

import { room, levelOf, px } from './helpers.mjs';
import { canSee } from '../src/vision.js';
import { createWorld, updateWorld } from '../src/world.js';
import { createGuard } from '../src/guard.js';
import { POSE, GUARD, TRACKS } from '../src/tuning.js';

const guardAt = (x, y, angle = 0) => ({ x, y, angle, r: GUARD.radius });

test('лёжа и у стены замечают ближе, чем стоя', () => {
    const level = levelOf(room(24, 10));
    const g = guardAt(px(2), px(5), 0);
    const at = { x: px(7), y: px(5), lit: 1, grass: false };

    assert.equal(canSee(level, g, at), true, 'стоящего видно');
    assert.equal(canSee(level, g, { ...at, expose: POSE.proneSight }), false, 'лежащего с той же дистанции — нет');
    assert.ok(POSE.hugSight < 1 && POSE.proneSight < POSE.hugSight,
        'лёжа прячет сильнее, чем прижавшись к стене');
});

test('ползком в траве — почти ничто', () => {
    const level = levelOf(room(24, 10));
    const g = guardAt(px(2), px(5), 0);
    const near = { x: px(4), y: px(5), lit: 1, grass: true };
    assert.equal(canSee(level, g, near), true, 'просто в траве вблизи видно');
    assert.equal(canSee(level, g, { ...near, expose: POSE.proneSight * POSE.proneGrass }), false,
        'а лёжа в траве — уже нет');
});

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

/** Пройти вправо заданное время. */
function walk(world, seconds, over = {}) {
    for (let t = 0; t < seconds; t += 1 / 120) {
        updateWorld(world, { ax: 1, ay: 0, creep: false, run: false, aimAngle: null, ...over }, 1 / 120);
    }
}

test('следы остаются на снегу и не остаются на бетоне', () => {
    const snow = createWorld(def({
        map: room(30, 14, Array.from({ length: 10 }, (_, i) => ({ x: 4 + i, y: 7, ch: '-' }))),
    }));
    snow.player.x = px(4);
    snow.player.y = px(7);
    walk(snow, 2.5);
    assert.ok(snow.tracks.length >= 2, 'на снегу осталась цепочка');

    const concrete = createWorld(def());
    concrete.player.x = px(4);
    concrete.player.y = px(7);
    walk(concrete, 2.5);
    assert.equal(concrete.tracks.length, 0, 'бетон следов не держит');
});

test('страж идёт по следам, а не мимо них', () => {
    // Сначала цепочка, потом свидетель: иначе он увидит не след, а самого
    // игрока, и проверка окажется не о том.
    const world = createWorld(def({
        map: room(30, 14, Array.from({ length: 12 }, (_, i) => ({ x: 3 + i, y: 7, ch: '-' }))),
    }));
    world.player.x = px(3);
    world.player.y = px(7);
    walk(world, 3);
    assert.ok(world.tracks.length > 0);

    world.player.x = px(3);
    world.player.y = px(12);
    world.guards.push(createGuard(
        { at: { x: px(16), y: px(7) }, angle: Math.PI, route: [{ x: px(16), y: px(7), wait: 99 }] },
        9,
    ));
    const g = world.guards[0];

    for (let t = 0; t < 0.6; t += 1 / 120) {
        updateWorld(world, { ax: 0, ay: 0, creep: true, run: false, aimAngle: null }, 1 / 120);
    }
    assert.equal(g.state, 'suspect', 'заметил след и пошёл проверять');
    assert.ok(g.suspect.x < px(16), 'и пошёл в сторону следов, а не от них');
});

test('крадущийся оставляет следы, которые видно вдвое ближе', () => {
    assert.ok(TRACKS.creepSight < TRACKS.sight);
    const world = createWorld(def({
        map: room(30, 14, Array.from({ length: 10 }, (_, i) => ({ x: 4 + i, y: 7, ch: '-' }))),
    }));
    world.player.x = px(4);
    world.player.y = px(7);
    walk(world, 3, { creep: true });
    assert.ok(world.tracks.length > 0, 'следы остаются и от крадущегося');
    assert.equal(world.tracks[0].faint, true, 'но мелкие');
});

test('с земли снять нельзя — надо встать', () => {
    const world = createWorld(def({
        guards: [{ at: { x: 10, y: 7 }, angle: 0, route: [{ x: 10, y: 7, wait: 99 }] }],
    }));
    world.player.x = world.guards[0].x - 16;
    world.player.y = world.guards[0].y;
    for (let t = 0; t < 0.3; t += 1 / 120) {
        updateWorld(world, { ax: 0, ay: 0, creep: true, run: false, prone: true, aimAngle: null }, 1 / 120);
    }
    assert.equal(world.player.pose, 'prone');
});
