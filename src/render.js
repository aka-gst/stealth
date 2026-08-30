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

import { TILE, VIEW, GUARD, LIGHT, PLAYER, CAMERA, TRACKS } from './tuning.js';
import { WALL, CRATE, GRASS, EXIT, GRAVEL, SOFT, tileAt, zoneAt } from './level.js';
import { coneShape, sightReach } from './vision.js';
import { lightShape, lightOn } from './light.js';
import { moodOf, isOut } from './guard.js';
import { ALARM_NAMES, CALM, ALERT, SEARCH, CAUTION, sightMul } from './alarm.js';
import { rankOf, gateOpen } from './world.js';

const COL = {
    // Палитра из старого Metal Gear: земля тёплая, стены светлее пола и с
    // видимой гранью, всё насыщенное. Тьма здесь — приправа отдельных
    // уровней, а не общее состояние: механику, которую ещё не объяснили,
    // нельзя вдобавок прятать в темноте.
    floor: '#5b5844',
    floorAlt: '#54523e',
    wall: '#828b9d',
    wallTop: '#a8b1c4',
    wallEdge: '#3a3f4d',
    crate: '#9a7440',
    crateTop: '#c09154',
    grass: '#3a5c31',
    grassTip: '#6b9c58',
    gravel: '#6d6552',
    gravelDot: '#a49a80',
    soft: '#8d97a6',
    softTrack: '#5d6674',
    exit: '#49c46d',
    player: '#f0f4fa',
    guard: '#d9dde5',
    guardDown: '#8d95a4',
    guardDead: '#a24040',
};

const MOOD_CONE = {
    calm: 'rgba(120, 175, 255, 0.20)',
    suspect: 'rgba(255, 196, 60, 0.26)',
    alert: 'rgba(255, 70, 70, 0.30)',
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
    return { canvas, ctx, shade, shadeCtx, dpr: 1, cam: { x: 0, y: 0, s: 1 }, zone: null };
}

/** Вернуть матрицу к «логический пиксель кадра», не потеряв плотность экрана. */
const reset = (r) => r.ctx.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);

/** Перейти в мировые координаты: масштаб комнаты плюс сдвиг камеры. */
function worldSpace(r) {
    const { ctx, dpr, cam } = r;
    ctx.setTransform(dpr * cam.s, 0, 0, dpr * cam.s, -cam.x * cam.s * dpr, -cam.y * cam.s * dpr);
}

const clamp = (lo, v, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Камера комнатами. Кадр прибит к той комнате, в которой стоит герой, и
 * перещёлкивается на границе — как в старых MGS. Комната, которая целиком
 * не влезает, досматривается прокруткой, но только внутри своих границ:
 * камера не выезжает в соседнюю комнату, пока герой туда не вошёл.
 */
function camera(r, world, dt) {
    const p = world.player;
    const { level } = world;
    const zone = zoneAt(level, p.x, p.y)
        ?? { x0: 0, y0: 0, x1: level.pixelW, y1: level.pixelH, name: world.levelName ?? '' };
    r.zone = zone;

    const zw = zone.x1 - zone.x0;
    const zh = zone.y1 - zone.y0;
    const s = clamp(CAMERA.minScale, Math.min(VIEW.w / zw, VIEW.h / zh), CAMERA.maxScale);
    const visW = VIEW.w / s;
    const visH = VIEW.h / s;

    let x = zw <= visW
        ? (zone.x0 + zone.x1) / 2 - visW / 2
        : clamp(zone.x0, p.x - visW / 2, zone.x1 - visW);
    let y = zh <= visH
        ? (zone.y0 + zone.y1) / 2 - visH / 2
        : clamp(zone.y0, p.y - visH / 2, zone.y1 - visH);

    // Комната может быть меньше кадра — тогда в кадр попадает и то, что
    // вокруг неё. Но за край карты камера не выезжает: чёрная полоса по
    // краю читается как ошибка, а не как замысел.
    x = level.pixelW <= visW ? (level.pixelW - visW) / 2 : clamp(0, x, level.pixelW - visW);
    y = level.pixelH <= visH ? (level.pixelH - visH) / 2 : clamp(0, y, level.pixelH - visH);

    const k = r.cam.s === 1 && r.cam.x === 0 ? 1 : 1 - Math.exp(-dt / CAMERA.snap);
    r.cam.x += (x - r.cam.x) * k;
    r.cam.y += (y - r.cam.y) * k;
    r.cam.s += (s - r.cam.s) * k;
}

export function draw(r, world, dt = 1 / 60) {
    const { ctx } = r;
    camera(r, world, dt);

    reset(r);
    ctx.fillStyle = '#0f1117';
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);

    worldSpace(r);
    drawFloor(ctx, world, r.cam);
    drawWalls(ctx, world, r.cam);

    drawDarkness(r, world);

    worldSpace(r);
    drawOutlines(ctx, world, r.cam);
    drawCones(ctx, world);
    drawNoises(ctx, world);
    drawLastKnown(ctx, world);
    drawTracks(ctx, world);
    drawSwitches(ctx, world);
    drawGoal(ctx, world);
    drawCoins(ctx, world);
    drawGuards(ctx, world);
    drawPlayer(ctx, world);
    drawBullets(ctx, world);
    drawMarks(ctx, world);

    drawObjective(r, world);
    drawRadar(r, world);
    drawZoneName(r, world, dt);
    drawHud(r, world);
    if (world.done) drawEnd(r, world);
}

function tilesInView(cam) {
    return {
        x0: Math.max(0, Math.floor(cam.x / TILE)),
        y0: Math.max(0, Math.floor(cam.y / TILE)),
        x1: Math.ceil((cam.x + VIEW.w / cam.s) / TILE),
        y1: Math.ceil((cam.y + VIEW.h / cam.s) / TILE),
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

            if (t === GRAVEL) {
                // Гравий видно по крупной крошке: игрок должен понимать,
                // что шагом сюда нельзя, ещё до того как шагнул.
                ctx.fillStyle = COL.gravel;
                ctx.fillRect(x, y, TILE, TILE);
                ctx.fillStyle = COL.gravelDot;
                for (let i = 0; i < 5; i += 1) {
                    const gx = x + ((tx * 13 + ty * 7 + i * 5) % (TILE - 3)) + 1;
                    const gy = y + ((tx * 5 + ty * 17 + i * 11) % (TILE - 3)) + 1;
                    ctx.fillRect(gx, gy, 2, 2);
                }
            } else if (t === SOFT) {
                // Снег светлее всего на карте — и потому на нём видно следы.
                ctx.fillStyle = COL.soft;
                ctx.fillRect(x, y, TILE, TILE);
            } else if (t === GRASS) {
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
            // Верхняя грань светлее, нижняя — тёмная полоса. Так у стены
            // появляется толщина, и вид сверху перестаёт быть плоским.
            ctx.fillStyle = t === CRATE ? COL.crateTop : COL.wallTop;
            ctx.fillRect(x, y, TILE, solidBelow ? TILE : TILE - 7);
            if (!solidBelow) {
                ctx.fillStyle = COL.wallEdge;
                ctx.fillRect(x, y + TILE - 3, TILE, 3);
            }

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
    // Насколько темно, решает уровень. В обучающих комнатах светло: правило,
    // которое ещё не объяснили, не должно вдобавок прятаться в темноте.
    const ambient = world.level.ambient ?? 0;
    shadeCtx.fillStyle = `rgba(5,7,14,${(0.72 * (1 - ambient)).toFixed(3)})`;
    shadeCtx.fillRect(0, 0, VIEW.w, VIEW.h);

    shadeCtx.save();
    shadeCtx.setTransform(cam.s, 0, 0, cam.s, -cam.x * cam.s, -cam.y * cam.s);
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
    worldSpace(r);
    ctx.save();
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
    worldSpace(r);
    ctx.save();
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
    // Контур стен рисуется поверх тьмы и потому должен спорить с ней, а не
    // сливаться: на светлом уровне линия тёмная, на тёмном — светлая.
    // Не видеть стража — это игра; не видеть, где стена, — это дефект.
    const dark = (world.level.ambient ?? 0) < 0.55;
    ctx.strokeStyle = dark ? 'rgba(160,185,225,0.34)' : 'rgba(16,20,32,0.42)';
    ctx.lineWidth = dark ? 1.5 : 1;
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

/**
 * Следы. Дорога помнит, где ты шёл, — и это единственная улика, которую
 * нельзя ни спрятать, ни унести. Свежие темнее, старые выцветают.
 */
function drawTracks(ctx, world) {
    for (const t of world.tracks) {
        const fade = Math.max(0, t.life / TRACKS.life);
        ctx.save();
        ctx.globalAlpha = (t.faint ? 0.35 : 0.7) * fade;
        ctx.fillStyle = COL.softTrack;
        ctx.translate(t.x, t.y);
        ctx.rotate(t.a);
        ctx.fillRect(-3, -3, 5, 2.5);
        ctx.fillRect(-2, 1.5, 5, 2.5);
        ctx.restore();
    }
}

/** Щиток на стене: единственный тихий способ сделать темноту. */
function drawSwitches(ctx, world) {
    for (const sw of world.switches) {
        ctx.fillStyle = '#2f3742';
        ctx.fillRect(sw.x - 5, sw.y - 6, 10, 12);
        ctx.strokeStyle = '#59657a';
        ctx.lineWidth = 1;
        ctx.strokeRect(sw.x - 5.5, sw.y - 6.5, 11, 13);
        ctx.fillStyle = sw.out > 0 ? '#7a3b3b' : '#5fc27e';
        ctx.fillRect(sw.x - 2, sw.y - 3, 4, 4);
    }
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
    const sx = (goal.x - r.cam.x) * r.cam.s;
    const sy = (goal.y - r.cam.y) * r.cam.s;
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
        figure(ctx, g.x, g.y, g.angle, GUARD.radius, COL.guard, '#2b3140');

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
    if (world.box) {
        // Под коробкой героя не видно ни стражам, ни игроку — видно ящик.
        ctx.fillStyle = p.hidden ? COL.crateTop : COL.crate;
        ctx.fillRect(p.x - 9, p.y - 8, 18, 16);
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 1;
        ctx.strokeRect(p.x - 8.5, p.y - 7.5, 17, 15);
        ctx.beginPath();
        ctx.moveTo(p.x - 9, p.y);
        ctx.lineTo(p.x + 9, p.y);
        ctx.stroke();
        if (p.hidden) {
            ctx.strokeStyle = 'rgba(120,200,140,0.5)';
            ctx.setLineDash([3, 3]);
            ctx.strokeRect(p.x - 11.5, p.y - 10.5, 23, 21);
            ctx.setLineDash([]);
        }
        return;
    }

    // Герой в тени тускнеет, но не пропадает: ощущение даёт фигура, число
    // даёт прибор в углу экрана.
    const alpha = 0.55 + 0.45 * p.lit;
    ctx.save();
    ctx.globalAlpha = p.invuln > 0 && Math.floor(p.invuln * 12) % 2 ? 0.35 : alpha;
    if (p.pose === 'prone') {
        // Лёжа силуэт вытянут по взгляду: сверху человек на земле — это
        // полоса, а не круг, и отличать позу надо глазами.
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = COL.player;
        ctx.beginPath();
        ctx.ellipse(0, 0, PLAYER.radius + 5, PLAYER.radius - 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#243049';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
    } else {
        figure(ctx, p.x, p.y, p.angle, p.pose === 'hug' ? PLAYER.radius - 1 : PLAYER.radius, COL.player, '#243049');
        if (p.pose === 'hug') {
            ctx.strokeStyle = 'rgba(150,200,255,0.55)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(p.x, p.y, PLAYER.radius + 2, p.angle + 1.9, p.angle - 1.9);
            ctx.stroke();
        }
    }
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

/**
 * Радар. Цитата из MGS, и главное в ней не карта, а то, что она глохнет
 * ровно тогда, когда становится нужнее всего: при тревоге игрок остаётся
 * с тем, что видит своими глазами.
 */
/** Подпись комнаты — короткая, как смена кадра. */
function drawZoneName(r, world, dt) {
    const { ctx } = r;
    const name = r.zone?.name || world.levelName || '';
    if (name !== r.zoneShown) {
        r.zoneShown = name;
        r.zoneT = 2.4;
    }
    r.zoneT = Math.max(0, (r.zoneT ?? 0) - dt);
    if (!r.zoneT || !name) return;
    reset(r);
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(200,220,244,${Math.min(1, r.zoneT) * 0.75})`;
    ctx.fillText(name.toUpperCase(), VIEW.w / 2, 24);
}

function drawRadar(r, world) {
    const { ctx, cam } = r;
    // Радар нужен там, где комнату не видно целиком. В маленькой комнате он
    // не помогает, а закрывает собой её угол — вместе с воротами.
    const needed = world.rules.radar ?? (world.level.pixelW > VIEW.w || world.level.pixelH > VIEW.h);
    if (!needed) return;
    reset(r);
    const w = 118;
    const scale = w / world.level.pixelW;
    const h = world.level.pixelH * scale;
    const x0 = VIEW.w - w - 10;
    const y0 = 10;

    ctx.save();
    ctx.fillStyle = 'rgba(4,18,12,0.78)';
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = 'rgba(90,230,150,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);

    const dead = world.alarm.state === ALERT || world.alarm.state === SEARCH;
    if (dead) {
        ctx.fillStyle = 'rgba(200,90,90,0.22)';
        for (let i = 0; i < 26; i += 1) {
            const sy = y0 + ((i * 37) % (h - 2)) + 1;
            ctx.fillRect(x0 + 1, sy, w - 2, 1);
        }
        ctx.font = 'bold 9px system-ui, sans-serif';
        ctx.fillStyle = '#ff8080';
        ctx.textAlign = 'center';
        ctx.fillText('ПОМЕХИ', x0 + w / 2, y0 + h / 2 + 3);
        ctx.restore();
        return;
    }

    const { level } = world;
    for (let ty = 0; ty < level.h; ty += 1) {
        for (let tx = 0; tx < level.w; tx += 1) {
            const t = level.tiles[ty * level.w + tx];
            if (t !== WALL && t !== CRATE) continue;
            ctx.fillStyle = t === CRATE ? 'rgba(120,220,150,0.22)' : 'rgba(90,230,150,0.30)';
            ctx.fillRect(x0 + tx * TILE * scale, y0 + ty * TILE * scale, TILE * scale + 0.6, TILE * scale + 0.6);
        }
    }

    const mark = (px, py, colour, size = 2) => {
        ctx.fillStyle = colour;
        ctx.fillRect(x0 + px * scale - size / 2, y0 + py * scale - size / 2, size, size);
    };

    // Конусы на радаре — это и есть его смысл: планировать можно только
    // тогда, когда видно, кто куда смотрит.
    for (const g of world.guards) {
        if (isOut(g)) continue;
        const gx = x0 + g.x * scale;
        const gy = y0 + g.y * scale;
        const far = GUARD.sight * scale;
        ctx.fillStyle = moodOf(g) === 'alert' ? 'rgba(255,120,110,0.40)' : 'rgba(150,255,180,0.20)';
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.arc(gx, gy, far, g.angle - GUARD.half, g.angle + GUARD.half);
        ctx.closePath();
        ctx.fill();
        mark(g.x, g.y, '#9dffc0', 3);
    }

    if (world.goal && !world.goal.taken) mark(world.goal.x, world.goal.y, '#d9c169', 4);
    mark(world.level.exit.x, world.level.exit.y, gateOpen(world) ? '#6ee08c' : '#c94f4f', 4);
    mark(world.player.x, world.player.y, '#eaffff', 3);

    // Строчная развёртка: экран, а не картинка.
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    for (let sy = y0 + 1; sy < y0 + h - 1; sy += 3) ctx.fillRect(x0 + 1, sy, w - 2, 1);
    ctx.restore();
}

function drawHud(r, world) {
    const { ctx } = r;
    reset(r);
    const a = world.alarm;

    // Состояние тревоги и сколько ей осталось. Игрок должен видеть, что
    // ожидание работает, иначе он не станет ждать.
    const label = ALARM_NAMES[a.state];
    const colours = {
        [CALM]: '#aab6c8',
        [ALERT]: '#ff5c5c',
        [SEARCH]: '#ffb44c',
        [CAUTION]: '#ffe08a',
    };
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    // Подложка под строкой состояния: на светлом полу белый текст пропадает.
    ctx.fillStyle = 'rgba(10,14,22,0.45)';
    ctx.fillRect(4, 6, 118, 16);
    ctx.fillStyle = colours[a.state];
    ctx.fillText(label.toUpperCase(), 10, 18);
    if (world.levelNo) {
        ctx.font = '9px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(160,175,200,0.7)';
        ctx.fillText(`${world.levelNo} / ${world.levelTotal}`, 70, 18);
    }
    if (a.state === SEARCH || a.state === CAUTION) {
        const total = a.state === SEARCH ? 20 : 45;
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(10, 22, 90, 3);
        ctx.fillStyle = colours[a.state];
        ctx.fillRect(10, 22, 90 * Math.max(0, a.t / total), 3);
    }

    // Камень видимости показываем там, где свет вообще что-то решает.
    // В светлой комнате полная полоска — просто шум на экране.
    const lightMatters = world.rules.light
        ?? (world.lights.length > 0 || (world.level.ambient ?? 0) < 0.6);
    const lit = world.player.lit;
    if (!lightMatters) return drawBottomHud(r, world);
    const x = 10;
    const y = 34;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, y, 86, 8);
    const litCol = lit < LIGHT.hidden ? '#4fb0ff' : (lit < LIGHT.bright ? '#ffce5c' : '#ff7a5c');
    ctx.fillStyle = litCol;
    ctx.fillRect(x, y, 86 * lit, 8);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, 85, 7);
    ctx.font = '9px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(220,228,240,0.8)';
    ctx.textAlign = 'left';
    const where = [lit < LIGHT.hidden ? 'в тени' : (lit < LIGHT.bright ? 'полумрак' : 'на свету')];
    if (world.player.grass) where.push('в траве');
    if (world.player.pose === 'prone') where.push('лёжа');
    if (world.player.pose === 'hug') where.push('у стены');
    ctx.fillText(where.join(' · '), x, y + 19);

    drawBottomHud(r, world);
}

/** Нижняя строка: что у тебя есть и что ты сейчас делаешь. */
function drawBottomHud(r, world) {
    const { ctx } = r;
    reset(r);
    ctx.fillStyle = 'rgba(10,14,22,0.45)';
    ctx.fillRect(0, VIEW.h - 26, VIEW.w, 26);
    ctx.textAlign = 'left';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(220,228,240,0.85)';
    const hp = '♥'.repeat(world.player.hp) + '·'.repeat(Math.max(0, PLAYER.hp - world.player.hp));
    ctx.fillText(hp, 10, VIEW.h - 12);
    let slot = 60;
    if (world.rules.coins !== 0) { ctx.fillText(`монет ${world.coinsLeft}`, slot, VIEW.h - 12); slot += 70; }
    if (world.rules.ammo !== 0) { ctx.fillText(`патронов ${world.ammo}`, slot, VIEW.h - 12); slot += 85; }
    const mode = {
        creep: 'крадусь', walk: 'иду', run: 'бегу', box: 'коробка', prone: 'ползу', hug: 'у стены',
    }[world.player.mode];
    ctx.fillText(mode, slot, VIEW.h - 12);
    slot += 60;
    if (world.player.dragging) { ctx.fillText('несу тело', slot, VIEW.h - 12); slot += 66; }
    if (world.goal?.taken) {
        ctx.fillStyle = '#d9c169';
        ctx.fillText('ключ', slot, VIEW.h - 12);
    }

    if (world.hint) {
        ctx.textAlign = 'center';
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillStyle = `rgba(230,238,250,${Math.min(1, world.hintT)})`;
        ctx.fillText(world.hint, VIEW.w / 2, VIEW.h - 34);
    }
}

/**
 * Утро после побега.
 *
 * Здесь игра впервые говорит про убитых — и говорит только именами и одной
 * строкой жизни на каждого. Ни оценки, ни числа, ни морали: всё это игрок
 * поставит себе сам, и только поэтому оно сработает.
 */
export function drawEpilogue(r, data) {
    const { ctx } = r;
    reset(r);
    ctx.fillStyle = '#0b0d13';
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    ctx.textAlign = 'center';

    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillStyle = '#cfd8e6';
    ctx.fillText('УТРО', VIEW.w / 2, 46);

    if (!data.killed.length) {
        ctx.font = '13px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(210,222,238,0.9)';
        ctx.fillText('Смену сдали все.', VIEW.w / 2, VIEW.h / 2 - 8);
        ctx.fillStyle = 'rgba(180,195,214,0.7)';
        ctx.fillText('Никто на объекте не знает, что ты там был.', VIEW.w / 2, VIEW.h / 2 + 16);
    } else {
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(190,202,220,0.8)';
        ctx.fillText('На утреннюю смену не вышли:', VIEW.w / 2, 76);

        const top = 104;
        const step = Math.min(24, (VIEW.h - top - 70) / Math.max(1, data.killed.length));
        ctx.textAlign = 'left';
        const left = Math.max(24, VIEW.w / 2 - 250);
        data.killed.forEach((p, i) => {
            const y = top + i * step;
            ctx.font = '600 12px system-ui, sans-serif';
            ctx.fillStyle = '#e6ecf6';
            ctx.fillText(p.name, left, y);
            ctx.font = '11px system-ui, sans-serif';
            ctx.fillStyle = 'rgba(170,184,204,0.75)';
            ctx.fillText(p.bio, left + 62, y);
        });

        ctx.textAlign = 'center';
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(190,202,220,0.7)';
        const rest = data.spared + data.downed;
        if (rest > 0) {
            ctx.fillText(`Остальные ${rest} вышли и ничего не поняли.`, VIEW.w / 2, VIEW.h - 58);
        }
    }

    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(150,164,186,0.7)';
    ctx.fillText('E — начать заново', VIEW.w / 2, VIEW.h - 24);
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
        ctx.fillText(world.last ? 'ОБЪЕКТ СДАН' : 'ВЫШЕЛ', VIEW.w / 2, VIEW.h / 2 - 34);
        ctx.font = 'bold 44px system-ui, sans-serif';
        ctx.fillText(rank, VIEW.w / 2, VIEW.h / 2 + 12);
        ctx.font = '13px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(226,234,246,0.9)';
        ctx.fillText(text, VIEW.w / 2, VIEW.h / 2 + 36);
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(200,210,224,0.75)';
        ctx.fillText(`${world.time.toFixed(1)} с`, VIEW.w / 2, VIEW.h / 2 + 58);
    } else {
        ctx.font = 'bold 30px system-ui, sans-serif';
        ctx.fillStyle = '#ff6b6b';
        ctx.fillText('ПРОВАЛ', VIEW.w / 2, VIEW.h / 2 - 8);
    }
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(210,220,236,0.8)';
    const next = world.done === 'win' && !world.last ? 'E или пробел — дальше · ' : '';
    ctx.fillText(`${next}R — заново`, VIEW.w / 2, VIEW.h / 2 + 88);
}
