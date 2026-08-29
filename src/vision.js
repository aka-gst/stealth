/**
 * Зрение стража. Конус, а не круг, — и это первый кирпич, без которого
 * не стоит ничего остальное.
 *
 * Пока зрение было кругом, страж разворачивался к игроку в тот же кадр,
 * когда тот входил в радиус: «сзади» не существовало как положения, а
 * значит, не существовало ни захода со спины, ни снятия, ни половины
 * маршрутов. Это делается первым, иначе переделывать придётся всё.
 */

import { GUARD, LIGHT } from './tuning.js';
import { rayBlocked, rayReach } from './level.js';

export function normalizeAngle(a) {
    let v = a;
    while (v > Math.PI) v -= Math.PI * 2;
    while (v < -Math.PI) v += Math.PI * 2;
    return v;
}

export const angleDiff = (a, b) => normalizeAngle(a - b);

/** Поворот головы с ограниченной скоростью: мгновенных разворотов нет. */
export function turnToward(current, wanted, rate, dt) {
    const d = angleDiff(wanted, current);
    const max = rate * dt;
    if (Math.abs(d) <= max) return normalizeAngle(wanted);
    return normalizeAngle(current + Math.sign(d) * max);
}

/**
 * Дальность взгляда с поправкой на свет. Под фонарём — полная, в темноте
 * остаётся доля `darkSight`: 28 пикселей от 190, то есть вплотную.
 */
export function sightReach(lit = 1, sightMul = 1) {
    return GUARD.sight * sightMul * (LIGHT.darkSight + (1 - LIGHT.darkSight) * lit);
}

/** На каком расстоянии замечают спиной. Во тьме — почти на ощупь. */
export function feelReach(lit = 1) {
    return GUARD.feel * (LIGHT.feelDark + (1 - LIGHT.feelDark) * lit);
}

/**
 * Видит ли страж цель. `target` — это `{x, y, lit, grass}`: освещённость и
 * трава считаются снаружи, потому что они одинаковы для всех стражей и
 * пересчитывать их на каждого — впустую.
 */
export function canSee(level, g, target, sightMul = 1) {
    const lit = target.lit ?? 1;
    const dx = target.x - g.x;
    const dy = target.y - g.y;
    const dist = Math.hypot(dx, dy);

    let feel = feelReach(lit) * (target.expose ?? 1);
    if (target.grass) feel *= 0.6;
    if (dist <= feel) return !rayBlocked(level, g.x, g.y, target.x, target.y);

    let reach = sightReach(lit, sightMul) * (target.expose ?? 1);
    if (target.grass) reach *= GUARD.grassSight;
    if (dist > reach) return false;

    if (Math.abs(angleDiff(Math.atan2(dy, dx), g.angle)) > GUARD.half) return false;

    // Сквозь стену не видят. Из-за этого геометрия уровня работает на
    // стелс: угол здания становится укрытием, а не просто препятствием.
    return !rayBlocked(level, g.x, g.y, target.x, target.y);
}

/**
 * Многоугольник конуса для отрисовки: веер лучей, каждый укорочен о свою
 * стену.
 *
 * Рисуется ровно та область, которую проверяет код. Наказание, которого не
 * видно, читается игроком как случайность, а не как своя ошибка, — а
 * картинка, которая врёт о правиле, ещё хуже отсутствующей.
 */
export function coneShape(level, g, reach, rays = 15) {
    const points = [];
    for (let i = 0; i <= rays; i += 1) {
        const a = g.angle - GUARD.half + (GUARD.half * 2 * i) / rays;
        points.push({ a, d: rayReach(level, g.x, g.y, a, reach) });
    }
    return points;
}
