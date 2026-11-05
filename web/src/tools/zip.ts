// Zip without a library: reading (stored or deflated entries, inflated by the browser's DecompressionStream) for .xlsx,
// and writing (stored, no compression) for .xlsx and for downloading several converted files at once.

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const inflate = async (b: Uint8Array) =>
  new Uint8Array(await new Response(new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());

/** The entries of a zip whose names pass `keep`, by name. */
export async function unzip(buf: ArrayBuffer, keep: (name: string) => boolean = () => true) {
  const v = new DataView(buf), u = new Uint8Array(buf), dec = new TextDecoder();
  // The central directory's end record: the last "PK\5\6" (a comment of up to 64 KB may follow it).
  let end = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('File bị hỏng hoặc không phải định dạng này');
  const out = new Map<string, Uint8Array>();
  let p = v.getUint32(end + 16, true);
  for (let k = v.getUint16(end + 10, true); k > 0 && v.getUint32(p, true) === 0x02014b50; k--) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true), nameLen = v.getUint16(p + 28, true);
    const name = dec.decode(u.subarray(p + 46, p + 46 + nameLen)), local = v.getUint32(p + 42, true);
    p += 46 + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
    if (!keep(name) || (method !== 0 && method !== 8)) continue;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = u.subarray(start, start + size);
    out.set(name, method === 8 ? await inflate(data) : data);
  }
  return out;
}

/** A zip of the given files, stored as they are (UTF-8 names). */
export function zip(files: { name: string; data: Uint8Array }[]) {
  const enc = new TextEncoder(), parts: BlobPart[] = [], central: BlobPart[] = [];
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  let off = 0, dir = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    if (off + size > 0xfffffff0) throw new Error('Tổng dung lượng quá 4 GB, hãy tải từng file');
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
    h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true);
    h.setUint32(18, size, true); h.setUint32(22, size, true); h.setUint16(26, name.length, true);
    parts.push(h, name, f.data as BlobPart);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true);
    c.setUint32(20, size, true); c.setUint32(24, size, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(c, name);
    off += 30 + name.length + size;
    dir += 46 + name.length;
  }
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, dir, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, e], { type: 'application/zip' });
}
