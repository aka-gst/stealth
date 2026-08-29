/**
 * Страж: патруль, слух, погоня и поиск.
 *
 * Ума ровно столько, сколько нужно, чтобы шум был решением игрока, а не
 * фоном. Три вещи, которые здесь важнее всего:
 *
 *   Он идёт НА ЗВУК, а не к игроку. Отсюда бесплатно получается всё
 *   отвлечение: монетка, брошенная в сторону, уводит патруль туда.
 *
 *   Голова поворачивается со скоростью, а не мгновенно. Окно, в которое
 *   игрок проскакивает за спину, должно быть видно глазами.
 *
 *   Заметив, он кричит. Один увидевший поднимает весь объект — иначе
 *   «убить громко» не имеет цены, а тихий проход не имеет смысла.
 */

import { GUARD, NOISE, PLAYER, BOX } from './tuning.js';
import { moveCircle, flowStep } from './level.js';
import { canSee, turnToward, normalizeAngle } from './vision.js';
import { ALERT, SEARCH, CALM, spotted, disturb, sightMul, speedMul } from './alarm.js';

export function createGuard(def, index) {
    return {
        id: `guard-${index}`,
        /**
         * Имя, одна строка жизни и то, что он бормочет себе под нос на
         * маршруте. Человека надо встретить живым — иначе он навсегда
         * останется фигурой на экране, и потом с ним ничего не случится.
         */
        name: def.name ?? '',
        bio: def.bio ?? '',
        lines: def.lines ?? [],
        chatT: 5 + index * 3.5,
        x: def.at.x,
        y: def.at.y,
        vx: 0,
        vy: 0,
        r: GUARD.radius,
        angle: def.angle,
        state: 'patrol',
        /** Сколько уже держит игрока в конусе. Мгновенных обнаружений нет. */
        notice: 0,
        route: def.route.length ? def.route : [{ ...def.at, wait: 99, look: true }],
        routeIndex: 0,
        waitLeft: 0,
        lookPhase: 0,
        baseAngle: def.angle,
        /** Куда идёт проверять. null — ничего не слышал. */
        suspect: null,
        suspectT: 0,
        searchSpot: null,
        searchT: 0,
        aim: 0,
        shootCd: 0,
        mark: null,
        markT: 0,
        say: '',
        sayT: 0,
        lit: 0,
        down: false,
        dead: false,
        wake: 0,
        home: { x: def.at.x, y: def.at.y },
        homeAngle: def.angle,
    };
}

export const isOut = (g) => g.down || g.dead;

/** Настроение одним словом — для значка над головой и цвета конуса. */
export function moodOf(g) {
    if (g.dead) return 'dead';
    if (g.down) return 'down';
    if (g.state === 'chase') return 'alert';
    if (g.state === 'suspect' || g.state === 'search') return 'suspect';
    return 'calm';
}

function bark(g, text, seconds = 1.6) {
    g.say = text;
    g.sayT = seconds;
}

function mark(g, sign, seconds = 1.4) {
    g.mark = sign;
    g.markT = seconds;
}

/**
 * Услышанный шум. Стены его не держат — в этом весь смысл: зрение
 * перекрывается геометрией, слух нет.
 */
export function hearNoise(g, x, y, radius) {
    if (isOut(g) || radius <= 0) return false;
    if (Math.hypot(x - g.x, y - g.y) > radius) return false;

    // Того, кто уже гонится, шумом не удивишь.
    if (g.state === 'chase') return false;

    const fresh = g.state !== 'suspect';
    g.state = 'suspect';
    g.suspect = { x, y };
    g.suspectT = NOISE.investigate;
    if (fresh) mark(g, '?', 1.6);
    if (fresh) bark(g, 'Кто здесь?');
    return fresh;
}

/** Увидел тело. Знает, что чужой есть; где — не знает. */
export function noticeBody(g, body, alarm) {
    if (isOut(g) || g.state === 'chase') return false;
    disturb(alarm, body.x, body.y);
    g.state = 'suspect';
    g.suspect = { x: body.x, y: body.y };
    g.suspectT = NOISE.investigate;
    mark(g, '!', 1.8);
    bark(g, body.dead ? 'Труп!' : 'Он без сознания!', 2.2);
    return true;
}

export function knockOut(g, lethal) {
    if (lethal) g.dead = true;
    else {
        g.down = true;
        g.wake = GUARD.wakeTime;
    }
    g.vx = 0;
    g.vy = 0;
    g.state = lethal ? 'dead' : 'down';
    g.mark = null;
    g.say = '';
}

function steer(g, dx, dy, speed, dt) {
    const len = Math.hypot(dx, dy) || 1;
    g.vx += (dx / len) * GUARD.accel * dt;
    g.vy += (dy / len) * GUARD.accel * dt;
    const s = Math.hypot(g.vx, g.vy);
    if (s > speed) {
        g.vx = (g.vx / s) * speed;
        g.vy = (g.vy / s) * speed;
    }
}

function brake(g, dt) {
    const f = GUARD.friction * dt;
    const s = Math.hypot(g.vx, g.vy);
    if (s <= f) { g.vx = 0; g.vy = 0; return; }
    g.vx -= (g.vx / s) * f;
    g.vy -= (g.vy / s) * f;
}

/** Шаг по волне к точке: страж огибает здание, а не утыкается в стену. */
function goTo(g, ctx, tx, ty, speed, dt) {
    const dist = Math.hypot(tx - g.x, ty - g.y);
    if (dist < 12) { brake(g, dt); return true; }

    const field = ctx.flow.to(tx, ty);
    const step = flowStep(ctx.level, field, g.x, g.y);
    if (step) steer(g, step.x, step.y, speed, dt);
    else steer(g, tx - g.x, ty - g.y, speed, dt);
    return false;
}

/** Взгляд водит по сторонам: стоящий страж не статуя. */
function sweep(g, dt) {
    g.lookPhase += dt * 1.25;
    return g.baseAngle + Math.sin(g.lookPhase) * GUARD.scanTurn;
}

export function updateGuard(g, ctx, dt) {
    if (g.dead) return;

    g.markT = Math.max(0, g.markT - dt);
    if (g.markT <= 0) g.mark = null;
    g.sayT = Math.max(0, g.sayT - dt);
    if (g.sayT <= 0) g.say = '';
    g.shootCd = Math.max(0, g.shootCd - dt);

    if (g.down) {
        // Спрятанный не очнётся: спрятать тело — значит решить задачу
        // совсем, а не отложить её.
        if (g.stowed || ctx.rules?.wake === false) return;
        // Оглушённый приходит в себя — и, если его не спрятали, поднимает
        // тревогу. Оглушить и бросить посреди двора значит отложить провал,
        // а не отменить его.
        g.wake -= dt;
        if (g.wake <= 0) {
            g.down = false;
            g.state = 'suspect';
            g.suspect = { x: g.x, y: g.y };
            g.suspectT = NOISE.investigate;
            disturb(ctx.alarm, g.x, g.y);
            mark(g, '!', 2);
            bark(g, 'Меня вырубили!', 2.4);
        }
        return;
    }

    const { level, alarm, player } = ctx;
    const rules = ctx.rules ?? {};
    const mulSight = sightMul(alarm) * (rules.sight ?? 1);
    const mulSpeed = speedMul(alarm) * (rules.speed ?? 1);
    const noticeBase = GUARD.notice * (rules.notice ?? 1);
    const memory = GUARD.memory * (rules.memory ?? 1);

    // Зрение считается раньше состояний: увидеть можно в любом из них.
    // Коробка не спасает того, на кого наткнулись вплотную.
    const boxed = player.hidden && Math.hypot(player.x - g.x, player.y - g.y) > BOX.bump;
    const sees = !player.dead && !boxed && canSee(level, g, player, mulSight);
    // Чем ближе, тем быстрее узнают: у самого носа — почти мгновенно, на
    // пределе дальности — приглядываются.
    const dist = Math.hypot(player.x - g.x, player.y - g.y);
    const noticeNeed = noticeBase
        * Math.max(GUARD.noticeNear, Math.min(1, dist / (GUARD.sight * mulSight)));
    if (sees) {
        g.notice += dt;
        if (g.notice >= noticeNeed) {
            if (g.state !== 'chase') {
                mark(g, '!', 2);
                bark(g, 'Стой!', 2);
                // Крик — тоже шум: один увидевший собирает весь объект.
                // Пока обучение, кричать некому: гонится только он сам.
                if (rules.backup !== false) ctx.noise(g.x, g.y, NOISE.shout, 'shout');
            }
            g.state = 'chase';
            g.lastSeen = { x: player.x, y: player.y };
            if (rules.backup !== false) spotted(alarm, player.x, player.y);
            else { alarm.everSpotted = true; g.memoryLeft = memory; }
        }
    } else {
        g.notice = Math.max(0, g.notice - dt * 0.8);
    }

    // Общая тревога тянет за собой всех: увидел один — идут все.
    if (alarm.state === ALERT && g.state !== 'chase') {
        g.state = 'chase';
        mark(g, '!', 1.4);
    }
    if (alarm.state === SEARCH && (g.state === 'chase' || g.state === 'patrol')) {
        if (g.state === 'chase') {
            g.state = 'search';
            g.searchSpot = null;
            g.searchT = 0;
            bark(g, 'Где он?');
        }
    }
    if (alarm.state === CALM && (g.state === 'search' || g.state === 'chase')) {
        g.state = 'patrol';
        bark(g, 'Показалось.');
    }

    let wantAngle = g.angle;
    const moving = Math.hypot(g.vx, g.vy) > 12;

    switch (g.state) {
        case 'patrol': {
            // Болтовня себе под нос — только пока всё спокойно. Это не
            // подсказка и не механика: это единственная возможность узнать,
            // кто перед тобой, пока он ещё жив.
            if (g.lines.length && alarm.state === CALM && !sees) {
                g.chatT -= dt;
                if (g.chatT <= 0) {
                    g.chatT = 11 + Math.random() * 9;
                    bark(g, g.lines[Math.floor(Math.random() * g.lines.length)], 2.6);
                }
            }

            const point = g.route[g.routeIndex % g.route.length];
            if (g.waitLeft > 0) {
                brake(g, dt);
                g.waitLeft -= dt;
                wantAngle = point.look ? sweep(g, dt) : g.angle;
                if (g.waitLeft <= 0) {
                    g.routeIndex = (g.routeIndex + 1) % g.route.length;
                    g.lookPhase = 0;
                }
            } else if (goTo(g, ctx, point.x, point.y, GUARD.patrolSpeed * mulSpeed, dt)) {
                g.waitLeft = point.wait ?? 0;
                g.baseAngle = g.angle;
                g.lookPhase = 0;
                if (g.waitLeft <= 0) g.routeIndex = (g.routeIndex + 1) % g.route.length;
            }
            break;
        }

        case 'suspect': {
            // Дошёл — озирается, потом возвращается на маршрут. Ровно
            // столько ума, сколько нужно, чтобы отвлечение работало.
            g.suspectT -= dt;
            const at = g.suspect ?? g.home;
            const arrived = goTo(g, ctx, at.x, at.y, GUARD.suspectSpeed * mulSpeed, dt);
            if (arrived) {
                if (!g.arrivedAt) { g.arrivedAt = true; g.baseAngle = g.angle; g.lookPhase = 0; }
                wantAngle = sweep(g, dt);
            }
            if (g.suspectT <= 0) {
                g.state = alarm.state === SEARCH ? 'search' : 'patrol';
                g.suspect = null;
                g.arrivedAt = false;
                bark(g, 'Ничего.');
            }
            break;
        }

        case 'chase': {
            if (sees) g.lastSeen = { x: player.x, y: player.y };
            const point = (rules.backup === false ? g.lastSeen : alarm.point)
                ?? g.lastSeen ?? { x: player.x, y: player.y };
            const shootable = sees && dist < GUARD.shootRange;

            if (shootable) {
                wantAngle = Math.atan2(player.y - g.y, player.x - g.x);
                if (dist < GUARD.keepDistance) {
                    // Стрелок держит дистанцию: он не набегает на нож.
                    steer(g, g.x - player.x, g.y - player.y, GUARD.patrolSpeed, dt);
                } else brake(g, dt);

                if (g.shootCd <= 0 && rules.shoot !== false) {
                    g.aim += dt;
                    if (g.aim >= GUARD.aimTime) {
                        ctx.shoot(g, wantAngle);
                        g.aim = 0;
                        g.shootCd = GUARD.shootCooldown;
                    }
                }
            } else {
                g.aim = Math.max(0, g.aim - dt * 2);
                goTo(g, ctx, point.x, point.y, GUARD.chaseSpeed * mulSpeed, dt);
            }
            // Без подмоги погоня заканчивается сама: потерял — вернулся.
            if (rules.backup === false) {
                g.memoryLeft = sees ? memory : (g.memoryLeft ?? memory) - dt;
                if (g.memoryLeft <= 0) { g.state = 'patrol'; bark(g, 'Показалось.'); }
            }
            break;
        }

        case 'search': {
            // Прочёсывание: каждый берёт свою точку рядом с последним
            // известным местом, поэтому район закрывают, а не толпятся.
            g.searchT -= dt;
            if (!g.searchSpot || g.searchT <= 0) {
                const base = ctx.alarm.point ?? g.home;
                const a = (g.spread ?? (g.spread = Math.random() * Math.PI * 2)) + g.searchT;
                const rad = 40 + Math.random() * 110;
                g.searchSpot = { x: base.x + Math.cos(a) * rad, y: base.y + Math.sin(a) * rad };
                g.searchT = 2.6 + Math.random() * 1.6;
                g.spread += 1.9;
            }
            const arrived = goTo(g, ctx, g.searchSpot.x, g.searchSpot.y, GUARD.suspectSpeed * mulSpeed, dt);
            if (arrived) wantAngle = sweep(g, dt);
            break;
        }

        default:
            break;
    }

    if (moving && g.state !== 'chase') wantAngle = Math.atan2(g.vy, g.vx);
    else if (moving && g.state === 'chase' && !sees) wantAngle = Math.atan2(g.vy, g.vx);

    g.angle = turnToward(g.angle, normalizeAngle(wantAngle), GUARD.turnRate * (rules.turn ?? 1), dt);
    brake(g, dt * 0.35);
    moveCircle(level, g, g.vx * dt, g.vy * dt);
}

/** Стоит ли игрок за спиной — условие снятия. */
export function isBehind(g, x, y) {
    const toPlayer = Math.atan2(y - g.y, x - g.x);
    return Math.abs(normalizeAngle(toPlayer - g.angle)) > PLAYER.behind;
}
