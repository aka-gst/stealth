import test from 'node:test';
import assert from 'node:assert/strict';

import { room, levelOf, px } from './helpers.mjs';
import { createLight, illumination, breakLight, updateLights, lightShape } from '../src/light.js';
import { LIGHT } from '../src/tuning.js';

test('освещённость — максимум по источникам, а не сумма', () => {
    const level = levelOf(room(30, 10));
    const one = [createLight({ x: px(4), y: px(5), r: 100 })];
    const two = [
        createLight({ x: px(4), y: px(5), r: 100 }),
        createLight({ x: px(8), y: px(5), r: 100 }),
    ];
    const at = { x: px(6), y: px(5) };
    const a = illumination(level, one, at.x, at.y);
    const b = illumination(level, two, at.x, at.y);
    assert.ok(a > 0 && a < 1);
    assert.equal(b, a, 'второй далёкий фонарь не делает полумрак ярким пятном');
});

test('стены свет держат — в отличие от шума', () => {
    const level = levelOf(room(30, 10, [{ x: 6, y: 5, ch: '#' }]));
    const lights = [createLight({ x: px(4), y: px(5), r: 120 })];
    assert.equal(illumination(level, lights, px(8), px(5)), LIGHT.ambient);
});

test('разбитый фонарь не светит совсем', () => {
    const level = levelOf(room(30, 10));
    const l = createLight({ x: px(4), y: px(5), r: 100 });
    assert.ok(illumination(level, [l], px(5), px(5)) > 0);
    breakLight(l);
    assert.equal(illumination(level, [l], px(5), px(5)), LIGHT.ambient);
});

test('прожектор светит только внутри своего сектора и крутится', () => {
    const level = levelOf(room(30, 20));
    const beam = createLight({ kind: 'beam', x: px(15), y: px(10), r: 200, arc: 0.4, speed: 1 });
    const right = illumination(level, [beam], px(15) + 90, px(10));
    const left = illumination(level, [beam], px(15) - 90, px(10));
    assert.ok(right > 0, 'куда смотрит — светит');
    assert.equal(left, LIGHT.ambient, 'за спиной у прожектора темно');

    updateLights([beam], Math.PI);
    assert.ok(illumination(level, [beam], px(15) - 90, px(10)) > 0, 'повернулся — осветил');
});

test('световое пятно строится теми же лучами, что и проверка', () => {
    const level = levelOf(room(30, 10, [{ x: 6, y: 5, ch: '#' }]));
    const l = createLight({ x: px(4), y: px(5), r: 120 });
    const pts = lightShape(level, l);
    const east = pts.reduce((best, p) => (Math.abs(p.a) < Math.abs(best.a) ? p : best));
    assert.ok(east.d < 120, 'луч на восток укоротился о стену');
});
