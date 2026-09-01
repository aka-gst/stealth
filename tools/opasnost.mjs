/**
 * Опасность места: через сколько секунд сюда посмотрит чужой глаз.
 *
 * Число, которого у нас не было. Решение автора от 1 сентября: «это и есть
 * механика, но в некоторых местах будут быстро палить тело если не спрячешь
 * его». То есть цена оставленного тела — свойство **места**, а не общее
 * число укрытий на карте, и назначать её надо по замеру, а не на глаз.
 *
 * Меряется именно взгляд, а не проход: тело находят конусом, через canSee,
 * со светом и травой. Клетка у самой тропы, но за ящиком, безопаснее
 * дальней, но открытой, — и глазами этого не видно.
 *
 * Проверено отрицательным контролем, и он опроверг первую догадку. Увидев
 * на четырёх уровнях охват 4–8%, я решил, что стражи там застыли: осмотр по
 * сторонам включается флагом `look`, а у рукописных маршрутов он не задан.
 * Прогнал те же уровни с принудительным осмотром — 8→10%, 4→4%, 7→16%,
 * 6→6%. Догадка неверна.
 *
 * Настоящая причина проще и её не починить флагом: **один стоящий страж с
 * конусом в полсотни градусов и дальностью в семь клеток физически не
 * накрывает комнату**. Это геометрия, а не поведение. Осмотр по сторонам
 * добавляет проценты, а не разы.
 *
 *   node tools/opasnost.mjs [секунды]
 */
import { LEVELS } from '../src/levels.js';
import { createWorld, updateWorld } from '../src/world.js';
import { tileAt, hidesAt, WALL, CRATE } from '../src/level.js';
import { canSee } from '../src/vision.js';
import { illumination } from '../src/light.js';
import { TILE } from '../src/tuning.js';
import { isOut } from '../src/guard.js';

const STEP = 1 / 60;
const SPAN = Number(process.argv[2] ?? 180);
const IDLE = { ax: 0, ay: 0, creep: true, run: false, aimAngle: null };

for (const level of LEVELS) {
    const w = createWorld(level);
    if (!w.guards.length) { console.log(`\n${level.name}: стражей нет — прятать не от кого`); continue; }
    // Игрока убираем с доски: меряем маршруты стражей, а не погоню.
    w.player.x = -1000;
    w.player.y = -1000;

    const spots = [];
    for (let y = 0; y < w.level.h; y += 1) {
        for (let x = 0; x < w.level.w; x += 1) {
            const px = (x + 0.5) * TILE;
            const py = (y + 0.5) * TILE;
            const t = tileAt(w.level, px, py);
            if (t === WALL || t === CRATE) continue;
            spots.push({ x: px, y: py, seen: null });
        }
    }

    let t = 0;
    let left = spots.length;
    while (t < SPAN) {
        updateWorld(w, IDLE, STEP);
        t += STEP;
        if (!left) break;
        // Раз в пятую секунды — так же часто, как игра сама обходит тела.
        if (Math.round(t / STEP) % 12) continue;
        for (const s of spots) {
            if (s.seen !== null) continue;
            const target = { x: s.x, y: s.y, lit: illumination(w.level, w.lights, s.x, s.y), grass: hidesAt(w.level, s.x, s.y) };
            for (const g of w.guards) {
                if (isOut(g)) continue;
                if (!canSee(w.level, g, target)) continue;
                s.seen = t;
                left -= 1;
                break;
            }
        }
    }

    const seen = spots.filter((s) => s.seen !== null).map((s) => s.seen).sort((a, b) => a - b);
    const never = spots.length - seen.length;
    const pick = (q) => (seen.length ? seen[Math.floor((seen.length - 1) * q)].toFixed(1) : '—');
    const fast = seen.filter((v) => v <= 10).length;
    console.log(`\n${level.name}`);
    console.log(`  клеток ${spots.length}` +
        `  просмотрено ${seen.length} (${Math.round((seen.length / spots.length) * 100)}%)` +
        `  ни разу ${never} (${Math.round((never / spots.length) * 100)}%)`);
    console.log(`  до первого взгляда: медиана ${pick(0.5)} с` +
        `, четверть быстрее ${pick(0.25)} с` +
        `, три четверти быстрее ${pick(0.75)} с`);
    console.log(`  горячих (взгляд за 10 с): ${fast} — ${Math.round((fast / spots.length) * 100)}% карты`);
}
