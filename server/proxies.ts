// Edit proxies: light 720p H.264 copies of the parts of Drive clips an assembly uses.
// Source footage is 4K at ~60 Mbit/s while Drive delivers ~10 Mbit/s, so playing originals stalls; ffmpeg reads only
// the needed byte ranges of the original once, and the editor plays the proxy from disk afterwards.
// A proxy covers whole 5-second blocks of its clip ("<id>_<s>_<e>"), so small trims reuse it.
import fs from 'node:fs';
import path from 'node:path';
import { Router, HttpError, json, readJson, sendFile } from './http';
import { DATA_DIR, FFMPEG } from './config';
import { cutFromDrive } from './localcopy';
import { verify } from './sources';

const DIR = path.join(DATA_DIR, 'proxies');
// Two at a time: downloads share the line (one clip finishing first beats three finishing later), and one clip's
// download overlaps the other's encode.
const PARALLEL = 2;
const KEY = /^[\w-]{10,}_\d{1,5}_\d{1,5}$/;

type Item = { key: string; id: string; account: string; s: number; e: number };
const queue: Item[] = [];
const running = new Set<string>();
const failed = new Map<string, string>();

const file = (key: string) => path.join(DIR, key + '.mp4');
const status = (key: string) => (fs.existsSync(file(key)) ? 'ready' : running.has(key) || queue.some((q) => q.key === key) ? 'pending' : failed.has(key) ? 'failed' : 'none');

async function encode(it: Item) {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = file(it.key) + '.part.mp4';
  try {
    // Short side 720 px (rotation from phone metadata is applied first), 30 fps, frequent keyframes for scrubbing.
    await cutFromDrive(it.account, it.id, it.s, it.e, tmp, ['-vf', "scale='if(gt(iw,ih),-2,720)':'if(gt(iw,ih),720,-2)'", '-r', '30',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27', '-pix_fmt', 'yuv420p', '-g', '15', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart']);
    fs.renameSync(tmp, file(it.key));
  } finally { fs.rmSync(tmp, { force: true }); }
}

function pump() {
  while (running.size < PARALLEL && queue.length) {
    const it = queue.shift()!;
    if (fs.existsSync(file(it.key))) continue;
    running.add(it.key);
    encode(it).catch((e) => failed.set(it.key, String(e.message || e)))
      .finally(() => { running.delete(it.key); pump(); });
  }
}

export function registerProxies(api: Router) {
  /** Queue proxies (in timeline order); `front` puts them ahead of the rest, e.g. the clips near the playhead. */
  api.post('/api/proxies', async (req, res) => {
    if (!FFMPEG) throw new HttpError(400, 'Máy chủ chưa có ffmpeg');
    const b = await readJson(req);
    const items: Item[] = [];
    for (const x of (Array.isArray(b.items) ? b.items : []).slice(0, 2000)) {
      const id = String(x.id || ''), account = String(x.a || ''), s = Math.max(0, Math.floor(Number(x.s) || 0)), e = Math.floor(Number(x.e) || 0);
      const key = `${id}_${s}_${e}`;
      if (!KEY.test(key) || e <= s || e - s > 600) continue;
      await verify(account, id, x.sig);
      if (status(key) === 'ready' || running.has(key)) continue;
      failed.delete(key);
      const at = queue.findIndex((q) => q.key === key);
      if (at >= 0) queue.splice(at, 1);
      items.push({ key, id, account, s, e });
    }
    if (b.front) queue.unshift(...items); else queue.push(...items);
    pump();
    json(res, 200, { queued: items.length, waiting: queue.length, running: running.size });
  });
  api.post('/api/proxies/status', async (req, res) => {
    const keys: string[] = ((await readJson(req)).keys || []).filter((k: any) => typeof k === 'string' && KEY.test(k)).slice(0, 2000);
    json(res, 200, Object.fromEntries(keys.map((k) => [k, failed.has(k) && status(k) === 'failed' ? `failed: ${failed.get(k)}` : status(k)])));
  });
  api.get('/api/proxies/file/:key', async (req, res) => {
    if (!KEY.test(req.params.key) || !sendFile(req, res, DIR, req.params.key + '.mp4', { cache: 'private, max-age=31536000, immutable' })) throw new HttpError(404, 'Chưa có proxy');
  });
}
