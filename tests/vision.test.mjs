import test from 'node:test';
import assert from 'node:assert/strict';

import { room, levelOf, px } from './helpers.mjs';
import { canSee, sightReach, coneShape, turnToward } from '../src/vision.js';
import { GUARD, LIGHT } from '../src/tuning.js';

const guardAt = (x, y, angle = 0) => ({ x, y, angle, r: GUARD.radius });
const lit = (x, y) => ({ x, y, lit: 1, grass: false });

test('спиной не видят вовсе — на этом держится заход со спины', () => {
    const level = levelOf(room(24, 10));
    const g = guardAt(px(5), px(5), 0);
    assert.equal(canSee(level, g, lit(px(9), px(5))), true, 'перед собой видит');
    assert.equal(canSee(level, g, lit(px(1), px(5))), false, 'за спиной не видит');
});

test('вплотную замечают и со спины — иначе это читается как поломка', () => {
    const level = levelOf(room(24, 10));
    const g = guardAt(px(5), px(5), 0);
    assert.equal(canSee(level, g, lit(px(5) - 14, px(5))), true);
});

test('сквозь стену не видят: угол здания — это укрытие', () => {
    const map = room(24, 10, [{ x: 7, y: 5, ch: '#' }]);
    const level = levelOf(map);
    const g = guardAt(px(5), px(5), 0);
    assert.equal(canSee(level, g, lit(px(9), px(5))), false);
});

test('в темноте подпускают вплотную, под фонарём видят далеко', () => {
    const level = levelOf(room(30, 10));
    const g = guardAt(px(2), px(5), 0);
    const far = { x: px(8), y: px(5), grass: false };

    assert.equal(canSee(level, g, { ...far, lit: 1 }), true, 'на свету видно');
    assert.equal(canSee(level, g, { ...far, lit: 0 }), false, 'в темноте — нет');

    assert.ok(sightReach(0) < GUARD.feel + 6, 'во тьме дальность падает до «вплотную»');
    assert.equal(sightReach(1), GUARD.sight);
});

test('трава прячет: в ней замечают только вблизи', () => {
    const level = levelOf(room(30, 10));
    const g = guardAt(px(2), px(5), 0);
    const at = (t) => ({ x: px(t), y: px(5), lit: 1, grass: true });
    assert.equal(canSee(level, g, at(8)), false);
    assert.equal(canSee(level, g, { ...at(8), grass: false }), true);
});

test('конус укорачивается о стену ровно так же, как взгляд', () => {
    const map = room(24, 10, [{ x: 8, y: 5, ch: '#' }]);
    const level = levelOf(map);
    const g = guardAt(px(2), px(5), 0);
    const pts = coneShape(level, g, GUARD.sight);
    const middle = pts[Math.floor(pts.length / 2)];
    assert.ok(middle.d < GUARD.sight, 'центральный луч упёрся в стену');
    assert.ok(middle.d < px(8) - px(2), 'и не заходит за неё');
});

test('голова поворачивается со скоростью, а не мгновенно', () => {
    const half = turnToward(0, Math.PI, GUARD.turnRate, 0.1);
    assert.ok(Math.abs(half) < Math.PI, 'за кадр не развернулся целиком');
    assert.ok(Math.abs(half) > 0, 'но повернулся');
});
