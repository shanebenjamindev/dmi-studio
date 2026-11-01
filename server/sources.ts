// Source footage from Google Drive: paste a folder link, Claude looks at every thumbnail and keeps only
// the clips/photos that fit the brief (or a chat edit), placing each one behind the scene it suits.
// Files are streamed from Drive on demand; every URL is signed so the API can't be used to read arbitrary Drive files.
import crypto from 'node:crypto';
import { Router, HttpError, json, readJson } from './http';
import { getSetting, setSetting } from './db';
import * as G from './google';
import { STORYBOARD_SCHEMA } from './storyboard';
import type { PromptImage } from './providers/llm';

const MAX_SOURCES = 150;
const MAX_FOLDERS = 60;

export interface Source {
  id: string; account: string; sig: string; name: string; kind: 'video' | 'image'; mime: string;
  duration?: number; folder: string; url: string; thumb: string;
  /** The script row of the request sheet that asked for this clip. */
  row?: string;
}

// ---------------------------------------------------------------- signing
let secret: string | null = null;
async function key() {
  if (!secret) {
    secret = await getSetting<string>('source_secret', '');
    if (!secret) { secret = crypto.randomBytes(32).toString('hex'); await setSetting('source_secret', secret); }
  }
  return secret;
}
const sign = async (account: string, id: string) => crypto.createHmac('sha256', await key()).update(`${account}\n${id}`).digest('base64url').slice(0, 32);
export async function verify(account: string, id: string, sig: unknown) {
  const want = Buffer.from(await sign(account, id));
  const got = Buffer.from(String(sig || ''));
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) throw new HttpError(403, 'Link source không hợp lệ');
}
/** Sources sent back by the browser: keep only the fields we trust, after checking each signature. */
export async function checkSources(list: any): Promise<Source[]> {
  if (!Array.isArray(list)) return [];
  const out: Source[] = [];
  for (const s of list.slice(0, MAX_SOURCES)) {
    await verify(String(s.account), String(s.id), s.sig);
    const src = await sourceOut(String(s.account), {
      id: String(s.id), name: String(s.name || ''), mimeType: String(s.mime || ''), videoMediaMetadata: s.duration ? { durationMillis: String(s.duration * 1000) } : undefined,
    }, String(s.folder || ''));
    out.push(s.row ? { ...src, row: String(s.row).slice(0, 200) } : src);
  }
  return out;
}

export async function sourceOut(account: string, f: Pick<G.GFile, 'id' | 'name' | 'mimeType' | 'videoMediaMetadata'>, folder: string): Promise<Source> {
  const sig = await sign(account, f.id);
  const q = `a=${encodeURIComponent(account)}&sig=${sig}`;
  const ms = Number(f.videoMediaMetadata?.durationMillis);
  return {
    id: f.id, account, sig, name: f.name, kind: f.mimeType.startsWith('video/') ? 'video' : 'image', mime: f.mimeType,
    ...(ms ? { duration: Math.round(ms / 100) / 10 } : {}), folder,
    url: `/api/sources/${encodeURIComponent(f.id)}?${q}`, thumb: `/api/sources/${encodeURIComponent(f.id)}/thumb?${q}`,
  };
}

// ---------------------------------------------------------------- scanning a Drive link
/** Folder or file id from any Drive URL shape (…/folders/ID, …/file/d/ID/view, ?id=ID) or a bare id. */
export function driveId(link: string) {
  const s = String(link || '').trim();
  const m = s.match(/\/folders\/([\w-]{10,})/) || s.match(/\/d\/([\w-]{10,})/) || s.match(/[?&]id=([\w-]{10,})/);
  if (m) return m[1];
  return /^[\w-]{10,}$/.test(s) ? s : '';
}

export async function locate(id: string) {
  const accounts = await G.accounts();
  if (!accounts.length) throw new HttpError(400, 'Chưa kết nối tài khoản Google Drive nào. Quản trị viên hãy kết nối trong trang Khách hàng.');
  const fields = 'id,name,mimeType,videoMediaMetadata(durationMillis),thumbnailLink,shortcutDetails(targetId,targetMimeType)';
  for (const a of accounts) {
    let file: G.GFile;
    try { file = await G.meta(a.email, id, fields) as G.GFile; }
    catch { continue; } // not visible to this account
    // A link to a shortcut opens what it points at (folder, clip, photo or sheet).
    if (file.mimeType === G.SHORTCUT_MIME && file.shortcutDetails) {
      try { file = { ...await G.meta(a.email, file.shortcutDetails.targetId, fields) as G.GFile, name: file.name }; }
      catch { throw new HttpError(404, 'Lối tắt này trỏ tới file đã bị xoá hoặc chưa được chia sẻ'); }
    }
    return { account: a.email, file };
  }
  throw new HttpError(404, `Không mở được link này bằng tài khoản Google đã kết nối (${accounts.map((a) => a.email).join(', ')}). Hãy chia sẻ link (quyền Người xem) cho một trong các tài khoản đó.`);
}

export async function scan(link: string) {
  const id = driveId(link);
  if (!id) throw new HttpError(400, 'Link Google Drive không hợp lệ');
  const { account, file } = await locate(id);
  if (file.mimeType !== G.FOLDER_MIME) {
    if (!file.mimeType.startsWith('video/')) throw new HttpError(400, 'Link này không phải thư mục hay video');
    G.rememberThumb(file.id, file.thumbnailLink);
    return { folder: file.name, account, total: 1, sources: [await sourceOut(account, file, '')] };
  }
  // Walk sub-folders breadth-first; each file remembers the path of the folder it came from.
  const paths = new Map<string, string>([[file.id, '']]);
  let level = [file.id];
  while (level.length && paths.size < MAX_FOLDERS) {
    const next: string[] = [];
    for (const parent of level) {
      for (const d of await G.listFoldersDeep(account, parent)) {
        if (paths.size >= MAX_FOLDERS) break;
        if (paths.has(d.id)) continue; // folder shortcuts can loop back
        paths.set(d.id, [paths.get(parent), d.name].filter(Boolean).join('/'));
        next.push(d.id);
      }
    }
    level = next;
  }
  const files = (await G.listMediaIn(account, [...paths.keys()])).filter((f) => f.mimeType.startsWith('video/')); // video only
  const sources: Source[] = [];
  for (const f of files.slice(0, MAX_SOURCES)) {
    G.rememberThumb(f.id, f.thumbnailLink);
    sources.push(await sourceOut(account, f, paths.get(f.parents?.[0] || '') || ''));
  }
  return { folder: file.name, account, total: files.length, sources };
}

// ---------------------------------------------------------------- prompting
const label = (i: number) => `s${i + 1}`;

export const SOURCE_SCHEMA = {
  ...STORYBOARD_SCHEMA,
  properties: {
    ...STORYBOARD_SCHEMA.properties,
    scenes: {
      ...STORYBOARD_SCHEMA.properties.scenes,
      items: {
        ...STORYBOARD_SCHEMA.properties.scenes.items,
        properties: { ...STORYBOARD_SCHEMA.properties.scenes.items.properties, source: { type: 'string', description: 'Label of the source shown behind this scene (e.g. "s3"), or "" for none.' } },
        required: [...STORYBOARD_SCHEMA.properties.scenes.items.required, 'source'],
      },
    },
    picked: {
      type: 'array', description: 'Every source used, with a short reason in the language of the brief.',
      items: { type: 'object', properties: { source: { type: 'string' }, reason: { type: 'string' } }, required: ['source', 'reason'] },
    },
  },
  required: [...STORYBOARD_SCHEMA.required, 'picked'],
};

const RULES = `SOURCE FOOTAGE: the client's own clips and photos from Google Drive are shown above, one thumbnail per label (s1…sN; for videos the thumbnail is a single frame).
1. Filter: use only sources that clearly fit the brief / edit request. Skip unrelated, blurry, near-duplicate or off-topic ones.
2. For every scene set "source" to the label of the best matching source (prefer videos for motion), or "" when nothing fits (the animated background is used then). Use each source at most once unless there are fewer good sources than scenes.
3. A scene that shows a video should not be longer than that clip.
4. "visual_prompt": describe in English what the chosen source shows.
5. In "picked", list every source you used with a short reason.`;

export const FOOTAGE = 'CLIENT FOOTAGE: the clips and photos shown above, one thumbnail per label (s1…sN; a video shows one frame, its length is listed).';
export async function sourcePrompt(sources: Source[], userContent: string, rules = RULES) {
  const lines = sources.map((s, i) => `${label(i)} · ${s.kind === 'video' ? `video ${s.duration ? s.duration + 's' : ''}` : 'ảnh'} · "${s.name}"${s.folder ? ` · thư mục ${s.folder}` : ''}`);
  const images: PromptImage[] = [];
  let next = 0;
  const work = async () => {
    for (let i = next++; i < sources.length; i = next++) {
      const s = sources[i];
      try {
        const t = await G.thumbBuffer(s.account, s.id);
        images[i] = { label: `${lines[i]}:`, mime: t.type.split(';')[0], data: t.body };
      } catch { /* no thumbnail yet (e.g. a clip Drive is still processing): the model gets its name only */ }
    }
  };
  await Promise.all(Array.from({ length: 8 }, work));
  const blind = sources.map((_, i) => i).filter((i) => !images[i]);
  const text = [
    blind.length ? `Sources without a thumbnail (judge by name):\n${blind.map((i) => lines[i]).join('\n')}\n` : '',
    rules, '', userContent,
  ].join('\n');
  return { text, images: images.filter(Boolean) };
}

/** Current scene → source label, so a chat edit knows what each scene already shows. */
export function withSourceLabels(sb: any, sources: Source[]) {
  const at = new Map(sources.map((s, i) => [s.id, label(i)]));
  const lab = (m: any) => (m?.provider === 'drive' ? at.get(m.assetId) || '' : '');
  if (sb.mode === 'edit') { // an edit: shots and logo as labels, the shape the model answers in
    return {
      title: sb.title,
      scenes: (sb.scenes || []).map((s: any) => ({
        caption: s.caption, note: s.visual_prompt || '',
        shots: (s.shots || []).map((x: any) => ({ source: lab(x.media), from: x.from || 0, dur: x.dur, why: '' })),
      })),
    };
  }
  return { ...sb, scenes: (sb.scenes || []).map((s: any) => ({ ...s, source: lab(s.media) })) };
}

export const refOf = (s: Source) => ({ type: s.kind, assetId: s.id, url: s.url, mime: s.mime, provider: 'drive', prompt: s.name, ...(s.duration ? { duration: s.duration } : {}) });
const WPS = 2.6; // spoken words per second

/**
 * The model's assembly → a storyboard in edit mode: shot labels become clips with in-points kept inside the clip,
 * scene length = its shots. No text, logo or music: the editor adds those. Returns what was used and why.
 */
export function applyEdit(raw: any, sources: Source[]) {
  const by = new Map(sources.map((s, i) => [label(i), s]));
  const used = new Map<string, string>();
  const scenes = (raw.scenes || []).map((sc: any) => {
    const shots = (sc.shots || []).map((x: any) => {
      const s = by.get(String(x.source || '').trim());
      if (!s) return null;
      const dur = Math.min(10, Math.max(0.3, Number(x.dur) || 1.5));
      const room = s.kind === 'video' && s.duration ? Math.max(0, s.duration - dur) : 0;
      if (!used.has(s.name)) used.set(s.name, String(x.why || ''));
      return { media: refOf(s), from: Math.min(room, Math.max(0, Number(x.from) || 0)), dur, move: 'none' };
    }).filter(Boolean);
    const words = String(sc.caption || '').split(/\s+/).filter(Boolean).length;
    const duration = Math.round((shots.reduce((a: number, x: any) => a + x.dur, 0) || Math.max(2, words / WPS)) * 100) / 100;
    const note = String(sc.note || '');
    return {
      layout: 'title', animation: 'fade', background: 'solid', icon: '',
      headline: note.slice(0, 60), subtext: '', caption: String(sc.caption || ''), visual_prompt: note,
      duration, shots, texts: [], media: shots[0]?.media || null,
    };
  });
  const sb = { title: raw.title, font: 'sans', music: { mood: 'none', bpm: 96 }, mode: 'edit', logo: null, scenes };
  return { storyboard: sb, picked: [...used].map(([name, reason]) => ({ name, reason })) };
}

/** Turn the model's source labels into scene media and a readable list of what was picked. */
export function applySources(raw: any, sources: Source[]) {
  const by = new Map(sources.map((s, i) => [label(i), s]));
  for (const scene of raw.scenes || []) {
    const s = by.get(String(scene.source || '').trim());
    scene.media = s ? { type: s.kind, assetId: s.id, url: s.url, mime: s.mime, provider: 'drive', prompt: s.name, ...(s.duration ? { duration: s.duration } : {}) } : null;
    delete scene.source;
  }
  const picked = (raw.picked || []).map((p: any) => ({ name: by.get(String(p.source).trim())?.name, reason: String(p.reason || '') })).filter((p: any) => p.name);
  delete raw.picked;
  return picked as { name: string; reason: string }[];
}

// ---------------------------------------------------------------- routes
export function registerSources(api: Router) {
  api.post('/api/sources/scan', async (req, res) => json(res, 200, await scan((await readJson(req)).link)));
  api.get('/api/sources/:id', async (req, res) => {
    const a = req.query.get('a') || '';
    await verify(a, req.params.id, req.query.get('sig'));
    await G.streamFile(a, req.params.id, req, res);
  });
  api.get('/api/sources/:id/thumb', async (req, res) => {
    const a = req.query.get('a') || '';
    await verify(a, req.params.id, req.query.get('sig'));
    await G.streamThumb(a, req.params.id, res);
  });
}
