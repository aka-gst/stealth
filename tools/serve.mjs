/**
 * Статический сервер для разработки. Нужен только потому, что игра собрана
 * из ES-модулей, а их браузер с file:// не грузит.
 *
 * Кэш запрещён намеренно: правка в src/ должна доезжать до вкладки сразу,
 * иначе полдня уходит на отладку уже исправленного.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.PORT ?? 4191);
/** Сколько соседних портов пробовать, если свой занят. */
const TRIES = 20;
const ROOT = new URL('..', import.meta.url).pathname;

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    const path = join(ROOT, rel === '/' ? 'index.html' : rel);

    try {
        const body = await readFile(path);
        res.writeHead(200, {
            'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
            'cache-control': 'no-store',
        });
        res.end(body);
    } catch {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('нет такого файла');
    }
});

/*
 * Порт может быть занят соседним проектом — их тут много, и все на
 * четырёхтысячных. Падать из-за этого глупо: берём следующий свободный и
 * говорим, какой взяли.
 */
let port = PORT;
server.on('error', (err) => {
    if (err.code !== 'EADDRINUSE' || port >= PORT + TRIES) {
        console.error(err.message);
        process.exit(1);
    }
    port += 1;
    server.listen(port);
});
server.on('listening', () => console.log(`ПЕРИМЕТР: http://localhost:${port}/`));
server.listen(port);
