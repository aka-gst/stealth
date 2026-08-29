/**
 * Проверяльщик уровня.
 *
 * Уровень в стелсе обязан проходиться несколькими способами. Это заявление
 * легко сделать и трудно проверить: глазами видно только тот путь, который
 * ты сам и задумал. Поэтому здесь три бота, и каждый играет по-своему.
 *
 *   напролом — идёт кратчайшим путём и не смотрит по сторонам;
 *   в тени   — считает стоимость клетки по свету и чужим конусам;
 *   громко   — то же напролом, но стреляет во всё, что видит.
 *
 * Полезен не столько зелёный ответ, сколько красный: «в тени» не дошёл —
 * значит, тихого маршрута на карте нет, и это ошибка расстановки, а не
 * игрока. Запуск: node tools/check-level.mjs
 */

import { LEVELS } from '../src/levels.js';
import { createWorld, updateWorld, firePistol, throwCoin, tryTakedown, gateOpen } from '../src/world.js';
import { flowField, flowStep, tileAt, WALL, CRATE, GRASS, EXIT } from '../src/level.js';
import { illumination } from '../src/light.js';
import { canSee, sightReach } from '../src/vision.js';
import { isOut, isBehind } from '../src/guard.js';
import { TILE, GUARD } from '../src/tuning.js';

const STEP = 1 / 120;

/**
 * Волна с ценой клетки: свет и чужие конусы дороже, трава дешевле. Тот же
 * поиск пути, только «коротко» здесь значит «незаметно».
 */
function shadowField(w, tx, ty) {
    const { level } = w;
    const size = level.w * level.h;
    const cost = new Float32Array(size).fill(Infinity);
    const start = Math.floor(ty / TILE) * level.w + Math.floor(tx / TILE);
    cost[start] = 0;

    const price = new Float32Array(size);
    for (let i = 0; i < size; i += 1) {
        const t = level.tiles[i];
        if (t === WALL || t === CRATE) { price[i] = Infinity; continue; }
        const x = (i % level.w + 0.5) * TILE;
        const y = ((i / level.w | 0) + 0.5) * TILE;
        let p = 1 + illumination(level, w.lights, x, y) * 9;
        if (t === GRASS) p *= 0.45;
        for (const g of w.guards) {
            if (isOut(g)) continue;
            const d = Math.hypot(g.x - x, g.y - y);
            if (d < GUARD.sight) p += 6 * (1 - d / GUARD.sight);
            if (canSee(level, g, { x, y, lit: 1, grass: t === GRASS })) p += 320;
        }
        price[i] = p;
    }

    // Дейкстра на маленьком поле: тысяча клеток, сортировать нечего.
    const open = [start];
    while (open.length) {
        let bi = 0;
        for (let i = 1; i < open.length; i += 1) if (cost[open[i]] < cost[open[bi]]) bi = i;
        const at = open.splice(bi, 1)[0];
        const ax = at % level.w;
        const ay = (at / level.w) | 0;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = ax + ox;
            const ny = ay + oy;
            if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h) continue;
            const idx = ny * level.w + nx;
            if (!Number.isFinite(price[idx])) continue;
            const next = cost[at] + price[idx];
            if (next < cost[idx]) { cost[idx] = next; open.push(idx); }
        }
    }
    return cost;
}

function gradient(level, cost, px, py) {
    const cx = Math.floor(px / TILE);
    const cy = Math.floor(py / TILE);
    let best = cost[cy * level.w + cx];
    let bx = 0;
    let by = 0;
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + ox;
        const ny = cy + oy;
        if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h) continue;
        const v = cost[ny * level.w + nx];
        if (v >= best) continue;
        best = v;
        bx = ox;
        by = oy;
    }
    if (!bx && !by) return null;
    const tx = (cx + bx + 0.5) * TILE;
    const ty = (cy + by + 0.5) * TILE;
    const len = Math.hypot(tx - px, ty - py) || 1;
    return { x: (tx - px) / len, y: (ty - py) / len };
}

function target(w) {
    if (w.goal && !w.goal.taken) return w.goal;
    return w.level.exit;
}

function run({ level, kind, limit = 300 }) {
    const w = createWorld(level);
    let t = 0;
    let spottedAt = null;
    let field = null;
    let refresh = 0;
    let hiding = false;
    let patience = 0;
    let stuck = 0;
    let push = 0;
    let lastX = null;
    let lastY = null;

    while (t < limit && !w.done) {
        const aim = target(w);
        // Заперты ворота — прячемся, а не топчемся под ними.
        hiding = kind !== 'напролом' && !gateOpen(w) && (!w.goal || w.goal.taken);

        refresh -= STEP;
        if (!field || refresh <= 0) {
            refresh = kind === 'в тени' ? 0.4 : 1.5;
            field = kind === 'в тени' || hiding
                ? shadowField(w, aim.x, aim.y)
                : flowField(w.level, aim.x, aim.y);
        }

        const step = kind === 'в тени' || hiding
            ? gradient(w.level, field, w.player.x, w.player.y)
            : flowStep(w.level, field, w.player.x, w.player.y);

        // Бот умеет ровно два действия помимо ходьбы: снять со спины и
        // бросить монету, когда встал намертво. Этого хватает, чтобы
        // проверить уровни, где без них не пройти.
        if (kind === 'в тени') {
            for (const g of w.guards) {
                if (isOut(g)) continue;
                if (Math.hypot(g.x - w.player.x, g.y - w.player.y) > 24) continue;
                if (!isBehind(g, w.player.x, w.player.y)) continue;
                tryTakedown(w, false);
                break;
            }
            const moved = Math.hypot(w.player.x - (lastX ?? 0), w.player.y - (lastY ?? 0));
            if (moved > 24) { lastX = w.player.x; lastY = w.player.y; stuck = 0; } else stuck += STEP;
            if (stuck > 3 && w.coinsLeft > 0) {
                w.player.angle = Math.atan2(aim.y - w.player.y, aim.x - w.player.x) + Math.PI / 2;
                throwCoin(w);
                stuck = 0;
            }
        }

        if (kind === 'громко') {
            for (const g of w.guards) {
                if (isOut(g)) continue;
                if (Math.hypot(g.x - w.player.x, g.y - w.player.y) < 150) {
                    w.player.angle = Math.atan2(g.y - w.player.y, g.x - w.player.x);
                    firePistol(w);
                    break;
                }
            }
        }

        // Терпение — это первый способ пройти уровень, и бот обязан им
        // владеть: если следующий шаг выводит под чужой взгляд, он стоит.
        let wait = hiding && illumination(w.level, w.lights, w.player.x, w.player.y) < 0.2;
        if (!wait && step && kind === 'в тени') {
            const ahead = { x: w.player.x + step.x * 22, y: w.player.y + step.y * 22 };
            ahead.lit = illumination(w.level, w.lights, ahead.x, ahead.y);
            ahead.grass = tileAt(w.level, ahead.x, ahead.y) === GRASS;
            const risky = w.guards.some((g) => !isOut(g) && canSee(w.level, g, ahead));
            // Терпение не бесконечно: выждав своё, бот идёт напролом целую
            // пару секунд, а не один кадр. Иначе он топчется на месте до
            // конца отсчёта и врёт, что уровень непроходим.
            push -= STEP;
            if (risky && push <= 0) {
                patience += STEP;
                wait = true;
                if (patience > 6) { patience = 0; push = 1.6; wait = false; }
            } else if (!risky) patience = 0;
        }
        updateWorld(w, {
            ax: wait ? 0 : (step?.x ?? 0),
            ay: wait ? 0 : (step?.y ?? 0),
            creep: kind !== 'напролом',
            run: kind === 'напролом',
            aimAngle: null,
        }, STEP);

        t += STEP;
        if (w.alarm.everSpotted && spottedAt === null) {
            spottedAt = t;
            if (process.env.WHERE) {
                const seer = w.guards.find((g) => g.state === 'chase');
                console.log(`  замечен на клетке (${Math.floor(w.player.x / TILE)},${Math.floor(w.player.y / TILE)})` +
                    ` свет ${illumination(w.level, w.lights, w.player.x, w.player.y).toFixed(2)}` +
                    ` кем: ${seer ? seer.id + ' с (' + Math.floor(seer.x / TILE) + ',' + Math.floor(seer.y / TILE) + ')' : '?'}`);
            }
        }
    }

    return { kind, done: w.done ?? 'таймаут', t, spottedAt, w };
}

let bad = 0;

for (const level of LEVELS) {
    // Самая частая ошибка расстановки: выход задан числом, но на карту его
    // поставить забыли. Проверяем до всякой симуляции.
    const probe = createWorld(level);
    if (tileAt(probe.level, probe.level.exit.x, probe.level.exit.y) !== EXIT) {
        console.log(`\n${level.name}\n  ← выход не отмечен на карте символом X`);
        bad += 1;
        continue;
    }

    const kinds = ['напролом', 'в тени'];
    if ((level.rules?.ammo ?? 6) > 0) kinds.push('громко');
    const results = kinds.map((kind) => run({ level, kind }));

    console.log(`\n${level.name}`);
    for (const r of results) {
        const s = r.w.stats;
        console.log(
            `  ${r.kind.padEnd(10)} ${r.done.padEnd(8)} ${r.t.toFixed(1).padStart(6)} с  ` +
            `замечен ${r.spottedAt === null ? 'ни разу' : r.spottedAt.toFixed(1) + ' с'}  ` +
            `убито ${s.killed}  hp ${r.w.player.hp}`,
        );
    }

    const shadow = results.find((r) => r.kind === 'в тени');
    if (shadow.done !== 'win') {
        console.log('  ← тихого маршрута нет: бот в тени не дошёл');
        bad += 1;
    } else if (shadow.spottedAt !== null) {
        console.log('  ← тихий маршрут есть, но бота по дороге заметили');
    }
}

console.log(bad ? `\nНепроходимых тихо уровней: ${bad}` : '\nВсе уровни проходятся тихо.');
process.exitCode = bad ? 1 : 0;
