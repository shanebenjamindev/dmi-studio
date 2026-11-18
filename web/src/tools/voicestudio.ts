// VoiceStudio (github.com/debpalash/VoiceStudio), the free, local voice app each person runs on their own computer: this
// page calls its API at http://localhost:3900 straight from the browser, so voices, recordings and videos stay on that
// computer and nothing is paid for. Its code is not part of DMI (it is AGPL); only its API is used:
//  • speech      POST /v1/audio/speech          (OpenAI-compatible)
//  • transcripts POST /v1/audio/transcriptions  (OpenAI-compatible, verbose_json gives timed lines)
//  • voices      GET  /v1/audio/voices, POST /profiles (kind=clone)
//  • dubbing     the lines above, translated by POST /dub/translate, spoken one by one and laid on the video here.
// VoiceStudio answers only the web pages it trusts: OMNIVOICE_ALLOWED_ORIGINS must name this site (see setupCommand).
import {
  Input, Output, ALL_FORMATS, BlobSource, BufferTarget, EncodedPacketSink, EncodedVideoPacketSource, AudioBufferSource,
  Mp4OutputFormat, Quality, getFirstEncodableAudioCodec,
} from 'mediabunny';

const LS_URL = 'dms.voicestudio.url';
export const DEFAULT_URL = 'http://localhost:3900';
export const baseUrl = () => { try { return localStorage.getItem(LS_URL) || DEFAULT_URL; } catch { return DEFAULT_URL; } };
export const setBaseUrl = (u: string) => { try { localStorage.setItem(LS_URL, u.replace(/\/+$/, '') || DEFAULT_URL); } catch { /* private mode */ } };

/** The command that lets this site call VoiceStudio on a Mac (kept: the app's own window, `app://voicestudio`). */
export const setupCommand = () => `launchctl setenv OMNIVOICE_ALLOWED_ORIGINS "app://voicestudio,${location.origin}"`;

async function call(path: string, init?: RequestInit) {
  let r: Response;
  try { r = await fetch(baseUrl() + path, init); }
  catch { throw Object.assign(new Error('Không kết nối được VoiceStudio. Hãy mở app VoiceStudio trên máy này và cho phép DMI truy cập (xem Cài đặt).'), { offline: true }); }
  if (!r.ok) {
    let msg = `VoiceStudio báo lỗi ${r.status}`;
    try { const j = await r.json(); msg = j.detail?.message || (typeof j.detail === 'string' ? j.detail : '') || j.error?.message || msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return r;
}
const json = async <T,>(path: string, init?: RequestInit) => (await (await call(path, init)).json()) as T;
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export interface Voice { voice_id: string; name: string; type: string; description?: string }
/** Its voices: the saved ones (cloned or designed) first, then the engine's defaults. */
export async function voices() {
  const r = await json<{ voices: Voice[] }>('/v1/audio/voices');
  return [...r.voices.filter((v) => v.type === 'profile'), ...r.voices.filter((v) => v.type !== 'profile' && v.voice_id === 'default')];
}

export const LANGS: [string, string][] = [['vi', 'Tiếng Việt'], ['en', 'English'], ['zh', '中文'], ['ja', '日本語'], ['ko', '한국어'], ['th', 'ไทย'], ['fr', 'Français'], ['es', 'Español'], ['de', 'Deutsch']];

// ---------------------------------------------------------------- speech
const MAX_INPUT = 4000; // VoiceStudio takes up to 4096 characters a call
/** The text in pieces VoiceStudio takes, cut at paragraph or sentence ends. */
export function pieces(text: string) {
  const out: string[] = [];
  let cur = '';
  for (const s of text.replace(/\r/g, '').split(/(?<=[.!?…。！？\n])\s+/)) {
    if (cur && cur.length + s.length + 1 > MAX_INPUT) { out.push(cur); cur = ''; }
    cur = cur ? `${cur} ${s}` : s;
    while (cur.length > MAX_INPUT) { out.push(cur.slice(0, MAX_INPUT)); cur = cur.slice(MAX_INPUT); }
  }
  if (cur.trim()) out.push(cur);
  return out.map((p) => p.trim()).filter(Boolean);
}
export async function speak(text: string, o: { voice: string; language: string; speed?: number }) {
  const r = await call('/v1/audio/speech', post({ model: 'omnivoice', input: text, voice: o.voice || 'default', language: o.language || undefined, speed: o.speed || 1, response_format: 'wav' }));
  return r.blob();
}
/** A whole script: piece by piece, joined into one WAV. */
export async function speakAll(text: string, o: { voice: string; language: string; speed?: number }, onProgress: (k: number) => void, signal: AbortSignal) {
  const parts = pieces(text), bufs: AudioBuffer[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (signal.aborted) throw new Error('Đã dừng');
    bufs.push(await decode(await speak(parts[i], o)));
    onProgress((i + 1) / parts.length);
  }
  return toWav(join(bufs));
}

// ---------------------------------------------------------------- transcripts
export interface Line { start: number; end: number; text: string }
export async function transcribe(file: Blob, name: string, language: string) {
  const f = new FormData();
  f.append('file', file, name);
  f.append('model', 'whisper-1');
  f.append('response_format', 'verbose_json');
  if (language) f.append('language', language);
  const r = await json<{ text: string; language?: string; segments?: { start: number; end: number; text: string }[] }>('/v1/audio/transcriptions', { method: 'POST', body: f });
  const lines = (r.segments || []).map((s) => ({ start: s.start, end: s.end, text: s.text.trim() })).filter((s) => s.text);
  return { text: r.text.trim(), language: r.language || language, lines };
}
const stamp = (t: number, sep: string) => {
  const ms = Math.max(0, Math.round(t * 1000)), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`;
};
export const toSrt = (lines: Line[]) => lines.map((l, i) => `${i + 1}\n${stamp(l.start, ',')} --> ${stamp(l.end, ',')}\n${l.text}\n`).join('\n');
export const toVtt = (lines: Line[]) => `WEBVTT\n\n${lines.map((l) => `${stamp(l.start, '.')} --> ${stamp(l.end, '.')}\n${l.text}\n`).join('\n')}`;

// ---------------------------------------------------------------- voices
/** A voice made from a recording of someone who agreed to it; usable for speech and dubbing right away. */
export async function cloneVoice(o: { name: string; audio: Blob; fileName: string; language: string; refText: string }) {
  const f = new FormData();
  f.append('name', o.name);
  f.append('kind', 'clone');
  f.append('ref_audio', o.audio, o.fileName);
  f.append('ref_text', o.refText);
  f.append('language', o.language || 'Auto');
  return json<{ id: string; name: string }>('/profiles', { method: 'POST', body: f });
}

// ---------------------------------------------------------------- dubbing
export type DubStep = 'listen' | 'translate' | 'speak' | 'mix' | 'video';
/** The video (or recording) in another language, in the voice picked: each line said in its own time slot (said faster
 *  when it runs long), the original sound kept quietly underneath if asked. Video: the picture is copied as it is. */
export async function dub(file: File, o: { from: string; to: string; voice: string; keepOriginal: number },
  onStep: (step: DubStep, k: number) => void, signal: AbortSignal) {
  const stop = () => { if (signal.aborted) throw new Error('Đã dừng'); };
  onStep('listen', 0);
  const heard = await transcribe(file, file.name, o.from);
  if (!heard.lines.length) throw new Error('Không nghe được lời nào trong file');
  stop();
  onStep('translate', 0);
  const { translated } = await json<{ translated: { id: string; text: string }[] }>('/dub/translate', post({
    segments: heard.lines.map((l, i) => ({ id: String(i), text: l.text, slot_seconds: Math.max(0.3, l.end - l.start) })),
    target_lang: o.to, source_lang: heard.language || undefined,
  }));
  const said = heard.lines.map((l, i) => ({ ...l, text: translated.find((t) => t.id === String(i))?.text?.trim() || l.text }));
  stop();
  const original = await decode(file);
  const clips: { at: number; buf: AudioBuffer }[] = [];
  for (let i = 0; i < said.length; i++) {
    stop();
    const l = said[i], slot = Math.max(0.3, (said[i + 1]?.start ?? original.duration) - l.start);
    let buf = await decode(await speak(l.text, { voice: o.voice, language: o.to }));
    // Longer than its slot: said again faster, at most 1.6 times.
    if (buf.duration > slot * 1.05) buf = await decode(await speak(l.text, { voice: o.voice, language: o.to, speed: Math.min(1.6, buf.duration / slot) }));
    clips.push({ at: l.start, buf });
    onStep('speak', (i + 1) / said.length);
  }
  onStep('mix', 0);
  const track = await mix(original, clips, o.keepOriginal);
  const srt = toSrt(said);
  if (!file.type.startsWith('video/')) return { media: toWav(track), name: rename(file.name, `${o.to}.wav`), srt };
  onStep('video', 0);
  return { media: await withAudio(file, track, (k) => onStep('video', k), signal), name: rename(file.name, `${o.to}.mp4`), srt };
}
const rename = (name: string, ext: string) => `${name.replace(/\.[^.]+$/, '')}-${ext}`;

// ---------------------------------------------------------------- audio in the browser
let ctx: AudioContext | null = null;
export async function decode(b: Blob) {
  ctx ||= new AudioContext();
  try { return await ctx.decodeAudioData(await b.arrayBuffer()); }
  catch { throw new Error('Trình duyệt không đọc được âm thanh của file này'); }
}
function join(bufs: AudioBuffer[]) {
  const rate = bufs[0]?.sampleRate || 24000, ch = Math.max(1, ...bufs.map((b) => b.numberOfChannels));
  const len = bufs.reduce((n, b) => n + Math.ceil(b.duration * rate), 0);
  const out = new AudioBuffer({ length: Math.max(1, len), numberOfChannels: ch, sampleRate: rate });
  let at = 0;
  for (const b of bufs) {
    for (let c = 0; c < ch; c++) out.getChannelData(c).set(b.getChannelData(Math.min(c, b.numberOfChannels - 1)).subarray(0, out.length - at), at);
    at += b.length;
  }
  return out;
}
/** The new voice lines on the original's timeline, rendered offline. */
async function mix(original: AudioBuffer, clips: { at: number; buf: AudioBuffer }[], keepOriginal: number) {
  const rate = 48000, end = Math.max(original.duration, ...clips.map((c) => c.at + c.buf.duration));
  const off = new OfflineAudioContext(2, Math.ceil(end * rate), rate);
  if (keepOriginal > 0) {
    const s = off.createBufferSource(), g = off.createGain();
    s.buffer = original; g.gain.value = keepOriginal;
    s.connect(g).connect(off.destination); s.start(0);
  }
  for (const c of clips) { const s = off.createBufferSource(); s.buffer = c.buf; s.connect(off.destination); s.start(c.at); }
  return off.startRendering();
}
export function toWav(b: AudioBuffer) {
  const ch = b.numberOfChannels, n = b.length, data = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); data.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVEfmt ');
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true); data.setUint32(24, b.sampleRate, true);
  data.setUint32(28, b.sampleRate * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true);
  str(36, 'data'); data.setUint32(40, n * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, c) => b.getChannelData(c));
  for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += 2) data.setInt16(o, Math.max(-1, Math.min(1, chans[c][i])) * 0x7fff, true);
  return new Blob([data], { type: 'audio/wav' });
}
/** The video with `track` as its sound: the picture copied packet by packet (no re-encoding), the sound as AAC. */
async function withAudio(file: File, track: AudioBuffer, onProgress: (k: number) => void, signal: AbortSignal) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video?.codec) throw new Error('Không đọc được hình của video');
    const codec = await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: track.sampleRate });
    if (!codec) throw new Error('Trình duyệt này không mã hoá được âm thanh cho MP4');
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const pic = new EncodedVideoPacketSource(video.codec), sound = new AudioBufferSource({ codec, quality: new Quality('high') });
    output.addVideoTrack(pic, { rotation: video.rotation });
    output.addAudioTrack(sound);
    await output.start();
    const config = await video.getDecoderConfig(), total = await video.computeDuration();
    // Sound and picture go in side by side (a second of sound ahead), as the file interleaves them.
    const second = track.sampleRate, chunks = Math.ceil(track.length / second);
    let sent = 0;
    const soundUpTo = async (t: number) => {
      for (; sent < chunks && sent < t + 1; sent++) {
        const len = Math.min(second, track.length - sent * second), part = new AudioBuffer({ length: len, numberOfChannels: track.numberOfChannels, sampleRate: track.sampleRate });
        for (let c = 0; c < track.numberOfChannels; c++) part.copyToChannel(track.getChannelData(c).subarray(sent * second, sent * second + len), c);
        await sound.add(part);
      }
    };
    let first = true;
    for await (const packet of new EncodedPacketSink(video).packets()) {
      if (signal.aborted) { await output.cancel(); throw new Error('Đã dừng'); }
      await soundUpTo(packet.timestamp);
      await pic.add(packet, first ? { decoderConfig: config! } : undefined);
      first = false;
      onProgress(Math.min(0.95, packet.timestamp / (total || 1)));
    }
    await soundUpTo(Infinity);
    await output.finalize();
    onProgress(1);
    return new Blob([output.target.buffer!], { type: 'video/mp4' });
  } finally { input.dispose(); }
}
