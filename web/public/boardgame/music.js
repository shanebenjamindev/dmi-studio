// Nhạc nền Ma Sói, tự soạn bằng Web Audio nên không cần file nhạc. Ba không khí theo bước của ván:
// - day: ban ngày và phòng chờ, đàn lute gảy rải hợp âm, sáo thỉnh thoảng thổi một câu (Rê dorian);
// - night: ban đêm, nền trầm, gió hú và tiếng chuông lẻ (La thứ);
// - tense: bỏ phiếu, phán xử: dây trầm dồn dập và trống (Rê phrygian).
// Lâu lâu có tiếng sói hú nhỏ ở xa (howl: cách nhau từ … tới … giây): ban đêm dày hơn, ban ngày thưa.
// Trang game gọi Music.mood(tên | null), Music.enable(bật/tắt), Music.duck(true khi quản trò đang đọc).
// Trình duyệt chỉ cho phát tiếng sau một lần chạm, nên nhạc bắt đầu từ lần chạm đầu tiên vào trang.
(() => {
  const MOODS = {
    day: { bpm: 84, root: 50, scale: [0, 2, 3, 5, 7, 9, 10], chords: [0, 6, 3, 0, 0, 6, 4, 0], arp: [0, 1, 2, 1, 3, 1, 2, 1], flute: 0.45, howl: [70, 130] },
    night: { bpm: 56, root: 45, scale: [0, 2, 3, 5, 7, 8, 10], chords: [0, 5, 3, 4], bell: 0.3, wind: true, howl: [20, 45] },
    tense: { bpm: 104, root: 38, scale: [0, 1, 3, 5, 7, 8, 10], chords: [0, 1, 0, 6], pulse: true },
  };
  const VOLUME = 0.22;

  let ctx = null;
  let master = null;
  let echo = null;
  let bus = null;
  let wind = null;
  let on = true;
  let ducked = false;
  let want = null;
  let mood = null;
  let next = 0;
  let step = 0;
  let melo = 7;
  let idle = null;
  let howlAt = 0;

  const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
  // Nốt thứ degree của thang âm (âm hoặc vượt quá 7 thì xuống/lên quãng tám)
  const note = (m, degree, octave = 0) => {
    const n = m.scale.length;
    const k = ((degree % n) + n) % n;
    return m.root + m.scale[k] + 12 * (octave + Math.floor(degree / n));
  };

  function start() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    // Tiếng vọng nhẹ cho có không gian
    echo = ctx.createDelay(1);
    echo.delayTime.value = 0.33;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 1800;
    echo.connect(tone).connect(fb).connect(echo);
    tone.connect(master);
    setInterval(tick, 50);
    apply();
  }

  // Âm lượng chung: tắt, đang chờ, hay nhỏ lại khi quản trò đọc
  function level() {
    if (!master) return;
    const v = on && mood ? VOLUME * (ducked ? 0.3 : 1) : 0;
    master.gain.setTargetAtTime(v, ctx.currentTime, 0.4);
  }

  // Đổi không khí: đoạn cũ nhỏ dần, đoạn mới to dần
  function apply() {
    if (!ctx) return;
    const target = on ? want : null;
    clearTimeout(idle);
    if (target) ctx.resume?.();
    if (target === mood) return level();
    const old = bus;
    if (old) {
      old.gain.setTargetAtTime(0, ctx.currentTime, 0.6);
      setTimeout(() => old.disconnect(), 4000);
    }
    if (wind) {
      wind.stop(ctx.currentTime + 3);
      wind = null;
    }
    mood = target;
    bus = null;
    if (mood) {
      bus = ctx.createGain();
      bus.gain.value = 0;
      bus.gain.setTargetAtTime(1, ctx.currentTime + 0.3, 0.8);
      bus.connect(master);
      const send = ctx.createGain();
      send.gain.value = 0.35;
      bus.connect(send).connect(echo);
      next = ctx.currentTime + 0.1;
      step = 0;
      howlAt = ctx.currentTime + (MOODS[mood].howl?.[0] || 0) * (0.3 + Math.random() * 0.4);
      if (MOODS[mood].wind) wind = gust();
    } else {
      // Không phát gì thì cho âm thanh ngủ để đỡ tốn pin
      idle = setTimeout(() => !mood && ctx.suspend?.(), 3000);
    }
    level();
  }

  // Lên lịch các nốt trước 0,25 giây
  function tick() {
    if (!mood || !bus || ctx.state !== 'running') return;
    const m = MOODS[mood];
    const dur = 60 / m.bpm / 2;
    if (next < ctx.currentTime) next = ctx.currentTime + 0.05;
    while (next < ctx.currentTime + 0.25) {
      play(m, step, next, dur);
      next += dur;
      step++;
    }
    if (m.howl && ctx.currentTime >= howlAt) {
      const [a, b] = m.howl;
      howlAt = ctx.currentTime + a + Math.random() * (b - a);
      howl(ctx.currentTime + 0.1);
      // Đôi khi một con khác ở xa hơn hú đáp lại
      if (Math.random() < 0.4) howl(ctx.currentTime + 1.6 + Math.random() * 1.2, 0.022);
    }
  }

  // Sói hú: tam giác qua bộ lọc thấp, cao độ vút lên rồi kéo dài, rơi xuống ở cuối, có rung; nhỏ và vọng (qua bus)
  function howl(t, vol = 0.04) {
    const k = 0.85 + Math.random() * 0.3;
    const len = 2.6 + Math.random() * 1.4;
    const o = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(300 * k, t);
    o.frequency.exponentialRampToValueAtTime(560 * k, t + 0.7);
    o.frequency.linearRampToValueAtTime(600 * k, t + len * 0.6);
    o.frequency.exponentialRampToValueAtTime(360 * k, t + len);
    lfo.frequency.value = 5.2;
    depth.gain.value = 7 * k;
    lfo.connect(depth).connect(o.frequency);
    lp.type = 'lowpass';
    lp.frequency.value = 1300;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.5);
    g.gain.setValueAtTime(vol, t + len * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(lp).connect(g).connect(bus);
    [o, lfo].forEach((x) => {
      x.start(t);
      x.stop(t + len + 0.05);
    });
  }

  // Một nốt móc đơn: step đếm từ đầu, 8 nốt một ô nhịp, mỗi ô một hợp âm
  function play(m, s, t, dur) {
    const beat = s % 8;
    const chord = m.chords[Math.floor(s / 8) % m.chords.length];
    const tones = [chord, chord + 2, chord + 4, chord + 7];
    if (beat === 0) pad(t, [note(m, chord, 0), note(m, chord + 4, 0)], dur * 8);
    if (m.arp && Math.random() > 0.12) pluck(t, hz(note(m, tones[m.arp[beat]], 1)), dur * 3, beat === 0 ? 0.16 : 0.1);
    if (m.flute && beat % 2 === 0 && Math.random() < m.flute) {
      melo = Math.max(4, Math.min(13, melo + [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)]));
      flute(t, hz(note(m, melo, 1)), dur * (Math.random() < 0.5 ? 2 : 4));
    }
    if (m.bell && beat % 2 === 0 && Math.random() < m.bell) bell(t, hz(note(m, tones[Math.floor(Math.random() * 4)], 2)));
    if (m.pulse) {
      pluck(t, hz(note(m, chord, beat % 4 === 3 ? 1 : 0)), dur * 0.9, beat % 2 ? 0.08 : 0.13, 900);
      if (beat === 0 || beat === 4 || beat === 7) drum(t, beat === 7 ? 0.35 : 0.6);
    }
  }

  const env = (g, t, peak, attack, release) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
  };

  // Đàn gảy: răng cưa qua bộ lọc đóng nhanh
  function pluck(t, f, len, vol, bright = 2600) {
    const o = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = f;
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(bright, t);
    lp.frequency.exponentialRampToValueAtTime(300, t + len * 0.6);
    env(g, t, vol, 0.005, len);
    o.connect(lp).connect(g).connect(bus);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  // Nền hợp âm: hai dây răng cưa lệch nhau một chút, lọc trầm
  function pad(t, notes, len) {
    notes.forEach((n) => [-6, 6].forEach((cents) => {
      const o = ctx.createOscillator();
      const lp = ctx.createBiquadFilter();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = hz(n);
      o.detune.value = cents;
      lp.type = 'lowpass';
      lp.frequency.value = 520;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.035, t + len * 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len * 1.05);
      o.connect(lp).connect(g).connect(bus);
      o.start(t);
      o.stop(t + len * 1.1);
    }));
  }

  // Sáo: sin có rung nhẹ
  function flute(t, f, len) {
    const o = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    lfo.frequency.value = 5;
    depth.gain.value = f * 0.006;
    lfo.connect(depth).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.08);
    g.gain.setValueAtTime(0.07, t + len * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(bus);
    [o, lfo].forEach((x) => {
      x.start(t);
      x.stop(t + len + 0.05);
    });
  }

  // Chuông: các hài âm không đều, ngân dài
  function bell(t, f) {
    [[1, 0.06], [2.76, 0.025], [5.4, 0.01]].forEach(([ratio, vol]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f * ratio;
      env(g, t, vol, 0.004, 2.8 / ratio ** 0.5);
      o.connect(g).connect(bus);
      o.start(t);
      o.stop(t + 3);
    });
  }

  // Trống trầm: sin hạ cao độ nhanh
  function drum(t, vol) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    env(g, t, vol, 0.004, 0.4);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 0.5);
  }

  // Gió đêm: tiếng ồn trắng qua bộ lọc dải, tần số trôi chậm
  function gust() {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let k = 0; k < data.length; k++) data[k] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    const bp = ctx.createBiquadFilter();
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    const g = ctx.createGain();
    src.buffer = buf;
    src.loop = true;
    bp.type = 'bandpass';
    bp.frequency.value = 450;
    bp.Q.value = 0.8;
    lfo.frequency.value = 0.08;
    depth.gain.value = 280;
    lfo.connect(depth).connect(bp.frequency);
    g.gain.value = 0.05;
    src.connect(bp).connect(g).connect(bus);
    src.start();
    lfo.start();
    src.addEventListener('ended', () => lfo.stop());
    return src;
  }

  document.addEventListener('pointerdown', start, { capture: true, once: true });
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend?.();
    else if (on && mood) ctx.resume?.();
  });

  window.Music = {
    mood(name) {
      if (name === want) return;
      want = name;
      apply();
    },
    enable(value) {
      on = value;
      apply();
    },
    duck(value) {
      ducked = value;
      level();
    },
  };
})();
