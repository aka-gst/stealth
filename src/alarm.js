/**
 * Тревога — общая на объект, и главное в ней распад.
 *
 * ТРЕВОГА — тебя видят, все идут на тебя.
 * ПОИСК — потеряли, но знают, что кто-то есть; прочёсывают район.
 * НАСТОРОЖЕ — вернулись на маршруты, но смотрят дальше и ходят быстрее.
 *
 * Без распада «пройти громко» перестаёт быть вариантом и становится
 * проигрышем: прятаться будет незачем, потому что ждать нечего. Именно
 * отбой превращает шум в решение, за которое платят временем.
 *
 * Разница между «видят» и «ищут» тоже принципиальна. Увидели тело — знают,
 * что чужой на объекте, но не знают где: это ПОИСК, а не ТРЕВОГА. Знать
 * позицию игрока можно только увидев его самого.
 */

import { ALARM, GUARD } from './tuning.js';

export const CALM = 'calm';
export const ALERT = 'alert';
export const SEARCH = 'search';
export const CAUTION = 'caution';

export const ALARM_NAMES = {
    [CALM]: 'тихо',
    [ALERT]: 'ТРЕВОГА',
    [SEARCH]: 'ПОИСК',
    [CAUTION]: 'НАСТОРОЖЕ',
};

export function createAlarm() {
    return {
        state: CALM,
        /** Сколько осталось до следующей ступени вниз. */
        t: 0,
        /** Последнее известное место чужого. Именно туда все и пойдут. */
        point: null,
        grace: 0,
        /** Замечали ли вообще хоть раз — для итогового ранга. */
        everSpotted: false,
        everAlarmed: false,
    };
}

/** Игрока видят. Точка — где он прямо сейчас. */
export function spotted(alarm, x, y) {
    alarm.state = ALERT;
    alarm.point = { x, y };
    alarm.grace = GUARD.memory;
    alarm.everSpotted = true;
    alarm.everAlarmed = true;
}

/**
 * Что-то нашли: тело, выстрел, разбитую лампу. Знают, что чужой есть, но
 * не знают, где он.
 */
export function disturb(alarm, x, y, scale = 1) {
    if (alarm.state === ALERT) return;
    alarm.state = SEARCH;
    alarm.t = ALARM.searchTime * scale;
    alarm.point = { x, y };
    alarm.everAlarmed = true;
}

export function updateAlarm(alarm, dt, scale = 1) {
    switch (alarm.state) {
        case ALERT:
            alarm.grace -= dt;
            if (alarm.grace <= 0) {
                alarm.state = SEARCH;
                alarm.t = ALARM.searchTime * scale;
            }
            break;
        case SEARCH:
            alarm.t -= dt;
            if (alarm.t <= 0) {
                alarm.state = CAUTION;
                alarm.t = ALARM.cautionTime * scale;
            }
            break;
        case CAUTION:
            alarm.t -= dt;
            if (alarm.t <= 0) {
                alarm.state = CALM;
                alarm.point = null;
            }
            break;
        default:
            break;
    }
}

/** Настороженный страж смотрит дальше и ходит быстрее. */
export const sightMul = (alarm) => (alarm.state === CALM ? 1 : ALARM.cautionSight);
export const speedMul = (alarm) => (alarm.state === CALM ? 1 : ALARM.cautionSpeed);
