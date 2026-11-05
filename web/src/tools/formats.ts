// What the Tools page converts: each kind of file, what it reads and what it writes. The converters themselves are
// loaded only when a file is converted (Mediabunny and the MP3 encoder are large).
export type Kind = 'video' | 'audio' | 'image' | 'subtitle' | 'table';
export type Opts = {
  /** Video: short side in px; 0 keeps it. */
  size: number;
  /** Pictures: long side in px; 0 keeps it. */
  max: number;
  quality: 'keep' | 'high' | 'medium' | 'low';
};

export const KINDS: { id: Kind; label: string; icon: string; inputs: string[]; outputs: string[]; audio?: string[] }[] = [
  { id: 'video', label: 'Video', icon: 'film', inputs: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'ts', '3gp'], outputs: ['mp4', 'mov', 'webm', 'mkv', 'gif'], audio: ['mp3', 'm4a', 'wav', 'ogg', 'aac'] },
  { id: 'audio', label: 'Âm thanh', icon: 'music', inputs: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac'], outputs: ['mp3', 'm4a', 'wav', 'ogg', 'aac'] },
  { id: 'image', label: 'Ảnh', icon: 'photo', inputs: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif', 'avif', 'bmp', 'svg', 'ico'], outputs: ['jpg', 'png', 'webp', 'gif', 'bmp', 'ico', 'pdf'] },
  { id: 'subtitle', label: 'Phụ đề', icon: 'cc', inputs: ['srt', 'vtt'], outputs: ['srt', 'vtt', 'txt'] },
  { id: 'table', label: 'Bảng tính', icon: 'sheet', inputs: ['xlsx', 'csv', 'tsv', 'json'], outputs: ['xlsx', 'csv', 'tsv', 'json'] },
];
const NAMES: Record<string, string> = { webm: 'WebM', webp: 'WebP', xlsx: 'Excel', jpeg: 'JPG', m4v: 'M4V' };
export const label = (ext: string) => NAMES[ext] || ext.toUpperCase();

export const extOf = (name: string) => (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
export const baseOf = (name: string) => name.replace(/\.[a-z0-9]+$/i, '') || 'file';
export function kindOf(file: File): Kind | null {
  const ext = extOf(file.name);
  const k = KINDS.find((x) => x.inputs.includes(ext));
  if (k) return k.id;
  // No (known) extension: go by the type the browser gives it.
  const t = file.type.split('/')[0];
  return !ext && (t === 'video' || t === 'audio' || t === 'image') ? (t as Kind) : null;
}
/** Targets for a file: the same format too for media (to shrink or resize it), not for text. */
export function outputsFor(kind: Kind, from: string, gifToMp4: boolean): { group?: string; list: string[] }[] {
  const k = KINDS.find((x) => x.id === kind)!;
  const same = kind === 'subtitle' || kind === 'table' ? k.outputs.filter((o) => o !== from) : k.outputs;
  return [{ list: kind === 'image' && from === 'gif' && gifToMp4 ? [...same, 'mp4'] : same }, ...(k.audio ? [{ group: 'Chỉ lấy âm thanh', list: k.audio }] : [])];
}
const FIRST: Record<Kind, string[]> = { video: ['mp4', 'mp3'], audio: ['mp3', 'm4a'], image: ['jpg', 'png'], subtitle: ['srt', 'vtt'], table: ['xlsx', 'csv'] };
/** The target last chosen for this kind of file, else the usual one; never the file's own format. */
export function defaultTarget(kind: Kind, from: string, last?: string) {
  const own = from === 'jpeg' ? 'jpg' : from, ok = outputsFor(kind, from, canReadGif()).flatMap((g) => g.list);
  // An animated GIF is most often wanted as a video.
  const first = from === 'gif' ? ['mp4', ...FIRST[kind]] : FIRST[kind];
  return [last, ...first].find((t) => t && t !== own && ok.includes(t)) || ok[0];
}
export const outName = (name: string, to: string) => `${baseOf(name)}.${to}`;

const JPEG_Q = { keep: 0.95, high: 0.9, medium: 0.8, low: 0.65 };
export async function convert(file: File, kind: Kind, to: string, opts: Opts, onProgress: (p: number) => void, signal: AbortSignal): Promise<{ blob: Blob; warn?: string }> {
  if (kind === 'video' || kind === 'audio' || to === 'mp4') {
    const { convertMedia } = await import('./media');
    return convertMedia(file, to, { size: opts.size, quality: opts.quality, onProgress, signal });
  }
  if (kind === 'image') {
    const { convertImage } = await import('./image');
    return { blob: await convertImage(file, to, { max: opts.max, quality: JPEG_Q[opts.quality] }) };
  }
  const text = await import('./text');
  return { blob: kind === 'subtitle' ? await text.convertSubtitle(file, to) : await text.convertTable(file, extOf(file.name), to) };
}
/** Several pictures as one PDF, a page each. */
export async function imagesToPdf(files: File[], opts: Opts) {
  const { toCanvas, pdf } = await import('./image');
  const pages: HTMLCanvasElement[] = [];
  for (const f of files) pages.push(await toCanvas(f, opts.max || 3000));
  return pdf(pages, JPEG_Q[opts.quality]);
}
export async function zipAll(files: { name: string; blob: Blob }[]) {
  const { zip } = await import('./zip');
  const seen = new Map<string, number>();
  return zip(await Promise.all(files.map(async (f) => {
    const n = (seen.get(f.name) || 0) + 1;
    seen.set(f.name, n);
    return { name: n > 1 ? `${baseOf(f.name)} (${n}).${extOf(f.name)}` : f.name, data: new Uint8Array(await f.blob.arrayBuffer()) };
  })));
}
export const canReadGif = () => typeof (window as any).ImageDecoder === 'function';
