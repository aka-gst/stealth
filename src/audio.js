/**
 * Звук. Синтезируется на месте: ни одного файла, ни одной загрузки.
 *
 * Для игры про слух это не украшение, а вторая половина механики. Шум,
 * который слышат стражи, и звук, который слышит игрок, — разные вещи, и
 * путать их нельзя: крадущийся шаг для стражей ровно ноль, но игрок его
 * слышит, иначе не понимает, что вообще идёт.
 *
 * Поверхность звучит по-разному, и это единственный способ узнать, что ты
 * вышел на гравий, не глядя под ноги.
 */

const SURFACE_VOICE = {
    // множитель поверхности -> тембр шага
    1: { freq: 1500, q: 1.1, dur: 0.07, gain: 1 },      // бетон
    1.8: { freq: 2900, q: 0.8, dur: 0.12, gain: 1.5 },  // гравий: крошка
    0.3: { freq: 620, q: 1.6, dur: 0.10, gain: 0.7 },   // снег: мягкий скрип
    0.25: { freq: 900, q: 1.4, dur: 0.09, gain: 0.6 },  // трава
};

const MODE_GAIN = {
    run: 0.55, walk: 0.38, creep: 0.15, prone: 0.10, hug: 0.13, box: 0.22,
};

export function createAudio() {
    let ctx = null;
    let master = null;
    let muted = false;
    let pulse = 0;

    function ensure() {
        if (!ctx) {
            const AC = window.AudioContext ?? window.webkitAudioContext;
            if (!AC) return null;
            ctx = new AC();
            master = ctx.createGain();
            master.gain.value = 0.34;
            master.connect(ctx.destination);
        }
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }

    /** Короткий тон с завалом громкости. Из них собрано почти всё. */
    function tone({ freq, dur = 0.12, type = 'sine', vol = 0.2, to = null, delay = 0 }) {
        if (!ctx || muted) return;
        const t0 = ctx.currentTime + delay;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain).connect(master);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
    }

    /** Отфильтрованный шум: шаги, выстрел, стекло — всё отсюда. */
    function burst({ freq = 1200, q = 1, dur = 0.1, vol = 0.2, type = 'bandpass', delay = 0 }) {
        if (!ctx || muted) return;
        const t0 = ctx.currentTime + delay;
        const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
        const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;

        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = type;
        filter.frequency.value = freq;
        filter.Q.value = q;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(vol, t0);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(filter).connect(gain).connect(master);
        src.start(t0);
    }

    function play(e) {
        if (!ctx || muted) return;
        switch (e.kind) {
            case 'foot': {
                const v = SURFACE_VOICE[e.surface] ?? SURFACE_VOICE[1];
                burst({ freq: v.freq, q: v.q, dur: v.dur, vol: (MODE_GAIN[e.mode] ?? 0.3) * v.gain * 0.5 });
                break;
            }
            case 'knock':
                // Стук — единственный звук, который игрок делает нарочно.
                tone({ freq: 190, to: 120, dur: 0.09, type: 'triangle', vol: 0.3 });
                tone({ freq: 175, to: 110, dur: 0.09, type: 'triangle', vol: 0.26, delay: 0.14 });
                break;
            case 'coin':
                tone({ freq: 2600, dur: 0.22, type: 'triangle', vol: 0.16 });
                tone({ freq: 3300, dur: 0.18, type: 'sine', vol: 0.10, delay: 0.01 });
                tone({ freq: 1900, dur: 0.3, type: 'sine', vol: 0.08, delay: 0.05 });
                break;
            case 'takedown':
                burst({ freq: 380, q: 0.7, dur: 0.16, vol: 0.24 });
                tone({ freq: 90, to: 60, dur: 0.2, type: 'sine', vol: 0.18 });
                break;
            case 'body':
                tone({ freq: 70, to: 45, dur: 0.26, type: 'sine', vol: 0.26 });
                burst({ freq: 300, q: 0.6, dur: 0.14, vol: 0.16 });
                break;
            case 'shot':
                burst({ freq: 1800, q: 0.4, dur: 0.20, vol: 0.5, type: 'highpass' });
                tone({ freq: 130, to: 45, dur: 0.24, type: 'square', vol: 0.24 });
                break;
            case 'shout':
                burst({ freq: 800, q: 3.2, dur: 0.26, vol: 0.24 });
                break;
            case 'switch':
                burst({ freq: 3000, q: 2, dur: 0.035, vol: 0.28 });
                tone({ freq: 820, dur: 0.05, type: 'square', vol: 0.10 });
                break;
            case 'glass':
                burst({ freq: 5200, q: 0.7, dur: 0.28, vol: 0.3, type: 'highpass' });
                tone({ freq: 3400, to: 2100, dur: 0.2, type: 'triangle', vol: 0.10, delay: 0.05 });
                break;
            case 'pickup':
                tone({ freq: 660, dur: 0.1, type: 'triangle', vol: 0.16 });
                tone({ freq: 990, dur: 0.16, type: 'triangle', vol: 0.16, delay: 0.09 });
                break;
            case 'alarm-alert':
                // Тот самый «!». Две ноты вверх и удар снизу — узнаётся
                // раньше, чем игрок успевает посмотреть на экран.
                tone({ freq: 880, dur: 0.10, type: 'square', vol: 0.22 });
                tone({ freq: 1320, dur: 0.20, type: 'square', vol: 0.22, delay: 0.10 });
                tone({ freq: 110, to: 70, dur: 0.35, type: 'sawtooth', vol: 0.14 });
                break;
            case 'alarm-search':
                tone({ freq: 620, to: 460, dur: 0.3, type: 'square', vol: 0.14 });
                break;
            case 'alarm-caution':
                tone({ freq: 460, to: 380, dur: 0.35, type: 'triangle', vol: 0.12 });
                break;
            case 'alarm-calm':
                tone({ freq: 380, to: 300, dur: 0.5, type: 'sine', vol: 0.12 });
                break;
            case 'win':
                [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.3, type: 'triangle', vol: 0.18, delay: i * 0.11 }));
                break;
            case 'lose':
                tone({ freq: 220, to: 70, dur: 0.9, type: 'sawtooth', vol: 0.2 });
                break;
            default:
                break;
        }
    }

    /** Пока идёт тревога, сердце уровня стучит. Тишина — это уже отбой. */
    function update(alarmState, dt) {
        if (!ctx || muted) return;
        if (alarmState !== 'alert' && alarmState !== 'search') { pulse = 0; return; }
        pulse -= dt;
        if (pulse > 0) return;
        pulse = alarmState === 'alert' ? 0.62 : 1.5;
        tone({
            freq: alarmState === 'alert' ? 160 : 120,
            dur: alarmState === 'alert' ? 0.14 : 0.2,
            type: 'square',
            vol: alarmState === 'alert' ? 0.12 : 0.07,
        });
    }

    return {
        ensure,
        play,
        update,
        toggle() { muted = !muted; return muted; },
        get muted() { return muted; },
    };
}
