// Contact sheets: a few frames from inside a Drive clip, side by side, so a model can see what happens in it over time
// (a Drive thumbnail is a single frame, often from the first instant). Only the keyframe nearest each moment is decoded,
// so ffmpeg reads a few MB per frame instead of the whole 4K file. Sheets are cached on disk by clip id.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DATA_DIR, FFMPEG } from './config';
import * as G from './google';

const DIR = path.join(DATA_DIR, 'frames');
const H = 180; // px height of each frame

/** Where the frames are taken (seconds): early, middle, late; one frame for very short clips. */
export function frameTimes(duration?: number) {
  const d = duration || 0;
  if (d < 3) return [Math.max(0, d / 2)];
  return [0.12, 0.5, 0.85].map((k) => Math.round(d * k * 10) / 10);
}

export async function contactSheet(account: string, id: string, duration?: number): Promise<Buffer | null> {
  const times = frameTimes(duration);
  const file = path.join(DIR, `${id}_${times.join('_')}.jpg`);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  if (!FFMPEG) return null;
  fs.mkdirSync(DIR, { recursive: true });
  const token = await G.accessToken(account);
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`;
  const inputs = times.flatMap((t) => ['-headers', `Authorization: Bearer ${token}\r\n`, '-skip_frame', 'nokey', '-noaccurate_seek', '-ss', String(t), '-i', url]);
  const graph = times.map((_, i) => `[${i}:v]scale=-2:${H},setsar=1[f${i}]`).join(';') + ';' + times.map((_, i) => `[f${i}]`).join('') + (times.length > 1 ? `hstack=${times.length}[out]` : 'null[out]');
  const tmp = file + '.part.jpg';
  const ok = await new Promise<boolean>((resolve) => {
    const child = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', graph, '-map', '[out]', '-frames:v', '1', '-q:v', '5', tmp], { stdio: 'ignore' });
    const timer = setTimeout(() => child.kill(), 90e3);
    child.on('error', () => { clearTimeout(timer); resolve(false); });
    child.on('close', (code) => { clearTimeout(timer); resolve(code === 0 && fs.existsSync(tmp)); });
  });
  if (!ok) { fs.rmSync(tmp, { force: true }); return null; }
  fs.renameSync(tmp, file);
  return fs.readFileSync(file);
}

/** Contact sheets for many clips, `parallel` at a time; `progress(done, total)` after each. */
export async function contactSheets(items: { account: string; id: string; duration?: number }[], parallel = 6, progress?: (done: number, total: number) => void) {
  const out = new Map<string, Buffer>();
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: parallel }, async () => {
    for (let i = next++; i < items.length; i = next++) {
      const it = items[i];
      try { const b = await contactSheet(it.account, it.id, it.duration); if (b) out.set(it.id, b); } catch { /* the model still gets the clip's name and thumbnail-less entry */ }
      progress?.(++done, items.length);
    }
  }));
  return out;
}
