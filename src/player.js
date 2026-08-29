/**
 * Герой. Три скорости, и каждая — торг, а не удобство.
 *
 * Крадущийся шаг ровно беззвучен. Не «тише», а ноль: механика, которая
 * иногда подводит, перестаёт быть решением и становится лотереей. Игрок
 * должен иметь право сказать «меня точно не услышат» — и платить за это
 * половиной скорости.
 */

import { PLAYER, NOISE, BOX } from './tuning.js';
import { moveCircle, surfaceAt } from './level.js';

export function createPlayer(spawn) {
    return {
        x: spawn.x,
        y: spawn.y,
        vx: 0,
        vy: 0,
        r: PLAYER.radius,
        angle: -Math.PI / 2,
        hp: PLAYER.hp,
        invuln: 0,
        dead: false,
        /** Освещённость и трава считаются миром — их спрашивают все стражи. */
        lit: 0,
        grass: false,
        /** Тело на плече: вдвое медленнее и уже не побегаешь. */
        dragging: null,
        noiseT: 0,
        mode: 'walk',
        speed: 0,
        /** В коробке и стоя — тебя не видят вовсе. Считает мир. */
        hidden: false,
    };
}

export function playerSpeed(p, input) {
    if (input.box) return BOX.speed;
    if (input.creep) return PLAYER.creepSpeed;
    if (input.run && !p.dragging) return PLAYER.runSpeed;
    return PLAYER.walkSpeed;
}

export function noiseOf(p, input) {
    if (input.creep || input.box) return NOISE.creep;
    if (input.run && !p.dragging) return NOISE.run;
    return NOISE.walk;
}

/**
 * Шаг героя. Возвращает шум, который надо издать на этом кадре, или 0 —
 * мир сам решит, кому его слышать.
 */
export function updatePlayer(p, level, input, dt) {
    if (p.dead) return 0;

    p.invuln = Math.max(0, p.invuln - dt);

    let speed = playerSpeed(p, input);
    if (p.dragging) speed *= PLAYER.dragSpeed;
    p.mode = input.box ? 'box' : (input.creep ? 'creep' : (input.run && !p.dragging ? 'run' : 'walk'));

    const len = Math.hypot(input.ax, input.ay);
    if (len > 0.01) {
        const nx = input.ax / len;
        const ny = input.ay / len;
        p.vx += nx * PLAYER.accel * dt;
        p.vy += ny * PLAYER.accel * dt;
    }

    const s = Math.hypot(p.vx, p.vy);
    if (s > speed) {
        p.vx = (p.vx / s) * speed;
        p.vy = (p.vy / s) * speed;
    }
    if (len <= 0.01) {
        const f = PLAYER.friction * dt;
        if (s <= f) { p.vx = 0; p.vy = 0; }
        else { p.vx -= (p.vx / s) * f; p.vy -= (p.vy / s) * f; }
    }

    if (input.aimAngle !== null && input.aimAngle !== undefined) p.angle = input.aimAngle;
    else if (Math.hypot(p.vx, p.vy) > 14) p.angle = Math.atan2(p.vy, p.vx);

    moveCircle(level, p, p.vx * dt, p.vy * dt);
    p.speed = Math.hypot(p.vx, p.vy);

    // Шум отмечается не каждый кадр, а раз в интервал: иначе мир звенит
    // кольцами на каждом шаге и перестаёт читаться.
    //
    // Поверхность множит шаг и бег, но не крадущийся шаг: тот ноль на
    // любой земле. Поэтому по гравию ходить нельзя — по нему можно только
    // красться, и это осознанный выбор игрока, а не подстава.
    const radius = noiseOf(p, input) * surfaceAt(level, p.x, p.y);
    if (p.speed < 20 || radius <= 0) {
        p.noiseT = 0;
        return 0;
    }
    p.noiseT -= dt;
    if (p.noiseT > 0) return 0;
    p.noiseT = NOISE.interval;
    return radius;
}

export function hurtPlayer(p, damage = 1) {
    if (p.invuln > 0 || p.dead) return false;
    p.hp -= damage;
    p.invuln = PLAYER.invuln;
    if (p.hp <= 0) {
        p.hp = 0;
        p.dead = true;
        p.dragging = null;
    }
    return true;
}
