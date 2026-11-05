// HEIC photos (iPhone) in browsers that cannot open them (Chrome, Edge, Firefox), without a library: a HEIC file is
// HEVC-coded pictures in ISO boxes, so read the boxes, hand the HEVC data to the browser's own video decoder (WebCodecs,
// hardware on Macs), lay out the tiles of a grid picture and apply the crop, rotation and mirroring the file asks for.

type Box = { type: string; body: number; end: number };
type Prop = Box & { full: number }; // full: the body past a FullBox's version and flags
const tag = (v: DataView, p: number) => String.fromCharCode(v.getUint8(p), v.getUint8(p + 1), v.getUint8(p + 2), v.getUint8(p + 3));
function boxes(v: DataView, start: number, end: number) {
  const out: Box[] = [];
  for (let p = start; p + 8 <= end;) {
    let size = v.getUint32(p), head = 8;
    if (size === 1) { size = Number(v.getBigUint64(p + 8)); head = 16; } else if (size === 0) size = end - p;
    if (size < head || p + size > end) break;
    out.push({ type: tag(v, p + 4), body: p + head, end: p + size });
    p += size;
  }
  return out;
}
const child = (v: DataView, b: Box | undefined, type: string, skip = 0) => (b ? boxes(v, b.body + skip, b.end).find((x) => x.type === type) : undefined);
/** An unsigned integer of `n` bytes (0, 2, 4 or 8). */
const uint = (v: DataView, p: number, n: number) => (n === 2 ? v.getUint16(p) : n === 4 ? v.getUint32(p) : n === 8 ? Number(v.getBigUint64(p)) : 0);

type Item = { type: string; method: number; extents: [number, number][]; props: number[] };
function parse(buf: ArrayBuffer) {
  const v = new DataView(buf);
  const meta = boxes(v, 0, buf.byteLength).find((b) => b.type === 'meta');
  if (!meta) throw new Error('Không phải ảnh HEIC hợp lệ');
  const inMeta = (t: string) => child(v, meta, t, 4);
  const items = new Map<number, Item>();
  const item = (id: number) => { let it = items.get(id); if (!it) items.set(id, (it = { type: '', method: 0, extents: [], props: [] })); return it; };
  const pitm = inMeta('pitm')!;
  const primary = v.getUint8(pitm.body) ? v.getUint32(pitm.body + 4) : v.getUint16(pitm.body + 4);
  const iinf = inMeta('iinf');
  if (iinf) {
    for (const infe of boxes(v, iinf.body + (v.getUint8(iinf.body) ? 8 : 6), iinf.end)) {
      const ver = v.getUint8(infe.body);
      if (infe.type !== 'infe' || ver < 2) continue;
      const id = ver === 2 ? v.getUint16(infe.body + 4) : v.getUint32(infe.body + 4);
      item(id).type = tag(v, infe.body + (ver === 2 ? 8 : 10));
    }
  }
  const iloc = inMeta('iloc');
  if (iloc) {
    const ver = v.getUint8(iloc.body), a = v.getUint8(iloc.body + 4), b = v.getUint8(iloc.body + 5);
    const offSize = a >> 4, lenSize = a & 15, baseSize = b >> 4, idxSize = ver ? b & 15 : 0;
    let p = iloc.body + 6;
    const count = ver < 2 ? v.getUint16(p) : v.getUint32(p);
    p += ver < 2 ? 2 : 4;
    for (let i = 0; i < count; i++) {
      const it = item(ver < 2 ? v.getUint16(p) : v.getUint32(p));
      p += ver < 2 ? 2 : 4;
      if (ver) { it.method = v.getUint16(p) & 15; p += 2; }
      p += 2; // data_reference_index
      const base = uint(v, p, baseSize);
      p += baseSize;
      const n = v.getUint16(p);
      p += 2;
      for (let e = 0; e < n; e++) {
        p += idxSize;
        const off = uint(v, p, offSize); p += offSize;
        const len = uint(v, p, lenSize); p += lenSize;
        it.extents.push([base + off, len]);
      }
    }
  }
  // Derived pictures (a grid) point at the pictures they are made of.
  const dimg = new Map<number, number[]>();
  const iref = inMeta('iref');
  if (iref) {
    const wide = v.getUint8(iref.body) !== 0, n = wide ? 4 : 2;
    for (const r of boxes(v, iref.body + 4, iref.end)) {
      if (r.type !== 'dimg') continue;
      const from = uint(v, r.body, n), count = v.getUint16(r.body + n);
      dimg.set(from, Array.from({ length: count }, (_, i) => uint(v, r.body + n + 2 + i * n, n)));
    }
  }
  const iprp = inMeta('iprp');
  const ipco = child(v, iprp, 'ipco');
  const props: Prop[] = (ipco ? boxes(v, ipco.body, ipco.end) : []).map((b) => ({ ...b, full: b.body + 4 }));
  for (const ipma of iprp ? boxes(v, iprp.body, iprp.end).filter((b) => b.type === 'ipma') : []) {
    const ver = v.getUint8(ipma.body), wide = v.getUint8(ipma.body + 3) & 1;
    let p = ipma.body + 8;
    for (let n = v.getUint32(ipma.body + 4); n > 0; n--) {
      const it = item(ver < 1 ? v.getUint16(p) : v.getUint32(p));
      p += ver < 1 ? 2 : 4;
      for (let k = v.getUint8(p++); k > 0; k--) {
        const idx = wide ? v.getUint16(p) & 0x7fff : v.getUint8(p) & 0x7f;
        p += wide ? 2 : 1;
        if (idx) it.props.push(idx - 1);
      }
    }
  }
  const idat = inMeta('idat');
  const data = (it: Item) => {
    const parts = it.extents.map(([off, len]) => new Uint8Array(buf, (it.method === 1 ? idat!.body : 0) + off, len));
    if (parts.length === 1) return parts[0];
    const out = new Uint8Array(parts.reduce((s, x) => s + x.length, 0));
    parts.reduce((o, x) => (out.set(x, o), o + x.length), 0);
    return out;
  };
  const prop = (it: Item, type: string) => it.props.map((i) => props[i]).find((x) => x?.type === type);
  return { v, items, primary, dimg, props, data, prop };
}

/** The WebCodecs codec string for an HEVC decoder configuration ("hvc1.1.6.L93.B0"). */
function codecOf(c: Uint8Array) {
  const space = c[1] >> 6, tier = (c[1] >> 5) & 1, profile = c[1] & 31;
  let compat = ((c[2] << 24) | (c[3] << 16) | (c[4] << 8) | c[5]) >>> 0, rev = 0;
  for (let i = 0; i < 32; i++) { rev = (rev << 1) | (compat & 1); compat >>>= 1; }
  const flags = Array.from(c.subarray(6, 12));
  while (flags.length && !flags[flags.length - 1]) flags.pop();
  return ['hvc1', ['', 'A', 'B', 'C'][space] + profile, (rev >>> 0).toString(16), (tier ? 'H' : 'L') + c[12], ...flags.map((f) => f.toString(16).toUpperCase())].join('.');
}
// The colour description stored beside the picture (colr "nclx"), for the decoder: Apple's photos are full-range.
// (TypeScript's DOM types know fewer names than browsers do, hence plain strings.)
const PRIMARIES: Record<number, string> = { 1: 'bt709', 5: 'bt470bg', 6: 'smpte170m', 9: 'bt2020', 12: 'smpte432' };
const TRANSFER: Record<number, string> = { 1: 'bt709', 6: 'smpte170m', 8: 'linear', 13: 'iec61966-2-1', 16: 'pq', 18: 'hlg' };
const MATRIX: Record<number, string> = { 0: 'rgb', 1: 'bt709', 5: 'bt470bg', 6: 'smpte170m', 9: 'bt2020-ncl' };
function colourOf(v: DataView, colr: Prop | undefined): VideoColorSpaceInit | undefined {
  if (!colr || tag(v, colr.body) !== 'nclx') return undefined;
  const p = colr.body + 4;
  return { primaries: PRIMARIES[v.getUint16(p)], transfer: TRANSFER[v.getUint16(p + 2)], matrix: MATRIX[v.getUint16(p + 4)], fullRange: !!(v.getUint8(p + 6) >> 7) } as VideoColorSpaceInit;
}

const NO_HEVC = 'Máy hoặc trình duyệt này không giải mã được ảnh HEIC — hãy dùng Chrome bản mới hoặc Safari';
export async function heicToCanvas(file: Blob) {
  if (typeof VideoDecoder !== 'function') throw new Error(NO_HEVC);
  const buf = await file.arrayBuffer();
  const { v, items, primary, dimg, props, data, prop } = parse(buf);
  const main = items.get(primary);
  if (!main) throw new Error('Không phải ảnh HEIC hợp lệ');
  // One picture, or a grid of tiles (how phones store large photos).
  let tiles: number[], cols = 1, width: number, height: number;
  if (main.type === 'grid') {
    const g = data(main), wide = g[1] & 1, dv = new DataView(g.buffer, g.byteOffset, g.byteLength);
    cols = g[3] + 1;
    width = wide ? dv.getUint32(4) : dv.getUint16(4);
    height = wide ? dv.getUint32(8) : dv.getUint16(6);
    tiles = dimg.get(primary) || [];
    if (tiles.length < (g[2] + 1) * cols) throw new Error('Ảnh HEIC thiếu dữ liệu');
  } else if (main.type === 'hvc1') {
    tiles = [primary];
    const ispe = prop(main, 'ispe');
    width = ispe ? v.getUint32(ispe.full) : 0;
    height = ispe ? v.getUint32(ispe.full + 4) : 0;
  } else throw new Error('Loại ảnh HEIC này chưa được hỗ trợ');
  const first = items.get(tiles[0])!, hvcC = prop(first, 'hvcC'), ispe = prop(first, 'ispe');
  if (!hvcC || !ispe) throw new Error('Ảnh HEIC thiếu dữ liệu');
  const tw = v.getUint32(ispe.full), th = v.getUint32(ispe.full + 4);
  const desc = new Uint8Array(buf, hvcC.body, hvcC.end - hvcC.body);
  const config: VideoDecoderConfig = { codec: '', description: desc, codedWidth: tw, codedHeight: th };
  const colorSpace = colourOf(v, prop(main, 'colr') || prop(first, 'colr'));
  if (colorSpace) config.colorSpace = colorSpace;
  // Some phones label their photos "Main Still Picture", which a decoder may not list though it decodes them as Main.
  for (const codec of [codecOf(desc), `hvc1.1.6.L${desc[12]}.B0`]) {
    if ((await VideoDecoder.isConfigSupported({ ...config, codec })).supported) { config.codec = codec; break; }
  }
  if (!config.codec) throw new Error(NO_HEVC);

  const canvas = document.createElement('canvas');
  canvas.width = width || tw; canvas.height = height || th;
  const g = canvas.getContext('2d')!;
  let failed: unknown = null;
  // Each tile is drawn (and its frame freed) as soon as it is decoded: hardware decoders only lend a few frames.
  const dec = new VideoDecoder({
    output: (f) => { const i = f.timestamp; g.drawImage(f, (i % cols) * tw, Math.floor(i / cols) * th, tw, th); f.close(); },
    error: (e) => { failed = e; },
  });
  dec.configure(config);
  tiles.forEach((id, i) => dec.decode(new EncodedVideoChunk({ type: 'key', timestamp: i, data: data(items.get(id)!) })));
  try { await dec.flush(); } catch (e) { failed = failed || e; } finally { if (dec.state !== 'closed') dec.close(); }
  if (failed) throw new Error(NO_HEVC);
  return transform(v, main.props.map((i) => props[i]).filter(Boolean), canvas);
}

/** The crop (clap), rotation (irot) and mirroring (imir) of the picture, in the order the file lists them. */
function transform(v: DataView, list: Prop[], src: HTMLCanvasElement) {
  let c = src;
  const redraw = (w: number, h: number, draw: (g: CanvasRenderingContext2D, s: HTMLCanvasElement) => void) => {
    const n = document.createElement('canvas');
    n.width = w; n.height = h;
    draw(n.getContext('2d')!, c);
    c = n;
  };
  for (const p of list) {
    if (p.type === 'clap') {
      const frac = (o: number) => v.getInt32(p.body + o) / (v.getUint32(p.body + o + 4) || 1);
      const w = Math.round(frac(0)), h = Math.round(frac(8));
      const x = Math.round(frac(16) + (c.width - w) / 2), y = Math.round(frac(24) + (c.height - h) / 2);
      if (w > 0 && h > 0 && (w !== c.width || h !== c.height)) redraw(w, h, (g, s) => g.drawImage(s, -x, -y));
    } else if (p.type === 'irot') {
      // Anticlockwise, in quarter turns.
      const a = v.getUint8(p.body) & 3;
      if (a) redraw(a % 2 ? c.height : c.width, a % 2 ? c.width : c.height, (g, s) => {
        const [x, y] = [[0, 0], [0, s.width], [s.width, s.height], [s.height, 0]][a];
        g.translate(x, y); g.rotate(-a * Math.PI / 2); g.drawImage(s, 0, 0);
      });
    } else if (p.type === 'imir') {
      // 1: left and right swapped; 0: top and bottom.
      const lr = v.getUint8(p.body) & 1;
      redraw(c.width, c.height, (g, s) => { g.translate(lr ? s.width : 0, lr ? 0 : s.height); g.scale(lr ? -1 : 1, lr ? 1 : -1); g.drawImage(s, 0, 0); });
    }
  }
  return c;
}
