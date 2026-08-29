/**
 * Мир: всё состояние уровня и один шаг его жизни.
 *
 * Здесь же лежит `emitNoise` — точка, через которую проходит весь слух.
 * Шум не «оповещает всех», а появляется в конкретном месте с конкретным
 * радиусом, и стены его не держат. Именно это делает монетку решением, а
 * не кнопкой «отвлечь».
 */

import { NOISE, PLAYER, COIN, PISTOL, GUARD, TILE } from './tuning.js';
import { buildLevel, makeFlowCache, hidesAt, isExit, crateNear, solidAt } from './level.js';
import { createLight, updateLights, illumination, breakLight, lightOn } from './light.js';
import { createGuard, updateGuard, hearNoise, noticeBody, knockOut, isBehind, isOut } from './guard.js';
import { createPlayer, updatePlayer, hurtPlayer } from './player.js';
import { createAlarm, updateAlarm, disturb, sightMul, CALM, CAUTION, ALERT, SEARCH } from './alarm.js';
import { canSee } from './vision.js';

export function createWorld(def) {
    const level = buildLevel(def);
    const w = {
        level,
        lights: level.lights.map(createLight),
        player: createPlayer(level.spawn),
        guards: level.guards.map(createGuard),
        alarm: createAlarm(),
        /** Кейс: пока он не у игрока, ворота — просто ворота. */
        goal: level.goal ? { x: level.goal.x, y: level.goal.y, taken: false } : null,
        flow: makeFlowCache(level),
        noises: [],
        bullets: [],
        coins: [],
        coinsLeft: COIN.count,
        ammo: PISTOL.ammo,
        fireCd: 0,
        bodyCheck: 0,
        time: 0,
        done: null,
        doneT: 0,
        stats: { killed: 0, downed: 0, stowed: 0, shots: 0, coins: 0 },
        hint: '',
        hintT: 0,
    };
    return w;
}

export function say(w, text, seconds = 2.2) {
    w.hint = text;
    w.hintT = seconds;
}

/**
 * Открыты ли ворота. По тревоге объект запирается, и это главное правило
 * всего уровня: пробежать напролом можно, но выйти на бегу — нельзя.
 *
 * Без него громкий проход занимал шесть секунд и был строго лучшим: пуля
 * дешевле терпения. С ним шум стоит ровно то, что должен, — время. Ждать
 * придётся в укрытии, пока объект не успокоится до «настороже».
 */
export const gateOpen = (w) => w.alarm.state === CALM || w.alarm.state === CAUTION;

/**
 * Шум в точке. Стены его не держат — в этом всё отличие от зрения: за
 * углом можно спрятаться от взгляда, но не от собственного бега.
 */
export function emitNoise(w, x, y, radius, kind = 'step') {
    if (radius <= 0) return;
    w.noises.push({ x, y, radius, life: 0.5, max: 0.5, kind });
    for (const g of w.guards) hearNoise(g, x, y, radius);
    // Выстрел слышит весь объект и понимает, что чужой внутри.
    if (kind === 'shot') disturb(w.alarm, x, y);
}

const litAt = (w, x, y) => illumination(w.level, w.lights, x, y);

/** Снятие со спины. Отменяет бой, а не выигрывает его — в этом вся разница. */
export function tryTakedown(w, lethal) {
    const p = w.player;
    if (p.dead || p.dragging) return false;

    let best = null;
    let bestD = PLAYER.reach;
    for (const g of w.guards) {
        if (isOut(g)) continue;
        const d = Math.hypot(g.x - p.x, g.y - p.y);
        if (d > PLAYER.reach) continue;
        if (!isBehind(g, p.x, p.y)) continue;
        if (!best || d < bestD) { best = g; bestD = d; }
    }
    if (!best) return false;

    knockOut(best, lethal);
    if (lethal) w.stats.killed += 1; else w.stats.downed += 1;
    emitNoise(w, best.x, best.y, lethal ? NOISE.knife : NOISE.choke, 'takedown');
    say(w, lethal ? 'Насмерть. Тело найдут — спрячь.' : 'Оглушён. Очнётся через минуту, если не спрятать.');
    return true;
}

/** Взять тело на плечо или бросить его. */
export function toggleCarry(w) {
    const p = w.player;
    if (p.dead) return false;

    if (p.dragging) {
        const g = p.dragging;
        const hide = crateNear(w.level, g.x, g.y) || hidesAt(w.level, g.x, g.y);
        if (hide) {
            g.stowed = true;
            w.stats.stowed += 1;
            say(w, 'Спрятано. Этого уже не найдут.');
        } else {
            emitNoise(w, g.x, g.y, NOISE.bodyDrop, 'body');
            say(w, 'Тело на виду. За ящик или в траву.');
        }
        p.dragging = null;
        return true;
    }

    let best = null;
    let bestD = PLAYER.reach + 6;
    for (const g of w.guards) {
        if (!isOut(g) || g.stowed) continue;
        const d = Math.hypot(g.x - p.x, g.y - p.y);
        if (d < bestD) { best = g; bestD = d; }
    }
    if (!best) return false;
    p.dragging = best;
    say(w, 'Тело на плече. Вдвое медленнее.');
    return true;
}

/**
 * Монетка. Летит, падает и шумит там, куда упала, — а страж идёт НА ЗВУК.
 * Отвлечение получается само собой, без единой строчки про «отвлечь».
 */
export function throwCoin(w) {
    const p = w.player;
    if (p.dead || w.coinsLeft <= 0) return false;
    w.coinsLeft -= 1;
    w.stats.coins += 1;
    w.coins.push({
        x: p.x,
        y: p.y,
        vx: Math.cos(p.angle) * COIN.speed,
        vy: Math.sin(p.angle) * COIN.speed,
        left: COIN.range,
        landed: false,
        t: 0,
    });
    return true;
}

export function firePistol(w) {
    const p = w.player;
    if (p.dead || w.ammo <= 0 || w.fireCd > 0 || p.dragging) return false;
    w.ammo -= 1;
    w.fireCd = PISTOL.cooldown;
    w.stats.shots += 1;
    spawnBullet(w, p.x, p.y, p.angle, true);
    emitNoise(w, p.x, p.y, NOISE.shot, 'shot');
    return true;
}

function spawnBullet(w, x, y, angle, fromPlayer) {
    w.bullets.push({
        x,
        y,
        vx: Math.cos(angle) * PISTOL.speed,
        vy: Math.sin(angle) * PISTOL.speed,
        life: PISTOL.range / PISTOL.speed,
        fromPlayer,
    });
}

function guardShoot(w, g, angle) {
    spawnBullet(w, g.x + Math.cos(angle) * 10, g.y + Math.sin(angle) * 10, angle, false);
    emitNoise(w, g.x, g.y, NOISE.shot, 'shot');
}

function stepBullets(w, dt) {
    const p = w.player;
    for (const b of w.bullets) {
        const steps = 4;
        for (let i = 0; i < steps && b.life > 0; i += 1) {
            b.x += (b.vx * dt) / steps;
            b.y += (b.vy * dt) / steps;
            if (solidAt(w.level, b.x, b.y)) { b.life = 0; break; }

            if (b.fromPlayer) {
                // Пуля гасит фонарь. Тьму можно не искать, а делать, —
                // ценой самого громкого звука на уровне.
                for (const l of w.lights) {
                    if (!lightOn(l)) continue;
                    if (Math.hypot(l.x - b.x, l.y - b.y) < 10) {
                        breakLight(l);
                        b.life = 0;
                        say(w, 'Фонарь разбит. Здесь теперь темно.');
                        break;
                    }
                }
                if (b.life <= 0) break;
                for (const g of w.guards) {
                    if (isOut(g)) continue;
                    if (Math.hypot(g.x - b.x, g.y - b.y) < g.r + 2) {
                        knockOut(g, true);
                        w.stats.killed += 1;
                        b.life = 0;
                        break;
                    }
                }
            } else if (!p.dead && Math.hypot(p.x - b.x, p.y - b.y) < p.r + 2) {
                hurtPlayer(p);
                b.life = 0;
            }
        }
        b.life -= dt;
    }
    w.bullets = w.bullets.filter((b) => b.life > 0);
}

function stepCoins(w, dt) {
    for (const c of w.coins) {
        if (c.landed) { c.t += dt; continue; }
        const nx = c.x + c.vx * dt;
        const ny = c.y + c.vy * dt;
        c.left -= Math.hypot(nx - c.x, ny - c.y);
        if (solidAt(w.level, nx, ny) || c.left <= 0) {
            c.landed = true;
            emitNoise(w, c.x, c.y, NOISE.coin, 'coin');
        } else {
            c.x = nx;
            c.y = ny;
        }
    }
    // Упавшую монетку можно подобрать: их всего три, и они не расходники.
    const p = w.player;
    w.coins = w.coins.filter((c) => {
        if (c.landed && c.t > 0.4 && Math.hypot(c.x - p.x, c.y - p.y) < 14) {
            w.coinsLeft += 1;
            return false;
        }
        return true;
    });
}

/**
 * Тела ищут глазами, как и игрока. Найденное тело поднимает ПОИСК, а не
 * ТРЕВОГУ: знать, что чужой на объекте, и знать, где он, — разные вещи.
 */
function checkBodies(w, dt) {
    w.bodyCheck -= dt;
    if (w.bodyCheck > 0) return;
    w.bodyCheck = 0.2;

    const mul = sightMul(w.alarm);
    for (const g of w.guards) {
        if (isOut(g) || g.state === 'chase') continue;
        for (const b of w.guards) {
            if (b === g || !isOut(b) || b.stowed) continue;
            const target = { x: b.x, y: b.y, lit: litAt(w, b.x, b.y), grass: hidesAt(w.level, b.x, b.y) };
            if (canSee(w.level, g, target, mul)) {
                noticeBody(g, b, w.alarm);
                break;
            }
        }
    }
}

/**
 * Ранг. Считает не скорость, а следы: прошёл ли объект так, будто тебя тут
 * не было. Скорость тоже показывается — но соревноваться в ней игрок
 * начинает сам, и только когда научился проходить чисто.
 */
export function rankOf(w) {
    const s = w.stats;
    const a = w.alarm;
    if (!a.everAlarmed && s.killed === 0 && s.downed === 0) {
        return { rank: 'S', text: 'Призрак: никто ничего не заметил' };
    }
    if (!a.everAlarmed && s.killed === 0) return { rank: 'A', text: 'Все живы, и никто не хватился' };
    if (!a.everSpotted && s.killed === 0) return { rank: 'B', text: 'Переполох был, но тебя не видели' };
    if (s.killed === 0) return { rank: 'C', text: 'Заметили, но все живы' };
    return { rank: 'D', text: 'Громко' };
}

export function updateWorld(w, input, dt) {
    if (w.done) { w.doneT += dt; return; }

    w.time += dt;
    w.hintT = Math.max(0, w.hintT - dt);
    if (w.hintT <= 0) w.hint = '';
    w.fireCd = Math.max(0, w.fireCd - dt);

    updateLights(w.lights, dt);

    const p = w.player;
    p.lit = litAt(w, p.x, p.y);
    p.grass = hidesAt(w.level, p.x, p.y);

    const noise = updatePlayer(p, w.level, input, dt);
    if (noise > 0) emitNoise(w, p.x, p.y, noise, 'step');

    // Тело едет за игроком, но не сквозь стены.
    if (p.dragging) {
        const bx = p.x - Math.cos(p.angle) * 15;
        const by = p.y - Math.sin(p.angle) * 15;
        if (!solidAt(w.level, bx, by)) { p.dragging.x = bx; p.dragging.y = by; }
    }

    const ctx = {
        level: w.level,
        alarm: w.alarm,
        player: p,
        flow: w.flow,
        noise: (x, y, r, kind) => emitNoise(w, x, y, r, kind),
        shoot: (g, angle) => guardShoot(w, g, angle),
    };

    for (const g of w.guards) {
        g.lit = litAt(w, g.x, g.y);
        updateGuard(g, ctx, dt);
    }

    // Пока игрока видят, тревога знает, где он.
    if (w.alarm.state === 'alert') {
        for (const g of w.guards) {
            if (isOut(g) || g.state !== 'chase') continue;
            if (canSee(w.level, g, p, sightMul(w.alarm))) {
                w.alarm.point = { x: p.x, y: p.y };
                w.alarm.grace = GUARD.memory;
                break;
            }
        }
    }

    checkBodies(w, dt);
    stepBullets(w, dt);
    stepCoins(w, dt);
    updateAlarm(w.alarm, dt);

    for (const n of w.noises) n.life -= dt;
    w.noises = w.noises.filter((n) => n.life > 0);

    if (w.goal && !w.goal.taken && Math.hypot(w.goal.x - p.x, w.goal.y - p.y) < 15) {
        w.goal.taken = true;
        say(w, 'Кейс у тебя. Теперь к северным воротам.', 3);
    }

    if (p.dead) { w.done = 'lose'; w.doneT = 0; return; }
    if (isExit(w.level, p.x, p.y)) {
        if (w.goal && !w.goal.taken) {
            if (!w.hintT) say(w, 'Без кейса выходить незачем. Он на складе.', 2);
        } else if (!gateOpen(w)) {
            if (!w.hintT) say(w, 'Ворота заперты по тревоге. Спрячься и переждать.', 2);
        } else {
            w.done = 'win';
            w.doneT = 0;
        }
    }
}
