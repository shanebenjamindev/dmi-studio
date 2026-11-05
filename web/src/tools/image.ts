// Pictures: decoded by the browser (HEIC by Safari, elsewhere by heic.ts), drawn on a canvas, then
// written as JPG, PNG or WebP by the browser, as GIF with gifenc, or as BMP, ICO and PDF by the small writers below.
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

export const HEIC = /\.(heic|heif)$/i;

/** The picture on a canvas, its longest side at most `max` px (0: as it is). */
export async function toCanvas(file: Blob & { name?: string }, max = 0) {
  const url = URL.createObjectURL(file);
  try {
    let src: HTMLImageElement | HTMLCanvasElement = new Image();
    src.src = url;
    try { await src.decode(); } catch {
      if (!HEIC.test(file.name || '')) throw new Error('Không đọc được ảnh này');
      // Safari opens HEIC itself; other browsers go through their HEVC video decoder.
      src = await (await import('./heic')).heicToCanvas(file);
    }
    // An SVG without a size of its own is drawn at 1024 px.
    let w = (src instanceof HTMLImageElement ? src.naturalWidth : src.width) || 1024;
    let h = (src instanceof HTMLImageElement ? src.naturalHeight : src.height) || 1024;
    if (max && Math.max(w, h) > max) { const k = max / Math.max(w, h); w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k)); }
    else if (src instanceof HTMLCanvasElement) return src;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, w, h);
    return c;
  } finally { URL.revokeObjectURL(url); }
}
/** A copy on white: for formats without transparency. */
function flat(src: HTMLCanvasElement) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0);
  return c;
}
const pixels = (c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
function encode(c: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((ok, fail) => c.toBlob((b) => {
    // A browser that cannot write the type hands back a PNG instead.
    if (!b) fail(new Error('Không xuất được ảnh'));
    else if (b.type !== type) fail(new Error(`Trình duyệt này không xuất được ${type.split('/')[1].toUpperCase()} — hãy dùng Chrome`));
    else ok(b);
  }, type, quality));
}
const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

function gif(c: HTMLCanvasElement) {
  const data = pixels(c);
  const palette = quantize(data, 256, { format: 'rgba4444', oneBitAlpha: true });
  const clear = palette.findIndex((p: number[]) => p[3] === 0);
  const g = GIFEncoder();
  g.writeFrame(applyPalette(data, palette, 'rgba4444'), c.width, c.height, { palette, transparent: clear >= 0, transparentIndex: Math.max(0, clear) });
  g.finish();
  return new Blob([g.bytes()], { type: 'image/gif' });
}
/** 24-bit BMP, rows bottom-up, each padded to 4 bytes. */
function bmp(src: HTMLCanvasElement) {
  const { width: w, height: h } = src, d = pixels(flat(src)), stride = (w * 3 + 3) & ~3;
  const v = new DataView(new ArrayBuffer(54 + stride * h));
  v.setUint16(0, 0x4d42, true); v.setUint32(2, v.byteLength, true); v.setUint32(10, 54, true); v.setUint32(14, 40, true);
  v.setInt32(18, w, true); v.setInt32(22, h, true); v.setUint16(26, 1, true); v.setUint16(28, 24, true);
  v.setUint32(34, stride * h, true); v.setInt32(38, 2835, true); v.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) {
    let o = 54 + (h - 1 - y) * stride;
    for (let x = 0, p = y * w * 4; x < w; x++, p += 4) { v.setUint8(o++, d[p + 2]); v.setUint8(o++, d[p + 1]); v.setUint8(o++, d[p]); }
  }
  return new Blob([v], { type: 'image/bmp' });
}
/** An icon with every standard size up to the picture's own, each a square PNG (the picture centred, transparent around it). */
async function ico(src: HTMLCanvasElement) {
  const sizes = [16, 24, 32, 48, 64, 128, 256].filter((s) => s <= Math.max(src.width, src.height, 16));
  const pngs = await Promise.all(sizes.map(async (s) => {
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const k = s / Math.max(src.width, src.height), w = src.width * k, h = src.height * k;
    const g = c.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, (s - w) / 2, (s - h) / 2, w, h);
    return bytes(await encode(c, 'image/png'));
  }));
  const head = new DataView(new ArrayBuffer(6 + 16 * sizes.length));
  head.setUint16(2, 1, true); head.setUint16(4, sizes.length, true);
  let off = head.byteLength;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    head.setUint8(e, s & 0xff); head.setUint8(e + 1, s & 0xff); head.setUint16(e + 4, 1, true); head.setUint16(e + 6, 32, true);
    head.setUint32(e + 8, pngs[i].length, true); head.setUint32(e + 12, off, true);
    off += pngs[i].length;
  });
  return new Blob([head, ...pngs.map((p) => p as BlobPart)], { type: 'image/x-icon' });
}

/** A PDF with one page per picture (JPEG inside), each page the picture's shape with its long side as long as A4's. */
export async function pdf(canvases: HTMLCanvasElement[], quality: number) {
  const enc = new TextEncoder(), parts: Uint8Array[] = [], offsets: number[] = [];
  let size = 0;
  const put = (x: string | Uint8Array) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); size += b.length; };
  const obj = (n: number, body: string) => { offsets[n] = size; put(`${n} 0 obj\n${body}\nendobj\n`); };
  put('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  const n = canvases.length;
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${n} /Kids [${canvases.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] >>`);
  for (const [i, c] of canvases.entries()) {
    const jpg = await bytes(await encode(flat(c), 'image/jpeg', quality));
    const k = 842 / Math.max(c.width, c.height), W = +(c.width * k).toFixed(2), H = +(c.height * k).toFixed(2);
    const page = 3 + 3 * i, img = page + 1, content = page + 2, draw = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${content} 0 R >>`);
    offsets[img] = size;
    put(`${img} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
    put(jpg);
    put('\nendstream\nendobj\n');
    obj(content, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
  }
  const xref = size, count = 3 + 3 * n;
  put(`xref\n0 ${count}\n0000000000 65535 f \n${offsets.slice(1, count).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
  put(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}

export async function convertImage(file: File, to: string, opts: { max: number; quality: number }) {
  const c = await toCanvas(file, opts.max);
  switch (to) {
    case 'jpg': return encode(flat(c), 'image/jpeg', opts.quality);
    case 'png': return encode(c, 'image/png');
    case 'webp': return encode(c, 'image/webp', opts.quality);
    case 'gif': return gif(c);
    case 'bmp': return bmp(c);
    case 'ico': return ico(c);
    case 'pdf': return pdf([c], opts.quality);
  }
  throw new Error('Không hỗ trợ định dạng này');
}
