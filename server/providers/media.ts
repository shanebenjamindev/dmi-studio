// Video / image / voice generation adapters.
// Async platforms use submit() + poll(); synchronous ones return the file straight from submit().
import { getKey, findProvider } from './registry';
import { ProviderError } from './llm';
import { mockMedia } from './mock';

export interface JobInput {
  prompt: string;
  aspect?: string;      // 16:9 | 9:16 | 1:1
  duration?: number;    // seconds wanted
  voice?: string;
  instructions?: string;
}
export type Done = { url?: string; buffer?: Buffer; mime?: string };
export type SubmitResult = { remoteId?: string; meta?: any; done?: Done };
export type PollResult = { status: 'running' | 'succeeded' | 'failed'; done?: Done; error?: string };

async function err(res: Response, who: string) {
  const text = await res.text();
  let msg = text.slice(0, 400);
  try { const j = JSON.parse(text); msg = j?.error?.message || j?.message || (typeof j?.detail === 'string' ? j.detail : JSON.stringify(j?.detail ?? j)); } catch { /* raw */ }
  return new ProviderError(`${who}: ${msg}`, res.status);
}

const ARK_BASE = () => (process.env.ARK_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3').replace(/\/$/, '');

// ------------------------------------------------------------------- Seedance (BytePlus ModelArk)
const seedance = {
  async submit(model: string, key: string, i: JobInput): Promise<SubmitResult> {
    const dur = (i.duration || 5) > 7 ? 10 : 5;
    const flags = `--ratio ${i.aspect || '16:9'} --duration ${dur} --resolution 720p --watermark false`;
    const res = await fetch(`${ARK_BASE()}/contents/generations/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, content: [{ type: 'text', text: `${i.prompt} ${flags}` }] }),
    });
    if (!res.ok) throw await err(res, 'Seedance');
    const j: any = await res.json();
    if (!j.id) throw new ProviderError('Seedance không trả về task id');
    return { remoteId: j.id };
  },
  async poll(remoteId: string, key: string): Promise<PollResult> {
    const res = await fetch(`${ARK_BASE()}/contents/generations/tasks/${remoteId}`, { headers: { authorization: `Bearer ${key}` } });
    if (!res.ok) throw await err(res, 'Seedance');
    const j: any = await res.json();
    if (j.status === 'succeeded') return { status: 'succeeded', done: { url: j.content?.video_url, mime: 'video/mp4' } };
    if (j.status === 'failed' || j.status === 'cancelled') return { status: 'failed', error: j.error?.message || j.status };
    return { status: 'running' };
  },
};

// ------------------------------------------------------------------- Higgsfield
const higgsfield = {
  async submit(model: string, key: string, i: JobInput): Promise<SubmitResult> {
    const res = await fetch(`https://api.higgsfield.ai/${model.replace(/^\//, '')}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Key ${key}`, 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({
        prompt: i.prompt,
        duration: Math.max(3, Math.min(15, Math.round(i.duration || 5))),
        resolution: '720p',
        aspect_ratio: i.aspect || '16:9',
      }),
    });
    if (!res.ok) throw await err(res, 'Higgsfield');
    const j: any = await res.json();
    if (!j.request_id) throw new ProviderError('Higgsfield không trả về request_id');
    return { remoteId: j.request_id, meta: { status_url: j.status_url } };
  },
  async poll(remoteId: string, key: string, meta: any): Promise<PollResult> {
    const url = meta?.status_url || `https://api.higgsfield.ai/requests/${remoteId}/status`;
    const res = await fetch(url, { headers: { authorization: `Key ${key}` } });
    if (!res.ok) throw await err(res, 'Higgsfield');
    const j: any = await res.json();
    const st = String(j.status || '').toLowerCase();
    if (st === 'completed') {
      const u = j.video?.url || j.result?.video?.url || j.images?.[0]?.url;
      return u ? { status: 'succeeded', done: { url: u } } : { status: 'failed', error: 'Higgsfield hoàn tất nhưng không có video.url' };
    }
    if (['failed', 'nsfw', 'canceled', 'cancelled', 'error'].includes(st)) return { status: 'failed', error: j.error || j.detail || st };
    return { status: 'running' };
  },
};

// ------------------------------------------------------------------- fal.ai queue (video + image)
const fal = {
  async submit(model: string, key: string, i: JobInput, kind: string): Promise<SubmitResult> {
    const body: any = { prompt: i.prompt };
    if (kind === 'image') {
      body.image_size = i.aspect === '9:16' ? 'portrait_16_9' : i.aspect === '1:1' ? 'square_hd' : 'landscape_16_9';
    } else {
      body.aspect_ratio = i.aspect || '16:9';
      if (/kling|seedance/.test(model)) body.duration = (i.duration || 5) > 7 ? '10' : '5';
    }
    const res = await fetch(`https://queue.fal.run/${model.replace(/^\//, '')}`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Key ${key}` }, body: JSON.stringify(body),
    });
    if (!res.ok) throw await err(res, 'fal.ai');
    const j: any = await res.json();
    return { remoteId: j.request_id, meta: { status_url: j.status_url, response_url: j.response_url } };
  },
  async poll(remoteId: string, key: string, meta: any): Promise<PollResult> {
    const h = { authorization: `Key ${key}` };
    const res = await fetch(meta.status_url, { headers: h });
    if (!res.ok) throw await err(res, 'fal.ai');
    const j: any = await res.json();
    if (j.status === 'COMPLETED') {
      const r = await fetch(meta.response_url, { headers: h });
      if (!r.ok) throw await err(r, 'fal.ai');
      const out: any = await r.json();
      const u = out.video?.url || out.images?.[0]?.url || out.image?.url;
      return u ? { status: 'succeeded', done: { url: u } } : { status: 'failed', error: 'fal.ai không trả về file' };
    }
    if (j.status === 'FAILED' || j.error) return { status: 'failed', error: j.error || 'failed' };
    return { status: 'running' };
  },
};

// ------------------------------------------------------------------- OpenAI image + TTS (synchronous)
const OPENAI_BASE = () => process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const openaiImage = {
  async submit(model: string, key: string, i: JobInput): Promise<SubmitResult> {
    const size = i.aspect === '9:16' ? '1024x1536' : i.aspect === '1:1' ? '1024x1024' : '1536x1024';
    const res = await fetch(`${OPENAI_BASE()}/images/generations`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, prompt: i.prompt, size, n: 1 }),
    });
    if (!res.ok) throw await err(res, 'GPT Image');
    const j: any = await res.json();
    const d = j.data?.[0];
    if (d?.b64_json) return { done: { buffer: Buffer.from(d.b64_json, 'base64'), mime: 'image/png' } };
    if (d?.url) return { done: { url: d.url } };
    throw new ProviderError('GPT Image không trả về ảnh');
  },
};
const openaiTts = {
  async submit(model: string, key: string, i: JobInput): Promise<SubmitResult> {
    const res = await fetch(`${OPENAI_BASE()}/audio/speech`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, voice: i.voice || 'alloy', input: i.prompt, instructions: i.instructions || undefined, response_format: 'mp3' }),
    });
    if (!res.ok) throw await err(res, 'OpenAI TTS');
    return { done: { buffer: Buffer.from(await res.arrayBuffer()), mime: 'audio/mpeg' } };
  },
};

// ------------------------------------------------------------------- dispatch
export async function submitJob(providerId: string, model: string, kind: string, input: JobInput): Promise<SubmitResult> {
  const p = findProvider(providerId);
  if (!p) throw new ProviderError('Không rõ nhà cung cấp ' + providerId, 400);
  if (p.kind !== kind) throw new ProviderError(`${p.name} không hỗ trợ loại "${kind}"`, 400);
  if (p.mock) return { done: await mockMedia(kind, input) };
  const key = await getKey(p.keyEnv);
  if (!key) throw new ProviderError(`Chưa có API key cho ${p.name} (${p.keyEnv}).`, 400);
  if (!input.prompt?.trim()) throw new ProviderError('Thiếu prompt.', 400);
  switch (providerId) {
    case 'seedance': return seedance.submit(model, key, input);
    case 'higgsfield': return higgsfield.submit(model, key, input);
    case 'fal': case 'fal-image': return fal.submit(model, key, input, kind);
    case 'openai-image': return openaiImage.submit(model, key, input);
    case 'openai-tts': return openaiTts.submit(model, key, input);
  }
  throw new ProviderError('Chưa có adapter cho ' + providerId, 400);
}

export async function pollJob(providerId: string, remoteId: string, meta: any): Promise<PollResult> {
  const p = findProvider(providerId)!;
  const key = await getKey(p.keyEnv);
  switch (providerId) {
    case 'seedance': return seedance.poll(remoteId, key);
    case 'higgsfield': return higgsfield.poll(remoteId, key, meta);
    case 'fal': case 'fal-image': return fal.poll(remoteId, key, meta);
  }
  return { status: 'failed', error: 'Nhà cung cấp không hỗ trợ polling' };
}
