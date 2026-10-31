// Background job runner: generation jobs survive page reloads and server restarts.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { all, get, run, uid, now } from './db';
import { ASSET_DIR, FFMPEG, CLOUD_STORAGE_ONLY } from './config';
import { HttpError } from './http';
import { submitJob, pollJob, type Done } from './providers/media';

const pexec = promisify(execFile);
const POLL_EVERY = 5000;
const TIMEOUT = 25 * 60 * 1000;
const inflight = new Set<string>();

const EXT: Record<string, string> = {
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'image/png': 'png', 'image/jpeg': 'jpg',
  'image/webp': 'webp', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg',
};

export function assetUrl(file: string) { return `/assets/${file}`; }

export async function saveAsset(buf: Buffer, mime: string, o: { projectId?: string | null; kind: string; source?: string; meta?: any }) {
  if (CLOUD_STORAGE_ONLY) throw new HttpError(400, 'Bản cloud miễn phí lưu video qua Google Drive trong mục Khách hàng.');
  const id = uid('a_');
  const file = `${id}.${EXT[mime] || 'bin'}`;
  await fs.writeFile(path.join(ASSET_DIR, file), buf);
  await run('INSERT INTO assets(id, project_id, kind, mime, file, bytes, source, meta, created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    id, o.projectId ?? null, o.kind, mime, file, buf.length, o.source ?? null, JSON.stringify(o.meta ?? {}), now());
  return { id, file, url: assetUrl(file), mime };
}

async function materialize(done: Done): Promise<{ buf: Buffer; mime: string }> {
  if (done.buffer) return { buf: done.buffer, mime: done.mime || 'application/octet-stream' };
  if (!done.url) throw new Error('Không có file kết quả');
  const res = await fetch(done.url);
  if (!res.ok) throw new Error(`Tải file kết quả thất bại (${res.status})`);
  let mime = (res.headers.get('content-type') || done.mime || '').split(';')[0].trim();
  if (!EXT[mime]) {
    const ext = new URL(done.url).pathname.split('.').pop()?.toLowerCase();
    mime = Object.entries(EXT).find(([, e]) => e === ext)?.[0] || done.mime || 'video/mp4';
  }
  return { buf: Buffer.from(await res.arrayBuffer()), mime };
}

// Write the finished asset into the project's scene so the result is kept even if the editor is closed.
async function attachToProject(job: any, result: any) {
  if (!job.project_id || !job.scene_id) return;
  const row = await get<any>('SELECT data FROM projects WHERE id = ?', job.project_id);
  if (!row) return;
  const data = JSON.parse(row.data);
  const scene = data.storyboard?.scenes?.find((s: any) => s.id === job.scene_id);
  if (!scene) return;
  const field = job.kind === 'tts' ? 'voice' : 'media';
  scene[field] = result;
  await run('UPDATE projects SET data = ?, updated_at = ? WHERE id = ?', JSON.stringify(data), now(), job.project_id);
}

const stillRunning = async (id: string) => (await get<any>('SELECT status FROM jobs WHERE id = ?', id))?.status === 'running';

async function finish(job: any, done: Done) {
  const { buf, mime } = await materialize(done);
  if (!await stillRunning(job.id)) return; // cancelled while the result was downloading
  const kind = job.kind === 'tts' ? 'audio' : job.kind;
  const a = await saveAsset(buf, mime, { projectId: job.project_id, kind, source: `${job.provider}/${job.model}` });
  const input = JSON.parse(job.input);
  const result = {
    type: kind, assetId: a.id, url: a.url, mime, provider: job.provider, model: job.model,
    ...(job.kind === 'tts' ? { text: input.prompt } : { prompt: input.prompt }),
  };
  const r = await run("UPDATE jobs SET status='succeeded', result=?, updated_at=? WHERE id=? AND status='running'", JSON.stringify(result), now(), job.id);
  if (Number(r.changes) === 0) { await discardAsset(a.id, a.file); return; }
  await attachToProject(job, result);
}

async function discardAsset(id: string, file: string) {
  await run('DELETE FROM assets WHERE id = ?', id);
  await fs.unlink(path.join(ASSET_DIR, file)).catch(() => {});
}

async function fail(job: any, e: any) {
  await run("UPDATE jobs SET status='failed', error=?, updated_at=? WHERE id=? AND status IN ('queued','running')", String(e?.message || e).slice(0, 1000), now(), job.id);
  // A failed MP4 conversion keeps the original upload, so the render is still usable as-is.
  if (job.kind === 'transcode') await run("UPDATE renders SET status='ready' WHERE asset_id=? AND status='processing'", JSON.parse(job.input).assetId);
}

async function transcode(job: any) {
  const input = JSON.parse(job.input);
  const src = path.join(ASSET_DIR, input.file);
  const outFile = input.file.replace(/\.\w+$/, '') + '.mp4';
  await pexec(FFMPEG, ['-y', '-loglevel', 'error', '-i', src, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', path.join(ASSET_DIR, outFile)], { maxBuffer: 1 << 24 });
  const st = await fs.stat(path.join(ASSET_DIR, outFile));
  await run("UPDATE assets SET file=?, mime='video/mp4', bytes=? WHERE id=?", outFile, st.size, input.assetId);
  await fs.unlink(src).catch(() => {});
  await run("UPDATE jobs SET status='succeeded', result=?, updated_at=? WHERE id=?", JSON.stringify({ url: assetUrl(outFile), mime: 'video/mp4' }), now(), job.id);
}

async function step(job: any) {
  try {
    if (job.status === 'queued') {
      await run("UPDATE jobs SET status='running', updated_at=? WHERE id=?", now(), job.id);
      if (job.kind === 'transcode') return await transcode(job);
      const r = await submitJob(job.provider, job.model, job.kind, JSON.parse(job.input));
      if (r.done) return await finish(job, r.done);
      await run('UPDATE jobs SET remote_id=?, remote_meta=?, polled_at=?, updated_at=? WHERE id=?',
        r.remoteId ?? null, JSON.stringify(r.meta ?? {}), now(), now(), job.id);
      return;
    }
    if (job.status === 'running' && job.remote_id) {
      if (now() - job.polled_at < POLL_EVERY) return;
      if (now() - job.created_at > TIMEOUT) return await fail(job, 'Quá thời gian chờ (25 phút)');
      await run('UPDATE jobs SET polled_at=? WHERE id=?', now(), job.id);
      const r = await pollJob(job.provider, job.remote_id, JSON.parse(job.remote_meta || '{}'));
      if (r.status === 'succeeded' && r.done) await finish(job, r.done);
      else if (r.status === 'failed') await fail(job, r.error || 'Thất bại');
    }
  } catch (e) {
    await fail(job, e);
  }
}

export async function startWorker() {
  // Jobs that were mid-submit when the server stopped can't be resumed safely.
  await run("UPDATE jobs SET status='failed', error='Server khởi động lại trong lúc gửi yêu cầu' WHERE status='running' AND remote_id IS NULL");
  await run("UPDATE renders SET status='ready' WHERE status='processing' AND asset_id NOT IN (SELECT json_extract(input, '$.assetId') FROM jobs WHERE kind='transcode' AND status IN ('queued','running'))");
  let polling = false;
  setInterval(async () => {
    if (polling || CLOUD_STORAGE_ONLY) return;
    polling = true;
    try {
      for (const job of await all<any>("SELECT * FROM jobs WHERE status IN ('queued','running') ORDER BY created_at LIMIT 20")) {
        if (inflight.has(job.id)) continue;
        inflight.add(job.id);
        step(job).catch((e) => console.error('Job failed:', e.message)).finally(() => inflight.delete(job.id));
      }
    } catch (e: any) {
      console.error('Không đọc được hàng đợi:', e.message);
    } finally { polling = false; }
  }, 1000).unref?.();
}

export async function createJob(o: { projectId?: string; sceneId?: string; kind: string; provider: string; model: string; input: any }) {
  if (CLOUD_STORAGE_ONLY) throw new HttpError(400, 'Tạo media cần ổ lưu trữ bền vững; bản cloud miễn phí dùng video trên Google Drive.');
  const id = uid('j_');
  await run('INSERT INTO jobs(id, project_id, scene_id, kind, provider, model, input, status, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    id, o.projectId ?? null, o.sceneId ?? null, o.kind, o.provider, o.model ?? '', JSON.stringify(o.input), 'queued', now(), now());
  return id;
}

export function publicJob(j: any) {
  return {
    id: j.id, projectId: j.project_id, sceneId: j.scene_id, kind: j.kind, provider: j.provider, model: j.model,
    status: j.status, error: j.error, result: j.result ? JSON.parse(j.result) : null,
    prompt: JSON.parse(j.input).prompt, createdAt: j.created_at, updatedAt: j.updated_at,
  };
}
