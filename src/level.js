/**
 * Уровень: сетка тайлов, столкновения и лучи.
 *
 * Карта пишется картинкой из символов, а не таблицей чисел, — уровень в
 * стелсе правится десятки раз, и править его надо глазами: видно, где
 * коридор, где угол для укрытия и где патруль пройдёт мимо.
 *
 * Тут же лежат две функции, на которых держится вся честность игры:
 * `rayBlocked` — сквозь стену не видно, и `flowField` — страж ходит по
 * проходимым клеткам, а не сквозь них.
 */

import { TILE } from './tuning.js';

export const FLOOR = 0;
export const WALL = 1;
/** Ящик: не пройти, не увидеть сквозь него, но за ним можно спрятать тело. */
export const CRATE = 2;
/** Высокая трава: пройти можно, а заметить в ней — только вплотную. */
export const GRASS = 3;
export const EXIT = 4;

const LEGEND = {
    '#': WALL,
    '.': FLOOR,
    ' ': FLOOR,
    '=': CRATE,
    ',': GRASS,
    'X': EXIT,
};

/** Собрать уровень из картинки. Строки разной длины дополняются полом. */
export function buildLevel(def) {
    const rows = def.map;
    const h = rows.length;
    const w = Math.max(...rows.map((r) => r.length));
    const tiles = new Uint8Array(w * h);

    for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
            const ch = rows[y][x] ?? '.';
            const tile = LEGEND[ch];
            if (tile === undefined) throw new Error(`Неизвестный символ карты: «${ch}»`);
            tiles[y * w + x] = tile;
        }
    }

    return {
        name: def.name,
        w,
        h,
        tiles,
        pixelW: w * TILE,
        pixelH: h * TILE,
        spawn: toPixels(def.spawn),
        exit: toPixels(def.exit),
        goal: def.goal ? toPixels(def.goal) : null,
        guards: (def.guards ?? []).map((g) => ({
            at: toPixels(g.at),
            angle: g.angle ?? 0,
            route: (g.route ?? []).map((p) => ({ ...toPixels(p), wait: p.wait ?? 0, look: p.look ?? false })),
        })),
        coins: (def.coins ?? []).map(toPixels),
        lights: (def.lights ?? []).map((l) => ({ ...l, ...toPixels(l) })),
        ambient: def.ambient,
        brief: def.brief ?? '',
    };
}

/** Клетки в пикселях: центр клетки, а не её угол. */
function toPixels(p) {
    return { x: (p.x + 0.5) * TILE, y: (p.y + 0.5) * TILE };
}

export function tileAt(level, px, py) {
    const x = Math.floor(px / TILE);
    const y = Math.floor(py / TILE);
    if (x < 0 || y < 0 || x >= level.w || y >= level.h) return WALL;
    return level.tiles[y * level.w + x];
}

/** Непроходимо и непрозрачно. Трава прозрачна для луча — она прячет иначе. */
export function solidAt(level, px, py) {
    const t = tileAt(level, px, py);
    return t === WALL || t === CRATE;
}

export function hidesAt(level, px, py) {
    return tileAt(level, px, py) === GRASS;
}

export function isExit(level, px, py) {
    return tileAt(level, px, py) === EXIT;
}

/** Есть ли рядом ящик, за который можно затолкать тело. */
export function crateNear(level, px, py, radius = 22) {
    const x0 = Math.floor((px - radius) / TILE);
    const x1 = Math.floor((px + radius) / TILE);
    const y0 = Math.floor((py - radius) / TILE);
    const y1 = Math.floor((py + radius) / TILE);
    for (let ty = y0; ty <= y1; ty += 1) {
        for (let tx = x0; tx <= x1; tx += 1) {
            if (tx < 0 || ty < 0 || tx >= level.w || ty >= level.h) continue;
            if (level.tiles[ty * level.w + tx] !== CRATE) continue;
            const cx = Math.max(tx * TILE, Math.min(px, tx * TILE + TILE));
            const cy = Math.max(ty * TILE, Math.min(py, ty * TILE + TILE));
            if (Math.hypot(px - cx, py - cy) <= radius) return true;
        }
    }
    return false;
}

/**
 * Есть ли стена между двумя точками. Шаг в треть тайла: стены толще, и
 * пропустить их такой шаг не может.
 *
 * Из-за этой проверки геометрия уровня начинает работать на стелс: угол
 * здания становится укрытием, а не просто препятствием.
 */
export function rayBlocked(level, ax, ay, bx, by) {
    const dist = Math.hypot(bx - ax, by - ay);
    const steps = Math.ceil(dist / (TILE / 3));
    for (let i = 1; i < steps; i += 1) {
        const t = i / steps;
        if (solidAt(level, ax + (bx - ax) * t, ay + (by - ay) * t)) return true;
    }
    return false;
}

/** Докуда луч доходит, прежде чем упереться. Нужен, чтобы рисовать конус. */
export function rayReach(level, x, y, angle, maxDist) {
    const step = TILE / 3;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (let d = step; d <= maxDist; d += step) {
        if (solidAt(level, x + cos * d, y + sin * d)) return d - step;
    }
    return maxDist;
}

function blockedCircle(level, x, y, r) {
    return solidAt(level, x - r, y - r) || solidAt(level, x + r, y - r)
        || solidAt(level, x - r, y + r) || solidAt(level, x + r, y + r);
}

/**
 * Движение кругом по осям раздельно. Раздельно — чтобы получилось
 * скольжение вдоль стены: в стелсе ходят вплотную к углам, и застревать
 * на них нельзя.
 */
export function moveCircle(level, e, dx, dy) {
    if (dx !== 0) {
        const nx = e.x + dx;
        if (!blockedCircle(level, nx, e.y, e.r)) e.x = nx;
        else e.vx = 0;
    }
    if (dy !== 0) {
        const ny = e.y + dy;
        if (!blockedCircle(level, e.x, ny, e.r)) e.y = ny;
        else e.vy = 0;
    }
}

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Волна расстояний от точки по проходимым клеткам.
 *
 * Поле маленькое — меньше тысячи клеток, — поэтому пересчитать его целиком
 * дешевле, чем вести и чинить путь каждому стражу. Стражи ходят по волне
 * и потому огибают здание, а не утыкаются в его стену.
 */
export function flowField(level, px, py) {
    const size = level.w * level.h;
    const field = new Int16Array(size).fill(-1);
    const sx = Math.floor(px / TILE);
    const sy = Math.floor(py / TILE);
    if (sx < 0 || sy < 0 || sx >= level.w || sy >= level.h) return field;

    const start = sy * level.w + sx;
    if (level.tiles[start] === WALL || level.tiles[start] === CRATE) return field;

    const queue = new Int32Array(size);
    let head = 0;
    let tail = 0;
    queue[tail] = start;
    tail += 1;
    field[start] = 0;

    while (head < tail) {
        const at = queue[head];
        head += 1;
        const ax = at % level.w;
        const ay = (at / level.w) | 0;
        const next = field[at] + 1;
        for (const [ox, oy] of NEIGHBOURS) {
            const nx = ax + ox;
            const ny = ay + oy;
            if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h) continue;
            const idx = ny * level.w + nx;
            if (field[idx] !== -1) continue;
            const t = level.tiles[idx];
            if (t === WALL || t === CRATE) continue;
            field[idx] = next;
            queue[tail] = idx;
            tail += 1;
        }
    }
    return field;
}

/**
 * Куда шагнуть по волне. Возвращает нормализованное направление или null,
 * если стоять уже некуда — пришли или путь отрезан.
 */
export function flowStep(level, field, px, py) {
    const cx = Math.floor(px / TILE);
    const cy = Math.floor(py / TILE);
    if (cx < 0 || cy < 0 || cx >= level.w || cy >= level.h) return null;
    const here = field[cy * level.w + cx];
    if (here <= 0) return null;

    let best = here;
    let bx = 0;
    let by = 0;
    for (const [ox, oy] of NEIGHBOURS) {
        const nx = cx + ox;
        const ny = cy + oy;
        if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h) continue;
        const v = field[ny * level.w + nx];
        if (v === -1 || v >= best) continue;
        best = v;
        bx = ox;
        by = oy;
    }
    if (bx === 0 && by === 0) return null;

    // Идём в центр следующей клетки, а не в её край: иначе страж режет
    // углы и застревает на них.
    const tx = (cx + bx + 0.5) * TILE;
    const ty = (cy + by + 0.5) * TILE;
    const len = Math.hypot(tx - px, ty - py) || 1;
    return { x: (tx - px) / len, y: (ty - py) / len };
}

/** Кэш волн по клетке цели: соседи, идущие в одну точку, делят одну волну. */
export function makeFlowCache(level) {
    const cache = new Map();
    return {
        to(px, py) {
            const key = Math.floor(py / TILE) * level.w + Math.floor(px / TILE);
            let field = cache.get(key);
            if (!field) {
                field = flowField(level, px, py);
                if (cache.size > 24) cache.clear();
                cache.set(key, field);
            }
            return field;
        },
        clear() { cache.clear(); },
    };
}
