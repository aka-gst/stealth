import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('съёмочный режим держит 16:9 и не схлопывается под мобильным max-height', async () => {
    const css = await readFile(new URL('../styles/game.css', import.meta.url), 'utf8');
    assert.match(css, /body\.capture #stage\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9;[^}]*max-height:\s*100svh;/s,
        'кадр 270×185 должен занимать видимую высоту, а не наследовать лимит управления');
});
