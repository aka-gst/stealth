/**
 * Ввод: клавиши с мышью и палец. Переключаться между ними не надо — оба
 * живут одновременно, и игра не спрашивает, с чего в неё зашли.
 *
 * На пальце скорость задаётся длиной наклона джойстика: чуть отвёл —
 * крадёшься, отвёл до края — бежишь. Это тот же торг «скорость против
 * шума», только без отдельной кнопки.
 */

const MOVE_KEYS = {
    KeyW: [0, -1], ArrowUp: [0, -1],
    KeyS: [0, 1], ArrowDown: [0, 1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0],
    KeyD: [1, 0], ArrowRight: [1, 0],
};

export function createInput(canvas) {
    const keys = new Set();
    const edges = new Set();
    let creepToggle = false;
    const mouse = { x: 0, y: 0, seen: 0, down: false };
    const stick = { active: false, ox: 0, oy: 0, x: 0, y: 0, id: null };
    const taps = new Set();

    const press = (code) => { edges.add(code); };

    window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        keys.add(e.code);
        if (e.code === 'KeyC') creepToggle = !creepToggle;
        press(e.code);
        if (MOVE_KEYS[e.code] || e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => keys.delete(e.code));
    window.addEventListener('blur', () => keys.clear());

    canvas.addEventListener('mousemove', (e) => {
        const r = canvas.getBoundingClientRect();
        mouse.x = (e.clientX - r.left) / r.width;
        mouse.y = (e.clientY - r.top) / r.height;
        mouse.seen = 1.4;
    });
    canvas.addEventListener('mousedown', (e) => {
        if (e.button === 0) press('Fire');
        if (e.button === 2) press('Coin');
        e.preventDefault();
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    const pad = document.getElementById('pad');
    if (pad) {
        const start = (e) => {
            const t = e.changedTouches ? e.changedTouches[0] : e;
            stick.active = true;
            stick.id = t.identifier ?? 'mouse';
            stick.ox = t.clientX;
            stick.oy = t.clientY;
            stick.x = 0;
            stick.y = 0;
            e.preventDefault();
        };
        const move = (e) => {
            if (!stick.active) return;
            const list = e.changedTouches ? [...e.changedTouches] : [e];
            const t = list.find((p) => (p.identifier ?? 'mouse') === stick.id);
            if (!t) return;
            stick.x = (t.clientX - stick.ox) / 52;
            stick.y = (t.clientY - stick.oy) / 52;
            const len = Math.hypot(stick.x, stick.y);
            if (len > 1) { stick.x /= len; stick.y /= len; }
            e.preventDefault();
        };
        const end = () => { stick.active = false; stick.x = 0; stick.y = 0; };
        pad.addEventListener('touchstart', start, { passive: false });
        pad.addEventListener('touchmove', move, { passive: false });
        pad.addEventListener('touchend', end);
        pad.addEventListener('touchcancel', end);
    }

    for (const [id, code] of [['b-act', 'KeyE'], ['b-kill', 'KeyF'], ['b-coin', 'Coin'], ['b-fire', 'Fire']]) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.addEventListener('touchstart', (e) => { press(code); taps.add(code); e.preventDefault(); }, { passive: false });
        el.addEventListener('mousedown', (e) => { press(code); e.preventDefault(); });
    }
    const creepBtn = document.getElementById('b-creep');
    if (creepBtn) {
        const flip = (e) => { creepToggle = !creepToggle; creepBtn.classList.toggle('on', creepToggle); e.preventDefault(); };
        creepBtn.addEventListener('touchstart', flip, { passive: false });
        creepBtn.addEventListener('mousedown', flip);
    }

    return {
        /** Слепок кадра. `view` нужен, чтобы перевести мышь в мир. */
        frame(dt, cam, view) {
            let ax = 0;
            let ay = 0;
            for (const [code, [dx, dy]] of Object.entries(MOVE_KEYS)) {
                if (keys.has(code)) { ax += dx; ay += dy; }
            }

            let creep = creepToggle;
            let run = keys.has('ShiftLeft') || keys.has('ShiftRight');

            if (stick.active && Math.hypot(stick.x, stick.y) > 0.12) {
                const len = Math.hypot(stick.x, stick.y);
                ax = stick.x;
                ay = stick.y;
                creep = creepToggle || len < 0.45;
                run = !creepToggle && len > 0.86;
            }
            if (run) creep = false;

            mouse.seen = Math.max(0, mouse.seen - dt);
            let aimAngle = null;
            if (mouse.seen > 0 && cam) {
                const wx = cam.x + mouse.x * view.w;
                const wy = cam.y + mouse.y * view.h;
                aimAngle = Math.atan2(wy - cam.py, wx - cam.px);
            }

            return {
                ax,
                ay,
                creep,
                run,
                aimAngle,
                action: edges.has('KeyE'),
                kill: edges.has('KeyF'),
                coin: edges.has('KeyQ') || edges.has('Coin'),
                fire: edges.has('Space') || edges.has('Fire'),
                restart: edges.has('KeyR'),
                creepOn: creep,
            };
        },
        endFrame() { edges.clear(); },
        setCreep(v) { creepToggle = v; },
    };
}
