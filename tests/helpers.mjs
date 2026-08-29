/**
 * Общее для тестов: мир без браузера. Ни одна проверка ниже не трогает
 * canvas — правила игры обязаны быть проверяемы отдельно от картинки.
 */

import { buildLevel } from '../src/level.js';
import { TILE } from '../src/tuning.js';

/** Пустая комната нужного размера со стеной по краю. */
export function room(w = 20, h = 12, extra = []) {
    const map = [];
    for (let y = 0; y < h; y += 1) {
        let row = '';
        for (let x = 0; x < w; x += 1) {
            row += (x === 0 || y === 0 || x === w - 1 || y === h - 1) ? '#' : '.';
        }
        map.push(row);
    }
    for (const { x, y, ch } of extra) {
        map[y] = map[y].slice(0, x) + ch + map[y].slice(x + 1);
    }
    return map;
}

export function levelOf(map, over = {}) {
    return buildLevel({
        name: 'тест',
        map,
        spawn: { x: 1, y: 1 },
        exit: { x: 1, y: 1 },
        guards: [],
        ...over,
    });
}

export const px = (t) => (t + 0.5) * TILE;
