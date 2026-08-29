/**
 * Отрисовка.
 *
 * Главное правило файла: наказание, которого не видно, читается игроком
 * как случайность, а не как своя ошибка. Слух стражей невидим по природе,
 * освещённость на глаз отличается плохо, конус зрения не существует в
 * природе вовсе — значит, всё это надо нарисовать.
 *
 * И нарисовать ровно то, что считает код. Картинка, которая врёт о
 * правиле, хуже отсутствующей: игрок построит по ней маршрут и не поймёт,
 * почему его увидели. Поэтому и конус, и световое пятно собираются теми же
 * лучами, которыми проверяются, и укорачиваются о те же стены.
 */

import { TILE, VIEW, GUARD, LIGHT, PLAYER } from './tuning.js';
import { WALL, CRATE, GRASS, EXIT, tileAt } from './level.js';
import { coneShape, sightReach } from './vision.js';
import { lightShape, lightOn } from './light.js';
import { moodOf, isOut } from './guard.js';
import { ALARM_NAMES, CALM, ALERT, SEARCH, CAUTION, sightMul } from './alarm.js';
import { rankOf, gateOpen } from './world.js';

const COL = {
    floor: '#2a2d35',
    floorAlt: '#24272f',
    wall: '#464c59',
    wallTop: '#5b6272',
    crate: '#6b5533',
    crateTop: '#8a6f45',
    grass: '#22331f',
    grassTip: '#3d5a35',
    exit: '#3ba55d',
    player: '#d8e4f0',
    guard: '#c8ccd4',
    guardDown: '#7c8494',
    guardDead: '#8a3b3b',
};

const MOOD_CONE = {
    calm: 'rgba(150, 190, 255, 0.13)',
    suspect: 'rgba(255, 206, 92, 0.20)',
    alert: 'rgba(255, 86, 86, 0.24)',
};

const MOOD_EDGE = {
    calm: 'rgba(150, 190, 255, 0.30)',
    suspect: 'rgba(255, 206, 92, 0.45)',
    alert: 'rgba(255, 86, 86, 0.55)',
};

export function createRenderer(canvas) {
    const ctx = canvas.getContext('2d');
    const shade = document.createElement('canvas');
    const shadeCtx = shade.getContext('2d');
    return { canvas, ctx, shade, shadeCtx, dpr: 1, cam: { x: 0, y: 0 } };
}

/** Вернуть матрицу к «логический пиксель кадра», не потеряв плотность экрана. */
const reset = (r) => r.ctx.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);

function camera(r, world) {
    const p = world.player;
    const halfW = VIEW.w / 2;
    const halfH = VIEW.h / 2;
    let x = p.x - halfW;
    let y = p.y - halfH;
    x = Math.max(0, Math.min(world.level.pixelW - VIEW.w, x));
    y = Math.max(0, Math.min(world.level.pixelH - VIEW.h, y));
    // Уровень уже кадра — центрируем, чтобы не липнуть к краю.
    if (world.level.pixelW < VIEW.w) x = (world.level.pixelW - VIEW.w) / 2;
    if (world.level.pixelH < VIEW.h) y = (world.level.pixelH - VIEW.h) / 2;
    r.cam.x = Math.round(x);
    r.cam.y = Math.round(y);
}

export function draw(r, world) {
    const { ctx } = r;
    camera(r, world);

    reset(r);
    ctx.fillStyle = '#0b0d13';
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    ctx.save();
    ctx.translate(-r.cam.x, -r.cam.y);

    drawFloor(ctx, world, r.cam);
    drawWalls(ctx, world, r.cam);
    ctx.restore();

    drawDarkness(r, world);

    ctx.save();
    ctx.translate(-r.cam.x, -r.cam.y);
    drawOutlines(ctx, world, r.cam);
    drawCones(ctx, world);
    drawNoises(ctx, world);
    drawLastKnown(ctx, world);
    drawGoal(ctx, world);
    drawCoins(ctx, world);
    drawGuards(ctx, world);
    drawPlayer(ctx, world);
    drawBullets(ctx, world);
    drawMarks(ctx, world);
    ctx.restore();

    drawObjective(r, world);
    drawHud(r, world);
    if (world.done) drawEnd(r, world);
}

function tilesInView(cam) {
    return {
        x0: Math.max(0, Math.floor(cam.x / TILE)),
        y0: Math.max(0, Math.floor(cam.y / TILE)),
        x1: Math.ceil((cam.x + VIEW.w) / TILE),
        y1: Math.ceil((cam.y + VIEW.h) / TILE),
    };
}

function drawFloor(ctx, world, cam) {
    const { level } = world;
    const { x0, y0, x1, y1 } = tilesInView(cam);
    for (let ty = y0; ty < Math.min(level.h, y1); ty += 1) {
        for (let tx = x0; tx < Math.min(level.w, x1); tx += 1) {
            const t = level.tiles[ty * level.w + tx];
            const x = tx * TILE;
            const y = ty * TILE;
            if (t === WALL) continue;

            ctx.fillStyle = (tx + ty) % 2 === 0 ? COL.floor : COL.floorAlt;
            ctx.fillRect(x, y, TILE, TILE);

            if (t === GRASS) {
                ctx.fillStyle = COL.grass;
                ctx.fillRect(x, y, TILE, TILE);
                ctx.strokeStyle = COL.grassTip;
                ctx.lineWidth = 1;
                ctx.beginPath();
                for (let i = 0; i < 4; i += 1) {
                    const gx = x + 3 + i * 6 + ((tx * 7 + ty * 3 + i) % 3);
                    const gy = y + 4 + ((tx * 5 + ty * 11 + i * 3) % 12);
                    ctx.moveTo(gx, gy + 7);
                    ctx.lineTo(gx + 1, gy);
                }
                ctx.stroke();
            } else if (t === EXIT) {
                // Запертые ворота видно сразу: игрок должен понимать, что
                // бежать туда сейчас бессмысленно, до того как побежал.
                const open = gateOpen(world);
                ctx.fillStyle = open ? 'rgba(59,165,93,0.28)' : 'rgba(190,60,60,0.30)';
                ctx.fillRect(x, y, TILE, TILE);
                ctx.strokeStyle = open ? COL.exit : '#c94f4f';
                ctx.setLineDash([4, 4]);
                ctx.lineWidth = 2;
                ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
                ctx.setLineDash([]);
            }
        }
    }
}

function drawWalls(ctx, world, cam) {
    const { level } = world;
    const { x0, y0, x1, y1 } = tilesInView(cam);
    for (let ty = y0; ty < Math.min(level.h, y1); ty += 1) {
        for (let tx = x0; tx < Math.min(level.w, x1); tx += 1) {
            const t = level.tiles[ty * level.w + tx];
            if (t !== WALL && t !== CRATE) continue;
            const x = tx * TILE;
            const y = ty * TILE;
            const below = tileAt(level, x + TILE / 2, y + TILE * 1.5);
            const solidBelow = below === WALL || below === CRATE;

            ctx.fillStyle = t === CRATE ? COL.crate : COL.wall;
            ctx.fillRect(x, y, TILE, TILE);
            // Верхняя грань светлее — так вид сверху перестаёт быть плоским
            // и видно, где стена, а где пол.
            ctx.fillStyle = t === CRATE ? COL.crateTop : COL.wallTop;
            ctx.fillRect(x, y, TILE, solidBelow ? TILE : TILE - 6);

            if (t === CRATE) {
                ctx.strokeStyle = 'rgba(0,0,0,0.35)';
                ctx.lineWidth = 1;
                ctx.strokeRect(x + 2.5, y + 2.5, TILE - 5, TILE - 5);
            }
        }
    }
}

/**
 * Тьма и световые пятна. Свет держится стенами — в отличие от шума, и
 * поэтому пятно строится теми же лучами, что и конус зрения.
 */
function drawDarkness(r, world) {
    const { ctx, shade, shadeCtx, cam } = r;
    if (shade.width !== VIEW.w || shade.height !== VIEW.h) {
        shade.width = VIEW.w;
        shade.height = VIEW.h;
    }

    shadeCtx.setTransform(1, 0, 0, 1, 0, 0);
    shadeCtx.globalCompositeOperation = 'source-over';
    shadeCtx.fillStyle = 'rgba(5,7,14,0.72)';
    shadeCtx.fillRect(0, 0, VIEW.w, VIEW.h);

    shadeCtx.save();
    shadeCtx.translate(-cam.x, -cam.y);
    shadeCtx.globalCompositeOperation = 'destination-out';
    for (const l of world.lights) {
        if (!lightOn(l)) continue;
        const pts = lightShape(world.level, l);
        shadeCtx.save();
        shadeCtx.beginPath();
        if (l.kind === 'beam') shadeCtx.moveTo(l.x, l.y);
        pts.forEach((p, i) => {
            const px = l.x + Math.cos(p.a) * p.d;
            const py = l.y + Math.sin(p.a) * p.d;
            if (i === 0 && l.kind !== 'beam') shadeCtx.moveTo(px, py);
            else shadeCtx.lineTo(px, py);
        });
        shadeCtx.closePath();
        shadeCtx.clip();
        const grad = shadeCtx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(0.55, 'rgba(0,0,0,0.85)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        shadeCtx.fillStyle = grad;
        shadeCtx.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
        shadeCtx.restore();
    }
    shadeCtx.restore();

    reset(r);
    ctx.drawImage(shade, 0, 0);

    // Тёплое свечение поверх: свет должен читаться как свет, а не как
    // «менее тёмное место».
    ctx.save();
    ctx.translate(-cam.x, -cam.y);
    ctx.globalCompositeOperation = 'lighter';
    for (const l of world.lights) {
        if (!lightOn(l)) continue;
        const pts = lightShape(world.level, l);
        ctx.save();
        ctx.beginPath();
        if (l.kind === 'beam') ctx.moveTo(l.x, l.y);
        pts.forEach((p, i) => {
            const px = l.x + Math.cos(p.a) * p.d;
            const py = l.y + Math.sin(p.a) * p.d;
            if (i === 0 && l.kind !== 'beam') ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.clip();
        const grad = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
        const warm = l.kind === 'beam' ? '110,130,150' : '150,120,60';
        grad.addColorStop(0, `rgba(${warm},0.30)`);
        grad.addColorStop(1, `rgba(${warm},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
        ctx.restore();
    }
    ctx.restore();

    // Разбитый фонарь остаётся тёмным кольцом: игрок должен помнить, где
    // он был, и что света здесь больше не будет.
    ctx.save();
    ctx.translate(-cam.x, -cam.y);
    for (const l of world.lights) {
        if (lightOn(l)) continue;
        ctx.strokeStyle = 'rgba(120,130,150,0.28)';
        ctx.setLineDash([3, 5]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(l.x, l.y, 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
    }
    ctx.restore();
}

/**
 * Контур стен поверх тьмы. Планировку объекта герой знает и без света —
 * он на неё и шёл; неизвестно ему, кто где стоит. Без этих линий тёмная
 * половина уровня читается как «тут ничего нет».
 */
function drawOutlines(ctx, world, cam) {
    const { level } = world;
    const { x0, y0, x1, y1 } = tilesInView(cam);
    ctx.strokeStyle = 'rgba(128,150,190,0.20)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let ty = y0; ty < Math.min(level.h, y1); ty += 1) {
        for (let tx = x0; tx < Math.min(level.w, x1); tx += 1) {
            const t = level.tiles[ty * level.w + tx];
            if (t !== WALL && t !== CRATE) continue;
            const x = tx * TILE;
            const y = ty * TILE;
            // Рисуем только внешние рёбра: внутренняя решётка не нужна.
            if (tileAt(level, x + TILE / 2, y - TILE / 2) === 0) { ctx.moveTo(x, y + 0.5); ctx.lineTo(x + TILE, y + 0.5); }
            if (tileAt(level, x + TILE / 2, y + TILE * 1.5) === 0) { ctx.moveTo(x, y + TILE - 0.5); ctx.lineTo(x + TILE, y + TILE - 0.5); }
            if (tileAt(level, x - TILE / 2, y + TILE / 2) === 0) { ctx.moveTo(x + 0.5, y); ctx.lineTo(x + 0.5, y + TILE); }
            if (tileAt(level, x + TILE * 1.5, y + TILE / 2) === 0) { ctx.moveTo(x + TILE - 0.5, y); ctx.lineTo(x + TILE - 0.5, y + TILE); }
        }
    }
    ctx.stroke();
}

function conePath(ctx, g, pts) {
    ctx.beginPath();
    ctx.moveTo(g.x, g.y);
    for (const p of pts) ctx.lineTo(g.x + Math.cos(p.a) * p.d, g.y + Math.sin(p.a) * p.d);
    ctx.closePath();
}

function drawCones(ctx, world) {
    const mul = sightMul(world.alarm);
    for (const g of world.guards) {
        if (isOut(g)) continue;
        const mood = moodOf(g);
        // Конус рисуется на ту дальность, на которой страж видит ИГРОКА —
        // то есть с поправкой на его свет. Так игрок видит, что тень его
        // укоротила, а не гадает об этом.
        const reach = sightReach(world.player.lit, mul);
        const pts = coneShape(world.level, g, reach);
        conePath(ctx, g, pts);
        ctx.fillStyle = MOOD_CONE[mood] ?? MOOD_CONE.calm;
        ctx.fill();
        ctx.strokeStyle = MOOD_EDGE[mood] ?? MOOD_EDGE.calm;
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

function drawNoises(ctx, world) {
    for (const n of world.noises) {
        const k = 1 - n.life / n.max;
        ctx.strokeStyle = `rgba(220,235,255,${0.34 * (1 - k)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius * (0.35 + 0.65 * k), 0, Math.PI * 2);
        ctx.stroke();
    }
}

/** Последнее известное место: туда пойдут искать. Игрок обязан это видеть. */
function drawLastKnown(ctx, world) {
    const a = world.alarm;
    if (!a.point || a.state === CALM) return;
    ctx.save();
    ctx.strokeStyle = a.state === ALERT ? 'rgba(255,90,90,0.7)' : 'rgba(255,200,90,0.55)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(a.point.x, a.point.y, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(a.point.x - 6, a.point.y - 6);
    ctx.lineTo(a.point.x + 6, a.point.y + 6);
    ctx.moveTo(a.point.x + 6, a.point.y - 6);
    ctx.lineTo(a.point.x - 6, a.point.y + 6);
    ctx.stroke();
    ctx.restore();
}

/** Кейс на полу и стрелка к текущей задаче: куда идти, игрок гадать не должен. */
function drawGoal(ctx, world) {
    const g = world.goal;
    if (!g || g.taken) return;
    ctx.fillStyle = '#d9c169';
    ctx.fillRect(g.x - 6, g.y - 4, 12, 9);
    ctx.strokeStyle = '#6b5a26';
    ctx.lineWidth = 1;
    ctx.strokeRect(g.x - 6.5, g.y - 4.5, 13, 10);
    ctx.fillStyle = '#8a7433';
    ctx.fillRect(g.x - 2, g.y - 6, 4, 2);
}

function drawObjective(r, world) {
    const { ctx } = r;
    const goal = world.goal && !world.goal.taken ? world.goal : world.level.exit;
    const p = world.player;
    const sx = goal.x - r.cam.x;
    const sy = goal.y - r.cam.y;
    if (sx > 12 && sy > 12 && sx < VIEW.w - 12 && sy < VIEW.h - 12) return;

    const a = Math.atan2(goal.y - p.y, goal.x - p.x);
    const cx = VIEW.w / 2 + Math.cos(a) * (VIEW.w / 2 - 26);
    const cy = VIEW.h / 2 + Math.sin(a) * (VIEW.h / 2 - 26);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.fillStyle = world.goal && !world.goal.taken ? 'rgba(217,193,105,0.55)' : 'rgba(140,224,168,0.55)';
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-6, 5);
    ctx.lineTo(-6, -5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function drawCoins(ctx, world) {
    for (const c of world.coins) {
        ctx.fillStyle = c.landed ? '#c8a33c' : '#e8cf6a';
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.landed ? 3 : 2.5, 0, Math.PI * 2);
        ctx.fill();
    }
}

function figure(ctx, x, y, angle, radius, body, edge) {
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Клин — это взгляд. Без него вид сверху не читается совсем.
    ctx.fillStyle = edge;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * (radius + 5), y + Math.sin(angle) * (radius + 5));
    ctx.lineTo(x + Math.cos(angle + 2.5) * radius * 0.8, y + Math.sin(angle + 2.5) * radius * 0.8);
    ctx.lineTo(x + Math.cos(angle - 2.5) * radius * 0.8, y + Math.sin(angle - 2.5) * radius * 0.8);
    ctx.closePath();
    ctx.fill();
}

function drawGuards(ctx, world) {
    for (const g of world.guards) {
        if (isOut(g)) {
            ctx.save();
            ctx.globalAlpha = g.stowed ? 0.35 : 1;
            ctx.fillStyle = g.dead ? COL.guardDead : COL.guardDown;
            ctx.beginPath();
            ctx.ellipse(g.x, g.y, GUARD.radius + 4, GUARD.radius - 1, g.angle, 0, Math.PI * 2);
            ctx.fill();
            if (g.stowed) {
                ctx.strokeStyle = 'rgba(120,200,140,0.7)';
                ctx.setLineDash([3, 3]);
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.setLineDash([]);
            }
            ctx.restore();
            continue;
        }
        figure(ctx, g.x, g.y, g.angle, GUARD.radius, COL.guard, '#5c6472');

        if (g.aim > 0.05) {
            // Замах видно: это приглашение уйти с линии, а не наказание.
            ctx.strokeStyle = `rgba(255,80,80,${0.25 + 0.5 * (g.aim / GUARD.aimTime)})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(g.x, g.y);
            ctx.lineTo(g.x + Math.cos(g.angle) * GUARD.shootRange, g.y + Math.sin(g.angle) * GUARD.shootRange);
            ctx.stroke();
        }
    }
}

function drawPlayer(ctx, world) {
    const p = world.player;
    if (p.dead) {
        ctx.fillStyle = '#8a3b3b';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, PLAYER.radius + 4, PLAYER.radius - 1, p.angle, 0, Math.PI * 2);
        ctx.fill();
        return;
    }
    // Герой в тени тускнеет, но не пропадает: ощущение даёт фигура, число
    // даёт прибор в углу экрана.
    const alpha = 0.55 + 0.45 * p.lit;
    ctx.save();
    ctx.globalAlpha = p.invuln > 0 && Math.floor(p.invuln * 12) % 2 ? 0.35 : alpha;
    figure(ctx, p.x, p.y, p.angle, PLAYER.radius, COL.player, '#71809a');
    ctx.restore();

    if (p.mode === 'creep') {
        ctx.strokeStyle = 'rgba(120,200,255,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, PLAYER.radius + 4, 0, Math.PI * 2);
        ctx.stroke();
    }
}

function drawBullets(ctx, world) {
    ctx.strokeStyle = '#ffd88a';
    ctx.lineWidth = 1.5;
    for (const b of world.bullets) {
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - b.vx * 0.012, b.y - b.vy * 0.012);
        ctx.stroke();
    }
}

function drawMarks(ctx, world) {
    ctx.textAlign = 'center';
    for (const g of world.guards) {
        if (isOut(g)) continue;
        if (g.mark) {
            ctx.font = 'bold 16px system-ui, sans-serif';
            ctx.fillStyle = g.mark === '!' ? '#ff5c5c' : '#ffce5c';
            ctx.fillText(g.mark, g.x, g.y - 16);
        }
        if (g.say) {
            ctx.font = '9px system-ui, sans-serif';
            ctx.fillStyle = 'rgba(220,228,240,0.75)';
            ctx.fillText(g.say, g.x, g.y - 28);
        }
    }
}

function drawHud(r, world) {
    const { ctx } = r;
    reset(r);
    const a = world.alarm;

    // Состояние тревоги и сколько ей осталось. Игрок должен видеть, что
    // ожидание работает, иначе он не станет ждать.
    const label = ALARM_NAMES[a.state];
    const colours = {
        [CALM]: '#5f6b7f',
        [ALERT]: '#ff5c5c',
        [SEARCH]: '#ffb44c',
        [CAUTION]: '#ffe08a',
    };
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = colours[a.state];
    ctx.fillText(label.toUpperCase(), 10, 18);
    if (a.state === SEARCH || a.state === CAUTION) {
        const total = a.state === SEARCH ? 20 : 45;
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(10, 22, 90, 3);
        ctx.fillStyle = colours[a.state];
        ctx.fillRect(10, 22, 90 * Math.max(0, a.t / total), 3);
    }

    // Камень видимости: полумрак от тьмы на глаз отличается плохо, а решает
    // он многое. Цитата из Thief, и она заслуженная.
    const lit = world.player.lit;
    const x = VIEW.w - 96;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, 10, 86, 8);
    const litCol = lit < LIGHT.hidden ? '#4fb0ff' : (lit < LIGHT.bright ? '#ffce5c' : '#ff7a5c');
    ctx.fillStyle = litCol;
    ctx.fillRect(x, 10, 86 * lit, 8);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, 10.5, 85, 7);
    ctx.font = '9px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(220,228,240,0.8)';
    ctx.textAlign = 'right';
    ctx.fillText(lit < LIGHT.hidden ? 'в тени' : (lit < LIGHT.bright ? 'полумрак' : 'на свету'), VIEW.w - 10, 30);
    if (world.player.grass) ctx.fillText('в траве', VIEW.w - 10, 42);

    // Ресурсы внизу: три монетки и шесть патронов — это весь инвентарь.
    ctx.textAlign = 'left';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(220,228,240,0.85)';
    const hp = '♥'.repeat(world.player.hp) + '·'.repeat(Math.max(0, PLAYER.hp - world.player.hp));
    ctx.fillText(hp, 10, VIEW.h - 12);
    ctx.fillText(`монет ${world.coinsLeft}`, 60, VIEW.h - 12);
    ctx.fillText(`патронов ${world.ammo}`, 130, VIEW.h - 12);
    const mode = { creep: 'крадусь', walk: 'иду', run: 'бегу' }[world.player.mode];
    ctx.fillText(mode, 215, VIEW.h - 12);
    if (world.player.dragging) ctx.fillText('несу тело', 260, VIEW.h - 12);
    if (world.goal?.taken) {
        ctx.fillStyle = '#d9c169';
        ctx.fillText('кейс', 330, VIEW.h - 12);
    }

    if (world.hint) {
        ctx.textAlign = 'center';
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillStyle = `rgba(230,238,250,${Math.min(1, world.hintT)})`;
        ctx.fillText(world.hint, VIEW.w / 2, VIEW.h - 34);
    }
}

function drawEnd(r, world) {
    const { ctx } = r;
    reset(r);
    ctx.fillStyle = 'rgba(6,8,14,0.78)';
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    ctx.textAlign = 'center';

    if (world.done === 'win') {
        const { rank, text } = rankOf(world);
        ctx.font = 'bold 30px system-ui, sans-serif';
        ctx.fillStyle = '#8ce0a8';
        ctx.fillText('ВЫШЕЛ', VIEW.w / 2, VIEW.h / 2 - 34);
        ctx.font = 'bold 44px system-ui, sans-serif';
        ctx.fillText(rank, VIEW.w / 2, VIEW.h / 2 + 12);
        ctx.font = '13px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(226,234,246,0.9)';
        ctx.fillText(text, VIEW.w / 2, VIEW.h / 2 + 36);
        const s = world.stats;
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(200,210,224,0.75)';
        ctx.fillText(
            `${world.time.toFixed(1)} с · убито ${s.killed} · оглушено ${s.downed} · спрятано ${s.stowed}`,
            VIEW.w / 2, VIEW.h / 2 + 58,
        );
    } else {
        ctx.font = 'bold 30px system-ui, sans-serif';
        ctx.fillStyle = '#ff6b6b';
        ctx.fillText('ПРОВАЛ', VIEW.w / 2, VIEW.h / 2 - 8);
    }
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(210,220,236,0.8)';
    ctx.fillText('R — заново', VIEW.w / 2, VIEW.h / 2 + 88);
}
