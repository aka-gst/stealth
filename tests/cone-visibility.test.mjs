import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/render.js', import.meta.url), 'utf8');

function alpha(table, mood) {
    const block = source.match(new RegExp(`const ${table} = \\{([\\s\\S]*?)\\n\\};`))?.[1] ?? '';
    const value = block.match(new RegExp(`${mood}: 'rgba\\([^,]+,[^,]+,[^,]+, ([0-9.]+)\\)'`))?.[1];
    return Number(value);
}

const fill = Object.fromEntries(['calm', 'suspect', 'alert'].map((mood) => [mood, alpha('MOOD_CONE', mood)]));
const edge = Object.fromEntries(['calm', 'suspect', 'alert'].map((mood) => [mood, alpha('MOOD_EDGE', mood)]));

assert.ok(fill.calm <= 0.08, `спокойный конус должен быть еле заметным, сейчас ${fill.calm}`);
assert.ok(fill.alert <= 0.14, `тревожный конус не должен закрашивать комнату, сейчас ${fill.alert}`);
assert.ok(fill.calm < fill.suspect && fill.suspect < fill.alert, 'заливка должна сохранять calm < suspect < alert');
assert.ok(edge.calm <= 0.14, `граница спокойного конуса должна быть вторым взглядом, сейчас ${edge.calm}`);
assert.ok(edge.alert <= 0.26, `граница тревожного конуса не должна перекрывать помещение, сейчас ${edge.alert}`);
assert.ok(edge.calm < edge.suspect && edge.suspect < edge.alert, 'граница должна сохранять calm < suspect < alert');

console.log('cone visual contract: ok');
