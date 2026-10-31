// Web Audio: generative soundtrack + AI voice-over, routed to speakers and to a recordable stream.
import type { Storyboard } from '../types';
import { timeline } from './renderer';

const KEYS: Record<string, number> = { calm: 57, upbeat: 60, epic: 50 };
const PROG: Record<string, [number, string][]> = {
  calm: [[0, 'M7'], [5, 'M7'], [-3, 'm7'], [7, 'sus']],
  upbeat: [[0, 'M'], [7, 'M'], [9, 'm'], [5, 'M']],
  epic: [[0, 'm'], [-4, 'M'], [-7, 'M'], [-2, 'M']],
};
const Q: Record<string, number[]> = { M: [0, 4, 7], m: [0, 3, 7], M7: [0, 4, 7, 11], m7: [0, 3, 7, 10], sus: [0, 5, 7] };
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  recDest!: MediaStreamAudioDestinationNode;
  private nodes: AudioScheduledSourceNode[] = [];
  private buses: GainNode[] = [];
  private noise?: AudioBuffer;
  private voiceCache = new Map<string, Promise<AudioBuffer | null>>();

  ensure() {
    if (!this.ctx) {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AC() as AudioContext;
      this.master = this.ctx.createGain(); this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      this.recDest = this.ctx.createMediaStreamDestination();
      this.master.connect(this.recDest);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  stop() {
    for (const n of this.nodes) { try { n.stop(); } catch { /* already stopped */ } }
    for (const b of this.buses) { try { b.disconnect(); } catch { /* noop */ } }
    this.nodes = []; this.buses = [];
  }

  loadVoice(url: string): Promise<AudioBuffer | null> {
    if (!this.voiceCache.has(url)) {
      const ctx = this.ensure();
      this.voiceCache.set(url, fetch(url).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)).catch(() => null));
    }
    return this.voiceCache.get(url)!;
  }

  /** Start music + voices from `offset` seconds. */
  async play(sb: Storyboard, offset: number, total: number, o: { music: boolean; voice: boolean }) {
    this.stop();
    const ctx = this.ensure();
    const tl = timeline(sb);
    const withVoice = o.voice ? tl.filter((s) => s.scene.voice?.url) : [];
    const buffers = await Promise.all(withVoice.map((s) => this.loadVoice(s.scene.voice!.url)));
    const t0 = ctx.currentTime + 0.05 - offset;
    if (o.music) this.music(sb.music, t0, total, buffers.some(Boolean) ? 0.32 : 1);
    withVoice.forEach((seg, i) => {
      const buf = buffers[i]; if (!buf) return;
      const startAt = t0 + seg.start + 0.25;
      const into = ctx.currentTime - startAt;
      if (into >= buf.duration) return;
      const src = ctx.createBufferSource(); src.buffer = buf;
      const g = ctx.createGain(); g.gain.value = 1;
      src.connect(g); g.connect(this.master);
      if (into > 0) src.start(ctx.currentTime, into); else src.start(startAt);
      this.nodes.push(src); this.buses.push(g);
    });
  }

  private music(music: Storyboard['music'], t0: number, total: number, level: number) {
    if (!music || music.mood === 'none') return;
    const ctx = this.ctx!;
    const mood = PROG[music.mood] ? music.mood : 'calm';
    const bpm = Math.max(60, Math.min(160, Number(music.bpm) || 100));
    const beat = 60 / bpm, bar = beat * 4;
    const bus = ctx.createGain(); bus.connect(this.master); this.buses.push(bus);
    const vol = 0.55 * level;
    bus.gain.setValueAtTime(0, ctx.currentTime);
    bus.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.6);
    bus.gain.setValueAtTime(vol, Math.max(ctx.currentTime + 0.7, t0 + total - 1.5));
    bus.gain.linearRampToValueAtTime(0, Math.max(ctx.currentTime + 0.8, t0 + total));
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = mood === 'calm' ? 1400 : 2600; lp.connect(bus);
    const key = KEYS[mood];
    const noise = this.noiseBuf();
    for (let b = 0; b < Math.ceil(total / bar) + 1; b++) {
      const bs = t0 + b * bar;
      if (bs + bar < ctx.currentTime) continue;
      const [root, q] = PROG[mood][b % 4];
      const notes = Q[q].map((iv) => key + root + iv);
      notes.forEach((n) => this.tone(lp, hz(n), bs, bar * 1.02, mood === 'epic' ? 'sawtooth' : 'triangle', 0.045, 0.4, 0.6));
      const bassN = key + root - 12 - (mood === 'epic' ? 12 : 0);
      if (mood === 'upbeat') for (let k = 0; k < 4; k++) this.tone(lp, hz(bassN), bs + k * beat, beat * 0.8, 'square', 0.035, 0.01, 0.1);
      else this.tone(lp, hz(bassN), bs, bar, 'sine', 0.12, 0.05, 0.4);
      if (mood !== 'epic') {
        const steps = mood === 'calm' ? 8 : 16;
        for (let k = 0; k < steps; k++) this.tone(bus, hz(notes[k % notes.length] + 12 + (k % 8 >= 4 ? 12 : 0)), bs + k * (bar / steps), (bar / steps) * 0.9, 'sine', mood === 'calm' ? 0.025 : 0.02, 0.005, 0.15);
      }
      if (mood === 'upbeat') {
        for (let k = 0; k < 4; k++) this.kick(bus, bs + k * beat, 0.5);
        for (let k = 1; k < 8; k += 2) this.hat(bus, noise, bs + (k * beat) / 2, 0.07);
        this.hat(bus, noise, bs + beat, 0.12, 1800, 0.18); this.hat(bus, noise, bs + beat * 3, 0.12, 1800, 0.18);
      } else if (mood === 'epic') {
        this.kick(bus, bs, 0.7, 60); this.kick(bus, bs + beat * 2.5, 0.5, 70); this.kick(bus, bs + beat * 3, 0.5, 90);
        this.hat(bus, noise, bs + beat * 2, 0.1, 1200, 0.4);
      }
    }
  }
  private tone(out: AudioNode, f: number, start: number, dur: number, type: OscillatorType, vol: number, atk: number, rel: number) {
    const ctx = this.ctx!;
    if (start + dur + rel < ctx.currentTime) return;
    const s = Math.max(start, ctx.currentTime);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(vol, s + atk);
    g.gain.setValueAtTime(vol, Math.max(s + atk, start + dur - rel)); g.gain.linearRampToValueAtTime(0, start + dur + rel);
    o.connect(g); g.connect(out); o.start(s); o.stop(start + dur + rel + 0.05); this.nodes.push(o);
  }
  private kick(out: AudioNode, t: number, vol: number, f0 = 55) {
    const ctx = this.ctx!; if (t < ctx.currentTime) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(f0, t + 0.12);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.45); this.nodes.push(o);
  }
  private hat(out: AudioNode, buf: AudioBuffer, t: number, vol: number, freq = 7000, len = 0.05) {
    const ctx = this.ctx!; if (t < ctx.currentTime) return;
    const s = ctx.createBufferSource(); s.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    s.connect(f); f.connect(g); g.connect(out); s.start(t); s.stop(t + len + 0.02); this.nodes.push(s);
  }
  private noiseBuf() {
    if (this.noise) return this.noise;
    const ctx = this.ctx!;
    const b = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return (this.noise = b);
  }
}

export const audio = new AudioEngine();
