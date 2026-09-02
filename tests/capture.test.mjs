import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let capture = {};
try { capture = await import('../src/capture.js'); } catch { /* красный этап: модуля ещё нет */ }

test('кадр=1 запускает одну крупную сцену и не трогает сохранение или аналитику', () => {
    const calls = [];
    const started = capture.startShot?.({
        search: '?кадр=1&тихо=1',
        hideHud: () => calls.push(['hud']),
        freezeInput: () => calls.push(['input']),
        scene: (opts) => calls.push(['scene', opts]),
        persist: () => calls.push(['storage']),
        track: () => calls.push(['analytics']),
    });

    assert.equal(started, true, 'съёмочный URL должен включать режим кадра');
    assert.deepEqual(calls, [
        ['hud'],
        ['input'],
        ['scene', { close: true, scale: 3.2 }],
    ], 'сцена запускается ровно раз после подготовки и без внешних следов');
});

test('обычный URL не включает режим кадра и не скрывает HUD', () => {
    const calls = [];
    const started = capture.startShot?.({
        search: '?тихо=1',
        hideHud: () => calls.push('hud'),
        freezeInput: () => calls.push('input'),
        scene: () => calls.push('scene'),
    });

    assert.equal(started, false);
    assert.deepEqual(calls, []);
});

test('тихий съёмочный режим не создаёт и не возобновляет AudioContext', async () => {
    const { createAudio } = await import('../src/audio.js');
    const previous = globalThis.window;
    const previousFetch = globalThis.fetch;
    let created = 0;
    let resumed = 0;
    globalThis.window = {
        AudioContext: class {
            constructor() { created += 1; this.state = 'suspended'; this.destination = {}; }
            createGain() { return { gain: { value: 0 }, connect() {} }; }
            createAnalyser() { return { fftSize: 0, connect() {} }; }
            resume() { resumed += 1; }
        },
    };
    globalThis.fetch = () => new Promise(() => {});
    try {
        createAudio({ disabled: true }).ensure();
    } finally {
        globalThis.window = previous;
        globalThis.fetch = previousFetch;
    }
    assert.equal(created, 0);
    assert.equal(resumed, 0);
});

test('съёмочный URL не загружает аналитику, а main подключает контроллер кадра', async () => {
    const [html, main] = await Promise.all([
        readFile(new URL('../index.html', import.meta.url), 'utf8'),
        readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
    ]);
    assert.doesNotMatch(html, /<script defer src="\/pulse\/script\.js"/,
        'счётчик нельзя загрузить до того, как адрес успеет отключить его');
    assert.match(html, /URLSearchParams\(location\.search\)\.get\('кадр'\) !== '1'/,
        'обычная страница подключает счётчик, съёмочная — нет');
    assert.match(main, /startShot\(\{[\s\S]*scene:/,
        'после инициализации мира main запускает публичную сцену через контроллер');
});
