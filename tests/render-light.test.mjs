import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { room, levelOf, px } from './helpers.mjs';
import { createLight, illumination } from '../src/light.js';
import { sightReach, feelReach } from '../src/vision.js';

let display = {};
try { display = await import('../src/render.js'); } catch { /* красный этап: контракт отображения ещё не вынесен */ }

test('тьма приглушает сцену, но оставляет базовую комнату и выход читаемыми', () => {
    assert.ok(display.darknessAlpha?.(0) <= 0.22,
        'при нулевой освещённости слой не должен превращать комнату в чёрный экран');
    assert.equal(display.EXIT_OUTLINE, '#d8ff80',
        'выход рисуется постоянным контрастным контуром поверх затемнения');
});

test('отрицательный контроль: прежняя непрозрачность 0.72 нарушает порог читаемости', () => {
    assert.throws(() => assert.ok(0.72 <= 0.22));
});

test('контур выхода рисуется после вуали, а не прячется под ней', async () => {
    const source = await readFile(new URL('../src/render.js', import.meta.url), 'utf8');
    assert.match(source, /drawDarkness\(r, world\);\s+\n\s*worldSpace\(r\);\s*\n\s*drawExitOutline\(ctx, world\);/);
});

test('визуальная тьма не меняет численную механику света и чутья', () => {
    const level = levelOf(room(30, 10));
    const lamp = createLight({ x: px(4), y: px(5), r: 100 });
    assert.equal(illumination(level, [], px(8), px(5)), 0);
    assert.equal(illumination(level, [lamp], px(5), px(5)), 1);
    assert.equal(sightReach(0), 25.8);
    assert.equal(sightReach(1), 172);
    assert.equal(feelReach(0), 11.700000000000001);
    assert.equal(feelReach(1), 26);
});
