import test from 'node:test';
import assert from 'node:assert/strict';

import { room, px } from './helpers.mjs';
import { createWorld, updateWorld, tryTakedown, toggleCarry, firePistol, rankOf, fatesOf } from '../src/world.js';
import { GUARD, PLAYER } from '../src/tuning.js';
import { SEARCH, ALERT } from '../src/alarm.js';

const idle = { ax: 0, ay: 0, creep: true, run: false, aimAngle: null };

const def = (over = {}) => ({
    name: 'тест',
    map: room(30, 14, [{ x: 28, y: 7, ch: 'X' }]),
    spawn: { x: 2, y: 7 },
    exit: { x: 28, y: 7 },
    lights: [],
    // Свет проверяется отдельно; здесь он не должен мешать смотреть.
    ambient: 1,
    guards: [{ at: { x: 15, y: 7 }, angle: 0, route: [{ x: 15, y: 7, wait: 99 }] }],
    ...over,
});

/** Поставить игрока вплотную к стражу с нужной стороны. */
function stand(world, side) {
    const g = world.guards[0];
    world.player.x = g.x + side * 16;
    world.player.y = g.y;
}

test('снять можно только со спины — в этом весь смысл конуса', () => {
    const world = createWorld(def());
    stand(world, 1); // страж смотрит вправо, игрок перед ним
    assert.equal(tryTakedown(world, false), false, 'в лицо не снимают');

    stand(world, -1);
    assert.equal(tryTakedown(world, false), true, 'со спины — снимают');
    assert.equal(world.guards[0].down, true);
    assert.equal(world.guards[0].dead, false, 'удушение не убивает');
});

test('снятие отменяет бой, а не выигрывает его: тревоги нет', () => {
    const world = createWorld(def());
    stand(world, -1);
    tryTakedown(world, false);
    for (let i = 0; i < 60; i += 1) updateWorld(world, idle, 1 / 60);
    assert.equal(world.alarm.everSpotted, false);
    assert.equal(world.alarm.state, 'calm');
});

test('оглушённый очнётся и поднимет поиск, если его не спрятать', () => {
    const world = createWorld(def());
    stand(world, -1);
    tryTakedown(world, false);
    world.player.x = px(2);

    for (let i = 0; i < (GUARD.wakeTime + 1) * 60; i += 1) updateWorld(world, idle, 1 / 60);
    assert.equal(world.guards[0].down, false, 'очнулся');
    assert.equal(world.alarm.state, SEARCH, 'и поднял тревогу');
});

test('спрятанное тело не находят и оно не очнётся', () => {
    const world = createWorld(def({
        map: room(30, 14, [{ x: 28, y: 7, ch: 'X' }, { x: 10, y: 5, ch: '=' }]),
    }));
    stand(world, -1);
    tryTakedown(world, false);
    assert.equal(toggleCarry(world), true, 'взял на плечо');

    // Дотащить до ящика и бросить.
    world.player.x = px(10);
    world.player.y = px(7);
    world.player.angle = Math.PI / 2;
    updateWorld(world, idle, 1 / 60);
    assert.equal(toggleCarry(world), true, 'бросил');
    assert.equal(world.guards[0].stowed, true, 'у ящика — значит спрятано');

    for (let i = 0; i < (GUARD.wakeTime + 2) * 60; i += 1) updateWorld(world, idle, 1 / 60);
    assert.equal(world.guards[0].down, true, 'так и не очнулся');
    assert.equal(world.alarm.state, 'calm');
});

test('страж, увидевший тело, поднимает ПОИСК, а не ТРЕВОГУ', () => {
    const world = createWorld(def({
        guards: [
            { at: { x: 15, y: 7 }, angle: 0, route: [{ x: 15, y: 7, wait: 99 }] },
            { at: { x: 10, y: 7 }, angle: 0, route: [{ x: 10, y: 7, wait: 99 }] },
        ],
    }));
    // Второй смотрит вправо — прямо на первого.
    stand(world, -1);
    tryTakedown(world, true);
    world.player.x = px(2);
    world.player.y = px(12);

    for (let i = 0; i < 60; i += 1) updateWorld(world, idle, 1 / 60);
    assert.equal(world.alarm.state, SEARCH);
    assert.equal(world.alarm.everSpotted, false, 'самого игрока не видели');
});

test('выстрел слышит весь объект', () => {
    const world = createWorld(def());
    world.player.angle = -Math.PI / 2;
    assert.equal(firePistol(world), true);
    assert.equal(world.alarm.state, SEARCH);
    assert.equal(world.ammo, 5);
});

test('ранг молчит про убийства — это и есть замысел', () => {
    const clean = createWorld(def());
    assert.equal(rankOf(clean).rank, 'S');

    // Тихо снял двоих насмерть и никем не замечен — ранг тот же. Игра,
    // которая ставит оценку за трупы, читает мораль вперёд игрока; тогда
    // вспоминать в конце уже нечего.
    const bloody = createWorld(def());
    stand(bloody, -1);
    tryTakedown(bloody, true);
    assert.equal(rankOf(bloody).rank, 'S', 'ни слова про убитых');
    assert.equal(rankOf(bloody).text.includes('убит'), false);
});

test('судьбы стражей считаются отдельно и по именам', () => {
    const world = createWorld(def());
    stand(world, -1);
    tryTakedown(world, true);
    const fates = fatesOf(world);
    assert.equal(fates.length, 1);
    assert.equal(fates[0].fate, 'killed');

    const spared = createWorld(def());
    assert.equal(fatesOf(spared)[0].fate, 'spared');
});

test('дошёл до ворот — уровень сдан', () => {
    const world = createWorld(def({ guards: [] }));
    world.player.x = px(28);
    world.player.y = px(7);
    updateWorld(world, idle, 1 / 60);
    assert.equal(world.done, 'win');
});
