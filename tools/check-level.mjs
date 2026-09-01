/**
 * Проверяльщик уровня.
 *
 * Уровень в стелсе обязан проходиться несколькими способами. Это заявление
 * легко сделать и трудно проверить: глазами видно только тот путь, который
 * ты сам и задумал. Поэтому здесь три бота, и каждый играет по-своему.
 *
 *   напролом — идёт кратчайшим путём и не смотрит по сторонам;
 *   грубо    — бежит напрямик, но, попавшись, прячется и ждёт отбоя;
 *   в тени   — считает стоимость клетки по свету и чужим конусам;
 *   громко   — то же напролом, но стреляет во всё, что видит.
 *
 * «Грубо» — проверка второй дороги. Она существует только тогда, когда за
 * шум платят временем, а не жизнью: если этот бот доходит, у игры есть
 * второй способ; если гибнет или стоит вечно — второго способа нет.
 *
 * Запуск без ключей гоняет всех ботов и считает минуты — это работа по
 * планировке. Ключ `--quick` оставляет только «в тени» и короткий отсчёт:
 * это ворота выкладки, где проверяется одно — существует ли тихий маршрут.
 * Медленная проверка в воротах приводит к тому, что ворота обходят.
 *
 * Полезен не столько зелёный ответ, сколько красный: «в тени» не дошёл —
 * значит, тихого маршрута на карте нет, и это ошибка расстановки, а не
 * игрока. Запуск: node tools/check-level.mjs
 */

import { LEVELS } from '../src/levels.js';
import { createWorld, updateWorld, firePistol, throwCoin, tryTakedown, gateOpen } from '../src/world.js';
import { flowField, flowStep, tileAt, zoneAt, WALL, CRATE, GRASS, EXIT } from '../src/level.js';
import { illumination } from '../src/light.js';
import { canSee, sightReach } from '../src/vision.js';
import { isOut, isBehind } from '../src/guard.js';
import { TILE, GUARD, PLAYER } from '../src/tuning.js';

const STEP = 1 / 120;

/*
 * Одинаковое зерно на каждый прогон.
 *
 * В игре есть случайность: стражи выбирают точки прочёсывания, болтают и
 * тянут варианты шагов из банка. От этого один и тот же уровень давал то
 * победу за 16 секунд, то таймаут, и проверяльщику нельзя было верить —
 * а непроверяемая проверка хуже отсутствующей: она даёт ложную опору.
 */
const random = () => {
    random.seed = (random.seed * 1664525 + 1013904223) >>> 0;
    return random.seed / 4294967296;
};
Math.random = random;

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
            // Луч бросаем только туда, куда страж в принципе может дотянуться
            // взглядом: без этого проверяльщик считает минутами, а не секундами.
            if (d >= GUARD.sight) continue;
            p += 6 * (1 - d / GUARD.sight);
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

/**
 * Сколькими способами проходится уровень — по-настоящему, а не по замыслу.
 *
 * «Проходится четырьмя способами» легко написать и трудно проверить: глазами
 * видно только тот путь, который сам и задумал. Здесь способ определяется
 * двумя вещами сразу — **чем боту разрешено пользоваться** и **через какие
 * комнаты он прошёл**. Второе берётся из зон камеры, они уже размечены.
 *
 * Два прохождения считаются разными, если различается хоть одно: набор
 * умений или цепочка комнат.
 */
/**
 * Подпись маршрута: через какие места он прошёл.
 *
 * Комнаты камеры годятся, но размечены только на объекте, и на остальных
 * семи уровнях подпись выходила пустой — измеритель молча мерил ничего.
 * Поэтому запасной вариант: девять секторов карты. Грубо, зато есть везде.
 */
const SECTORS = [['СЗ', 'С', 'СВ'], ['З', 'Ц', 'В'], ['ЮЗ', 'Ю', 'ЮВ']];

/**
 * Сколько независимых дорог ведёт от входа к выходу — свойство карты, а не
 * бота.
 *
 * Считать маршруты прогонами нельзя: жадный бот всегда идёт кратчайшим
 * путём и на любой карте даёт «один». Отрицательный контроль поймал это
 * сразу — на комнате с двумя заведомыми обходами он насчитал одну дорогу.
 * Меряем структурно: находим путь, перекрываем его узкие места, ищем
 * следующий. Сколько раз нашлось — столько независимых дорог.
 *
 * Узкое место — клетка, у которой не больше двух свободных соседей: именно
 * такие и разделяют обходы. Перекрывать весь путь нельзя, иначе считаются
 * не дороги, а их сдвиги на клетку.
 */
function routeCount(level, limit = 6) {
    const w = level.w;
    const free = (i) => {
        const t = level.tiles[i];
        return t !== WALL && t !== CRATE;
    };
    const blocked = new Set();
    const start = Math.floor(level.spawn.y / TILE) * w + Math.floor(level.spawn.x / TILE);
    const goal = Math.floor(level.exit.y / TILE) * w + Math.floor(level.exit.x / TILE);
    const routes = [];

    while (routes.length < limit) {
        const from = new Int32Array(level.w * level.h).fill(-2);
        const queue = [start];
        from[start] = -1;
        let found = false;
        for (let head = 0; head < queue.length && !found; head += 1) {
            const at = queue[head];
            if (at === goal) { found = true; break; }
            const ax = at % w;
            for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = ax + ox;
                const ny = ((at / w) | 0) + oy;
                if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h) continue;
                const idx = ny * w + nx;
                if (from[idx] !== -2 || !free(idx) || blocked.has(idx)) continue;
                from[idx] = at;
                queue.push(idx);
            }
        }
        if (from[goal] === -2) break;

        const path = [];
        for (let at = goal; at !== -1; at = from[at]) path.push(at);
        routes.push(path.length);

        for (const idx of path) {
            if (idx === start || idx === goal) continue;
            const x = idx % w;
            const y = (idx / w) | 0;
            let open = 0;
            for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = x + ox;
                const ny = y + oy;
                if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h) continue;
                if (free(ny * w + nx)) open += 1;
            }
            if (open <= 2) blocked.add(idx);
        }
        if (!blocked.size) break;
    }
    return routes.length;
}

function sector(level, x, y) {
    const zone = zoneAt(level, x, y);
    if (zone?.name) return zone.name;
    const col = Math.min(2, Math.floor((x / level.pixelW) * 3));
    const row = Math.min(2, Math.floor((y / level.pixelH) * 3));
    return SECTORS[row][col];
}

const WAYS = [
    { name: 'переждать', caps: { coins: false, takedown: false } },
    { name: 'отвлечь', caps: { coins: true, takedown: false } },
    { name: 'убрать', caps: { coins: false, takedown: true } },
    { name: 'всё сразу', caps: { coins: true, takedown: true } },
];

function run({ level, kind, limit = 150, caps = null, seed = 20260830 }) {
    random.seed = seed;
    const w = createWorld(level);
    const zonePath = [];
    let t = 0;
    let spottedAt = null;
    let field = null;
    let refresh = 0;
    let hiding = false;
    let patience = 0;
    let stuck = 0;
    let push = 0;
    let coinCd = 0;
    let lastX = null;
    let lastY = null;

    while (t < limit && !w.done) {
        const aim = target(w);
        // Заперты ворота — прячемся, а не топчемся под ними.
        // Прятаться приходится по двум причинам: ворота заперты тревогой
        // или тебя продырявили. Второе — обычный ход громкого прохождения,
        // а не поражение: отсидеться и выйти, когда объект успокоится.
        const hurt = kind === 'громко' && w.player.hp <= 2 && w.alarm.state !== 'calm';
        const locked = !gateOpen(w) && (!w.goal || w.goal.taken);
        hiding = kind !== 'напролом' && (hurt || locked);

        refresh -= STEP;
        if (!field || refresh <= 0) {
            refresh = kind === 'в тени' ? 0.5 : (hiding ? 1.5 : 2.5);
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
        /*
         * Заход за спину. Кратчайший путь ведёт бота к стражу сбоку, а
         * сбоку снять нельзя: его нащупывают раньше, чем он дотянется. Как
         * и живой игрок, бот сначала встаёт за спину и только потом бьёт.
         */
        let behindPoint = null;
        if (kind === 'в тени' && caps?.takedown !== false) {
            for (const g of w.guards) {
                if (isOut(g)) continue;
                const dist = Math.hypot(g.x - w.player.x, g.y - w.player.y);
                if (dist < 90 && !isBehind(g, w.player.x, w.player.y)) {
                    behindPoint = {
                        x: g.x - Math.cos(g.angle) * (PLAYER.reach - 6),
                        y: g.y - Math.sin(g.angle) * (PLAYER.reach - 6),
                    };
                    break;
                }
            }
            for (const g of w.guards) {
                if (isOut(g)) continue;
                /*
                 * Бить надо раньше, чем страж нащупает: дистанция снятия
                 * 32, радиус чутья 26 на полном свету. Пока бот подходил
                 * на 24, он попадал внутрь чутья и объявлял непроходимым
                 * уровень, который ровно снятию и учит.
                 */
                if (Math.hypot(g.x - w.player.x, g.y - w.player.y) > PLAYER.reach - 2) continue;
                if (!isBehind(g, w.player.x, w.player.y)) continue;
                tryTakedown(w, false);
                break;
            }
            const moved = Math.hypot(w.player.x - (lastX ?? 0), w.player.y - (lastY ?? 0));
            if (moved > 24) { lastX = w.player.x; lastY = w.player.y; stuck = 0; } else stuck += STEP;
            coinCd = Math.max(0, coinCd - STEP);
        }

        if (kind === 'громко' && !hiding) {
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
                /*
                 * Монету бросают не от отчаяния, а увидев, что дальше не
                 * пройти. Пока бот кидал её, простояв три секунды, он
                 * успевал попасться раньше — и объявлял непроходимым
                 * уровень, который ровно этому и учит.
                 */
                if (coinCd <= 0 && w.coinsLeft > 0 && caps?.coins !== false) {
                    w.player.angle = Math.atan2(aim.y - w.player.y, aim.x - w.player.x) + Math.PI / 2;
                    if (throwCoin(w)) { coinCd = 6; patience = 0; }
                } else if (patience > 6) { patience = 0; push = 1.6; wait = false; }
            } else if (!risky) patience = 0;
        }
        // Пока идём за спину, слушаемся этой цели, а не волны пути.
        let dirX = step?.x ?? 0;
        let dirY = step?.y ?? 0;
        if (behindPoint) {
            const bx = behindPoint.x - w.player.x;
            const by = behindPoint.y - w.player.y;
            const bl = Math.hypot(bx, by) || 1;
            if (bl > 4) { dirX = bx / bl; dirY = by / bl; wait = false; }
        }

        updateWorld(w, {
            ax: wait ? 0 : dirX,
            ay: wait ? 0 : dirY,
            creep: kind === 'в тени' || (hiding && kind !== 'грубо'),
            run: kind === 'напролом' || (kind === 'грубо' && !hiding),
            aimAngle: null,
        }, STEP);

        t += STEP;
        const mark = sector(w.level, w.player.x, w.player.y);
        if (zonePath[zonePath.length - 1] !== mark) zonePath.push(mark);
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

    return { kind, done: w.done ?? 'таймаут', t, spottedAt, w, zonePath };
}

const QUICK = process.argv.includes('--quick');
const WAYS_ONLY = process.argv.includes('--ways');
let bad = 0;

/*
 * Режим подсчёта способов. Каждый набор умений гоняется тремя зёрнами:
 * одиночный прогон ловит вариант, а не правило, и это верно в обе стороны.
 */
if (WAYS_ONLY) {
    /*
     * Отрицательный контроль измерителя.
     *
     * У подписи маршрута уже нашлась одна слепота — она бралась из зон
     * камеры и на семи уровнях выходила пустой. Раз одна нашлась, надо
     * искать вторую: прогоняем измеритель там, где ответ известен заранее.
     * «Развилка» проходится двумя сторонами, «Труба» — только одной.
     * Скажет иначе — врёт он, а не игра.
     */
    const room = (map, spawn, exit) => ({
        name: '', map, spawn, exit, lights: [], guards: [], ambient: 1,
        rules: { coins: 0, ammo: 0, box: false },
    });
    const CONTROL = [
        ['Развилка (ждём 2)', room([
            '####################',
            '#..................#',
            '#..................#',
            '#....##########....#',
            '#....##########....#',
            '#....##########....#',
            '#..................#',
            '#.................X#',
            '####################',
        ], { x: 2, y: 4 }, { x: 18, y: 7 }), 2],
        ['Труба (ждём 1)', room([
            '####################',
            '####################',
            '#..................#',
            '#.................X#',
            '####################',
            '####################',
        ], { x: 2, y: 2 }, { x: 18, y: 3 }), 1],
    ];

    console.log('Отрицательный контроль измерителя');
    for (const [name, level, want] of CONTROL) {
        const seen = new Set();
        for (const seed of [1, 2, 3, 4, 5, 6]) {
            const r = run({ level, kind: 'напролом', seed, limit: 40 });
            if (r.done === 'win') seen.add(r.zonePath.join(' → '));
        }
        const built = createWorld(level);
        const structural = routeCount(built.level);
        const verdict = structural === want ? 'ок' : 'ИЗМЕРИТЕЛЬ СЛЕП';
        console.log(`  ${name.padEnd(20)} дорог по карте ${structural}, ждали ${want}  ${verdict}` +
            `  (прогонами бот нашёл ${seen.size} — он всегда идёт кратчайшим)`);
    }

    for (const level of LEVELS) {
        console.log(`\n${level.name}`);
        const routes = new Map();
        for (const way of WAYS) {
            const tries = [20260830, 7771, 424242].map((seed) =>
                run({ level, kind: 'в тени', caps: way.caps, seed, limit: 120 }));
            const won = tries.filter((r) => r.done === 'win');
            const clean = won.filter((r) => r.spottedAt === null);
            const best = won[0];
            const used = tries.reduce((n, r) => n + r.w.stats.coins + r.w.stats.downed + r.w.stats.killed, 0);
            const path = best ? best.zonePath.join(' → ') : '';
            if (best) {
                const seen = routes.get(path) ?? [];
                seen.push(way.name);
                routes.set(path, seen);
            }
            console.log(
                `  ${way.name.padEnd(11)} дошёл ${won.length}/3` +
                `  незамеченным ${clean.length}/3` +
                `  умения применены ${used} раз` +
                (best ? `  ${best.t.toFixed(1)} с  ${path}` : '  —'),
            );
        }
        const built = createWorld(level);
        console.log(`  → дорог по карте: ${routeCount(built.level)}` +
            `, различимых прогонами: ${routes.size}`);
        for (const [path, ways] of routes) console.log(`     ${ways.join(', ')}: ${path}`);
    }
    process.exit(0);
}

for (const level of LEVELS) {
    // Самая частая ошибка расстановки: выход задан числом, но на карту его
    // поставить забыли. Проверяем до всякой симуляции.
    const probe = createWorld(level);
    if (tileAt(probe.level, probe.level.exit.x, probe.level.exit.y) !== EXIT) {
        console.log(`\n${level.name}\n  ← выход не отмечен на карте символом X`);
        bad += 1;
        continue;
    }

    const kinds = QUICK ? ['в тени'] : ['напролом', 'грубо', 'в тени'];
    if (!QUICK && (level.rules?.ammo ?? 6) > 0) kinds.push('громко');
    const results = kinds.map((kind) => run({ level, kind, limit: QUICK ? 90 : 150 }));

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
    const rough = results.find((r) => r.kind === 'грубо');
    if (shadow.done !== 'win') {
        console.log('  ← тихого маршрута нет: бот в тени не дошёл');
        bad += 1;
    } else if (shadow.spottedAt !== null) {
        console.log('  ← тихий маршрут есть, но бота по дороге заметили');
    }
    if (rough && rough.done !== 'win') {
        console.log('  ← второй дороги нет: грубый бот не дошёл');
        bad += 1;
    } else if (rough && rough.spottedAt === null) {
        console.log('  ← «грубо» здесь не отличается от «тихо»: бегуна не заметили');
    }
}

console.log(bad ? `\nКомнат с изъяном: ${bad}` : '\nВсе комнаты проходятся и тихо, и грубо.');
process.exitCode = bad ? 1 : 0;
