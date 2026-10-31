// DMI Studio — generative soundtrack with Web Audio (royalty-free, recordable).
(function () {
  const KEYS = { calm: 57, upbeat: 60, epic: 50 }; // A3, C4, D3
  // chord progressions as scale-degree roots (semitones from key) + quality
  const PROG = {
    calm: [[0, 'M7'], [5, 'M7'], [-3, 'm7'], [7, 'sus']],
    upbeat: [[0, 'M'], [7, 'M'], [9, 'm'], [5, 'M']],
    epic: [[0, 'm'], [-4, 'M'], [-7, 'M'], [-2, 'M']],
  };
  const Q = { M: [0, 4, 7], m: [0, 3, 7], M7: [0, 4, 7, 11], m7: [0, 3, 7, 10], sus: [0, 5, 7] };
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  class Music {
    constructor() { this.ctx = null; this.nodes = []; this.master = null; }

    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        this.recDest = this.ctx.createMediaStreamDestination();
        this.master.connect(this.recDest);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }

    stop() {
      for (const n of this.nodes) { try { n.stop(); } catch (e) { /* already stopped */ } }
      this.nodes = [];
      if (this.bus) { try { this.bus.disconnect(); } catch (e) { /* noop */ } this.bus = null; }
    }

    // Schedule the whole track from `offset` seconds to `total` seconds.
    play(music, offset, total) {
      this.stop();
      if (!music || music.mood === 'none') return;
      const ctx = this.ensure();
      const mood = PROG[music.mood] ? music.mood : 'calm';
      const bpm = Math.max(60, Math.min(160, Number(music.bpm) || 100));
      const beat = 60 / bpm, bar = beat * 4;
      const t0 = ctx.currentTime + 0.05 - offset;
      const bus = ctx.createGain(); bus.connect(this.master); this.bus = bus;
      // fade in/out
      bus.gain.setValueAtTime(0, ctx.currentTime);
      bus.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.6);
      bus.gain.setValueAtTime(1, Math.max(ctx.currentTime + 0.7, t0 + total - 1.5));
      bus.gain.linearRampToValueAtTime(0, t0 + total);

      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = mood === 'calm' ? 1400 : 2600; lp.connect(bus);
      const key = KEYS[mood];
      const bars = Math.ceil(total / bar) + 1;
      const noise = this.noiseBuf(ctx);

      for (let b = 0; b < bars; b++) {
        const bs = t0 + b * bar;
        if (bs + bar < ctx.currentTime) continue;
        const [root, q] = PROG[mood][b % 4];
        const notes = Q[q].map((iv) => key + root + iv);
        // pad
        notes.forEach((n) => this.tone(ctx, lp, hz(n), bs, bar * 1.02, mood === 'epic' ? 'sawtooth' : 'triangle', 0.045, 0.4, 0.6));
        // bass
        const bassN = key + root - 12 - (mood === 'epic' ? 12 : 0);
        if (mood === 'upbeat') for (let k = 0; k < 4; k++) this.tone(ctx, lp, hz(bassN), bs + k * beat, beat * 0.8, 'square', 0.035, 0.01, 0.1);
        else this.tone(ctx, lp, hz(bassN), bs, bar, 'sine', 0.12, 0.05, 0.4);
        // arpeggio
        if (mood !== 'epic') {
          const steps = mood === 'calm' ? 8 : 16;
          for (let k = 0; k < steps; k++) {
            const n = notes[k % notes.length] + 12 + (k % 8 >= 4 ? 12 : 0);
            this.tone(ctx, bus, hz(n), bs + k * (bar / steps), bar / steps * 0.9, 'sine', mood === 'calm' ? 0.025 : 0.02, 0.005, 0.15);
          }
        }
        // drums
        if (mood === 'upbeat') {
          for (let k = 0; k < 4; k++) this.kick(ctx, bus, bs + k * beat, 0.5);
          for (let k = 0; k < 8; k++) if (k % 2) this.hat(ctx, bus, noise, bs + k * beat / 2, 0.07);
          this.hat(ctx, bus, noise, bs + beat, 0.12, 1800, 0.18);
          this.hat(ctx, bus, noise, bs + beat * 3, 0.12, 1800, 0.18);
        } else if (mood === 'epic') {
          this.kick(ctx, bus, bs, 0.7, 60); this.kick(ctx, bus, bs + beat * 2.5, 0.5, 70);
          this.kick(ctx, bus, bs + beat * 3, 0.5, 90);
          this.hat(ctx, bus, noise, bs + beat * 2, 0.1, 1200, 0.4);
        }
      }
    }

    tone(ctx, out, f, start, dur, type, vol, atk, rel) {
      if (start + dur + rel < ctx.currentTime) return;
      const s = Math.max(start, ctx.currentTime);
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(vol, s + atk);
      g.gain.setValueAtTime(vol, Math.max(s + atk, start + dur - rel));
      g.gain.linearRampToValueAtTime(0, start + dur + rel);
      o.connect(g); g.connect(out); o.start(s); o.stop(start + dur + rel + 0.05);
      this.nodes.push(o);
    }

    kick(ctx, out, t, vol, f0 = 55) {
      if (t < ctx.currentTime) return;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(f0, t + 0.12);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.45); this.nodes.push(o);
    }

    hat(ctx, out, buf, t, vol, freq = 7000, len = 0.05) {
      if (t < ctx.currentTime) return;
      const s = ctx.createBufferSource(); s.buffer = buf;
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = freq;
      const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
      s.connect(f); f.connect(g); g.connect(out); s.start(t); s.stop(t + len + 0.02); this.nodes.push(s);
    }

    noiseBuf(ctx) {
      if (this._noise) return this._noise;
      const b = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return (this._noise = b);
    }
  }

  window.DMIMusic = new Music();
})();
