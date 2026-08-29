import test from 'node:test';
import assert from 'node:assert/strict';

import { createAlarm, spotted, disturb, updateAlarm, CALM, ALERT, SEARCH, CAUTION } from '../src/alarm.js';
import { ALARM, GUARD } from '../src/tuning.js';

const run = (alarm, seconds, step = 1 / 60) => {
    for (let t = 0; t < seconds; t += step) updateAlarm(alarm, step);
};

test('тревога распадается ступенями, а не выключается сразу', () => {
    const a = createAlarm();
    spotted(a, 100, 100);
    assert.equal(a.state, ALERT);

    run(a, GUARD.memory + 0.2);
    assert.equal(a.state, SEARCH, 'потеряли — ищут');

    run(a, ALARM.searchTime + 0.2);
    assert.equal(a.state, CAUTION, 'не нашли — вернулись на маршруты настороже');

    run(a, ALARM.cautionTime + 0.2);
    assert.equal(a.state, CALM, 'отбой');
});

test('найденное тело поднимает ПОИСК, а не ТРЕВОГУ', () => {
    const a = createAlarm();
    disturb(a, 50, 50);
    assert.equal(a.state, SEARCH, 'знают, что чужой есть, но не знают где');
    assert.equal(a.everSpotted, false, 'а самого игрока так и не видели');
});

test('находка не сбивает уже идущую тревогу на ступень вниз', () => {
    const a = createAlarm();
    spotted(a, 10, 10);
    disturb(a, 400, 400);
    assert.equal(a.state, ALERT);
    assert.deepEqual(a.point, { x: 10, y: 10 }, 'идут туда, где видели игрока');
});

test('пока видят — тревога не начинает распадаться', () => {
    const a = createAlarm();
    for (let i = 0; i < 600; i += 1) {
        spotted(a, 10, 10);
        updateAlarm(a, 1 / 60);
    }
    assert.equal(a.state, ALERT);
});
