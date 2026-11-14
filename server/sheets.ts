// Video request forms in Google Sheets ("FORM YÊU CẦU DỰNG VIDEO"): read the tab as CSV, let Claude pull out the
// facts (client, aspect, length, which footage the script asks for), find that footage on Drive by name,
// and build the video from the form's own script table instead of writing a new one.
// Links inside cells are lost in CSV, so the tab is also exported as XLSX (which keeps one link per cell);
// linked Drive files/folders are opened in row order and their labels written next to the cell they came from.
import zlib from 'node:zlib';
import { Router, HttpError, json, readJson } from './http';
import * as G from './google';
import { copyKey, driveId, locate, sourceOut, type Source } from './sources';

const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const MAX_CSV = 60_000;
const MAX_SOURCES = 400;
const PER_FOLDER = 120; // every video of a linked folder goes on the timeline (by name), up to this many

export interface ScriptRow { row: string; meaning: string; voice_over: string; visual: string; on_screen: string; source: string; duration: string; note: string }
export interface SheetForm { customer: string; aspect: string; seconds: number; sequence: { row: string; ref: string }[]; ignored_rows: string; script?: ScriptRow[]; deadline?: string; urgent?: boolean }
export interface Sheet { title: string; link: string; csv: string; form: SheetForm; missing?: string[]; /** The tab this project was built from, for multi-tab sheets. */ tab?: string; /** Set when Claude couldn't be used and the form was read by its template. */ warning?: string }

/** Spreadsheet id and tab (gid) from a docs.google.com/spreadsheets link. */
export function sheetRef(link: string) {
  const id = driveId(link);
  const gid = String(link).match(/[#?&]gid=(\d+)/)?.[1] || '';
  return { id, gid };
}
export const isSheetLink = (link: string) => /docs\.google\.com\/spreadsheets\//.test(String(link || ''));

// ---------------------------------------------------------------- XLSX links (no dependency: a tiny zip reader)
/** The files of a zip by name, each inflated the first time it is read (a big workbook's other tabs cost nothing). */
function unzip(buf: Buffer) {
  const entries = new Map<string, { method: number; data: Buffer }>(), done = new Map<string, Buffer>();
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  let p = eocd < 0 ? 0 : buf.readUInt32LE(eocd + 16);
  for (let n = eocd < 0 ? 0 : buf.readUInt16LE(eocd + 10); n > 0; n--) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    entries.set(name, { method, data: buf.subarray(start, start + size) });
    p += 46 + nameLen + extra + comment;
  }
  return {
    has: (name: string) => entries.has(name),
    get(name: string) {
      const e = entries.get(name);
      if (e && !done.has(name)) done.set(name, e.method === 8 ? zlib.inflateRawSync(e.data) : e.data);
      return done.get(name);
    },
  };
}
const unxml = (s: string) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const texts = (xml: string) => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join('');

/**
 * An exported workbook: its tabs (name → worksheet file), shared strings and which cell styles are dates.
 * Read directly instead of a CSV export because the XLSX keeps every tab and each cell's link.
 */
export function workbook(buf: Buffer) {
  const files = unzip(buf);
  const str = (n: string) => files.get(n)?.toString('utf8') || '';
  const rels = new Map([...str('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)]
    .map((m) => [m[1], m[2].replace(/^\/?(xl\/)?/, 'xl/')]));
  // Hidden tabs (state="hidden" / "veryHidden") are left out: only the tabs people see in the sheet count.
  const tabs = [...str('xl/workbook.xml').matchAll(/<sheet\b([^>]*)\/?>/g)].map((m) => ({
    name: unxml(m[1].match(/\bname="([^"]*)"/)?.[1] || ''), file: rels.get(m[1].match(/\br:id="([^"]+)"/)?.[1] || '') || '',
    hidden: /\bstate="(hidden|veryHidden)"/.test(m[1]),
  })).filter((t) => files.has(t.file) && !t.hidden);
  const shared = [...str('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  // Cell styles whose number format is a date, so serial numbers can be shown as dd/mm/yyyy.
  const styles = str('xl/styles.xml');
  const custom = new Map([...styles.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)].map((m) => [+m[1], unxml(m[2])]));
  const isDate = (id: number) => (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || /[dy]/i.test((custom.get(id) || '').replace(/\[[^\]]*\]|"[^"]*"/g, ''));
  const xfs = (styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] || '').match(/<xf\b[^>]*>/g) || [];
  const dates = new Set(xfs.map((x, i) => (isDate(+(x.match(/numFmtId="(\d+)"/)?.[1] || 0)) ? i : -1)).filter((i) => i >= 0));
  return { files, tabs, shared, dates };
}
const colIndex = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** One tab as a grid of cell texts plus its cell links (ref → URL, from hyperlinks and HYPERLINK() formulas). */
export function tabData(wb: ReturnType<typeof workbook>, file: string) {
  const xml = wb.files.get(file)!.toString('utf8');
  const rows: string[][] = [];
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1], body = m[2] || '';
    const ref = attrs.match(/\br="([A-Z]+)(\d+)"/); if (!ref) continue;
    const t = attrs.match(/\bt="(\w+)"/)?.[1], st = +(attrs.match(/\bs="(\d+)"/)?.[1] || -1);
    const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
    let text = '';
    if (t === 's') text = wb.shared[+(v || 0)] || '';
    else if (t === 'inlineStr') text = texts(body);
    else if (t === 'b') text = v === '1' ? 'TRUE' : 'FALSE';
    else if (v !== undefined) {
      text = unxml(v);
      if (t !== 'str' && t !== 'e' && /^-?\d+\.0+$/.test(text)) text = text.replace(/\.0+$/, ''); // "1.0" → "1"
      if (t !== 'str' && t !== 'e' && wb.dates.has(st) && isFinite(+text)) {
        const d = new Date(Math.round((+text - 25569) * 864e5)); // Excel serial day → date
        text = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
      }
    }
    if (!text) continue;
    const r = +ref[2] - 1, c = colIndex(ref[1]);
    while (rows.length <= r) rows.push([]);
    while (rows[r].length < c) rows[r].push('');
    rows[r][c] = text;
  }
  const rels = wb.files.get(file.replace('worksheets/', 'worksheets/_rels/') + '.rels')?.toString('utf8') || '';
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)].map((m) => [m[1], unxml(m[2])]));
  const links = new Map<string, string>();
  for (const m of xml.matchAll(/<hyperlink\b[^>]*\bref="([A-Z]+\d+)"[^>]*\br:id="([^"]+)"|<hyperlink\b[^>]*\br:id="([^"]+)"[^>]*\bref="([A-Z]+\d+)"/g)) {
    const url = target.get(m[2] || m[3]);
    if (url && /^https?:/.test(url)) links.set(m[1] || m[4], url);
  }
  for (const m of xml.matchAll(/<c\b[^>]*\br="([A-Z]+\d+)"[^>]*>\s*<f>HYPERLINK\(&quot;(.*?)&quot;/g)) links.set(m[1], unxml(m[2]));
  return { rows, links };
}

/** The tabs of a spreadsheet, with how many filled cells each has (empty tabs are not worth a project). */
export async function sheetTabs(link: string) {
  const { id } = sheetRef(link);
  if (!id) throw new HttpError(400, 'Link Google Sheet không hợp lệ');
  const { account, file } = await locate(id);
  if (file.mimeType !== SHEET_MIME) throw new HttpError(400, 'Link này không phải Google Sheet');
  const wb = workbook(await G.sheetExport(account, file.id, '', 'xlsx'));
  return { title: file.name, tabs: wb.tabs.map((t) => ({ name: t.name, cells: tabData(wb, t.file).rows.flat().filter((c) => c.trim()).length })) };
}

// ---------------------------------------------------------------- CSV with links written into their cells
const toCsv = (rows: string[][]) => rows
  .map((r) => { let end = r.length - 1; while (end >= 0 && !r[end].trim()) end--; return r.slice(0, end + 1).map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','); })
  .join('\n').replace(/\n{3,}/g, '\n\n');
const cellPos = (ref: string) => {
  const m = ref.match(/^([A-Z]+)(\d+)$/)!;
  return { row: Number(m[2]) - 1, col: [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1 };
};
/** Every Drive URL in the sheet with where it sits: cell links (XLSX) and URLs typed as text (CSV), in reading order. */
function driveRefs(rows: string[][], links: Map<string, string>) {
  const refs: { row: number; col: number; url: string }[] = [];
  for (const [ref, url] of links) refs.push({ ...cellPos(ref), url });
  rows.forEach((r, row) => r.forEach((c, col) => {
    for (const m of c.matchAll(/https:\/\/(?:drive|docs)\.google\.com\/[^\s"<>)]+/g)) refs.push({ row, col, url: m[0] });
  }));
  return refs.filter((r) => /drive\.google\.com/.test(r.url) && driveId(r.url))
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .filter((r, i, all) => all.findIndex((x) => x.row === r.row && x.col === r.col && driveId(x.url) === driveId(r.url)) === i);
}

// ---------------------------------------------------------------- footage
type Pool = { out: Map<string, Source>; add: (f: G.GFile, folder: string) => Promise<number | null> };
function pool(account: string): Pool {
  const out = new Map<string, Source>(), copies = new Map<string, string>();
  return {
    out,
    /** Adds a clip/photo; returns its 1-based label number (s1, s2…), also when it (or a copy of it) was already there. */
    async add(f, folder) {
      const first = copies.get(copyKey(f));
      if (first) return [...out.keys()].indexOf(first) + 1;
      if (out.size >= MAX_SOURCES || !f.mimeType.startsWith('video/')) return null; // sources are video only
      G.rememberThumb(f.id, f.thumbnailLink);
      out.set(f.id, await sourceOut(account, f, folder));
      copies.set(copyKey(f), f.id);
      return out.size;
    },
  };
}
/** The videos of a folder in name order (sub-folders included), up to `n`. */
async function folderVideos(account: string, id: string, n: number) {
  const media = await G.listMediaIn(account, [id]);
  return media.filter((f) => f.mimeType.startsWith('video/')).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).slice(0, n);
}
const span = (labels: number[]) => (labels.length ? (labels.length === 1 ? `s${labels[0]}` : `s${labels[0]}–s${labels[labels.length - 1]}`) : '');

/** Opens every linked Drive file/folder in row order; returns a note per cell, e.g. "→ s3" or "→ thư mục Porsche 911: s4–s13". */
async function linkedFootage(account: string, refs: ReturnType<typeof driveRefs>, p: Pool) {
  const notes = new Map<string, string[]>(); // "row:col" → notes
  const note = (r: { row: number; col: number }, text: string) => notes.set(`${r.row}:${r.col}`, [...(notes.get(`${r.row}:${r.col}`) || []), text]);
  for (const r of refs.slice(0, 40)) {
    try {
      const { file } = await locate(driveId(r.url));
      if (file.mimeType === G.FOLDER_MIME) {
        const labels: number[] = [];
        for (const f of await folderVideos(account, file.id, PER_FOLDER)) { const n = await p.add(f, file.name); if (n) labels.push(n); }
        note(r, labels.length ? `[link → thư mục “${file.name}”: ${span(labels)}]` : `[link → thư mục “${file.name}”: không có video]`);
      } else {
        const n = await p.add(file, 'link trong sheet');
        note(r, n ? `[link → “${file.name}”: s${n}]` : `[link → “${file.name}” (không phải video)]`);
      }
    } catch { note(r, '[link Drive không mở được]'); }
  }
  return notes;
}

/**
 * The footage each script row asks for, in the sheet's order: link labels from cell notes ("s5–s24") or names found
 * on Drive (a folder gives its videos). Each source remembers the first row that asked for it.
 */
async function candidates(account: string, seq: SheetForm['sequence'], p: Pool) {
  const missing: string[] = [];
  const rows = new Map<string, Source[]>();
  const list = () => [...p.out.values()];
  const base = (n: string) => n.toLowerCase().replace(/\.\w{2,4}$/, '').trim();
  for (const { row, ref } of seq) {
    const r = String(ref || '').trim();
    let found: Source[] = [];
    const m = r.match(/^s(\d+)(?:\s*[–-]\s*s?(\d+))?$/i);
    if (m) found = list().slice(Number(m[1]) - 1, Number(m[2] || m[1]));
    else if (r) {
      const name = base(r);
      found = list().filter((x) => base(x.name) === name);
      if (!found.length) {
        const hits = (await G.searchByName(account, r.replace(/\.\w{2,4}$/, ''), 20)).filter((f) => f.mimeType === G.FOLDER_MIME || f.mimeType.startsWith('video/'));
        const exact = hits.filter((f) => f.mimeType !== G.FOLDER_MIME && base(f.name) === name);
        const folder = hits.find((f) => f.mimeType === G.FOLDER_MIME);
        const files = exact.length ? exact.slice(0, 1) : folder ? await folderVideos(account, folder.id, PER_FOLDER) : hits.filter((f) => f.mimeType !== G.FOLDER_MIME).slice(0, 1);
        for (const f of files) { const n = await p.add(f, folder && !exact.length ? folder.name : 'tìm theo tên'); if (n) found.push(list()[n - 1]); }
      }
    }
    if (!found.length) { missing.push(r); continue; }
    const key = String(row || '');
    const have = rows.get(key) || [];
    for (const x of found) { if (!have.includes(x)) have.push(x); (x as any).row ??= key; }
    rows.set(key, have);
  }
  return { rows, missing };
}

// ---------------------------------------------------------------- the form read by its template (no Claude)
const fold = (x: string) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();
const STOCK = /pexels|adobe|storyblocks|shutterstock|envato|youtube|tiktok|facebook|instagram/i;
const GENERIC = new Set(['ceramic', 'coating', 'coat', 'exterior', 'interior', 'hook', 'hooks', 'intro', 'outro', 'logo', 'brand', 'gloss', 'source', 'original', 'video', 'cta', 'offer', 'promo', 'promotion', 'shop', 'branding', 'beading', 'water']);

/**
 * "FORM YÊU CẦU DỰNG VIDEO" read by its fixed layout: overview labels in one column with the value to their right,
 * then the script table under a header row (Sence · Ý Nghĩa · Voice Over · Nội dung · Thời lượng · Text on Visual ·
 * Source · Ghi chú). Used when Claude can't be reached; it can't tell another client's leftover rows apart.
 */
export function readFormLayout(title: string, rows: string[][]): SheetForm {
  const valueOf = (re: RegExp) => {
    for (const r of rows) {
      const i = r.findIndex((c) => re.test(fold(c)));
      if (i >= 0) { const v = r.slice(i + 1).find((c) => c && c.trim()); if (v) return v.trim(); }
    }
    return '';
  };
  const aspectRaw = valueOf(/^ty le khung hinh/);
  const aspect = /16\s*:\s*9/.test(aspectRaw) ? '16:9' : /1\s*:\s*1/.test(aspectRaw) ? '1:1' : '9:16';
  const nums = (valueOf(/^do dai mong muon/).match(/\d+/g) || []).map(Number);
  const seconds = nums.length >= 2 ? Math.round((nums[0] + nums[1]) / 2) : nums[0] || 30;
  const customer = title.split('|').map((x) => x.trim()).filter(Boolean)[1] || title;
  const form: SheetForm = { customer, aspect, seconds, deadline: valueOf(/^ngay can ban final/), urgent: /gap|^co\b/.test(fold(valueOf(/^co yeu cau gap/))), script: [], sequence: [], ignored_rows: '' };

  const hi = rows.findIndex((r) => r.some((c) => /^voice ?over/.test(fold(c))) && r.some((c) => /^noi dung/.test(fold(c))));
  if (hi < 0) return form;
  const H = rows[hi].map(fold);
  const col = (re: RegExp) => H.findIndex((h) => re.test(h));
  const c = { num: col(/^(s[ce]n[ce]e|scene|canh|stt)/), mean: col(/^y nghia/), vo: col(/^voice ?over/), vis: col(/^noi dung/), dur: col(/^thoi luong/), txt: col(/^text on/), src: col(/^source/), note: col(/^ghi chu/) };
  const cell = (r: string[], i: number) => (i >= 0 ? String(r[i] || '').trim() : '');
  const seen = new Map<string, number>();
  for (const r of rows.slice(hi + 1)) {
    const vo = cell(r, c.vo), vis = cell(r, c.vis), src = cell(r, c.src);
    if (!vo && !vis && !src) continue;
    const num = cell(r, c.num), mean = cell(r, c.mean);
    let row = num && mean ? `${num} · ${mean}` : num ? `Cảnh ${num}` : mean || `Cảnh ${form.script!.length + 1}`;
    const n = (seen.get(row) || 0) + 1; seen.set(row, n);
    if (n > 1) row = `${row} (${n})`;
    const plain = src.replace(/\[link[^\]]*\]/g, '').trim();
    form.script!.push({ row, meaning: mean, voice_over: vo, visual: vis, on_screen: cell(r, c.txt), source: plain, duration: cell(r, c.dur), note: cell(r, c.note) });
    // Footage for this row: link labels from the cell notes, file names, and short names split on "/" or new lines.
    const refs: string[] = [];
    for (const m of src.matchAll(/\[link →[^\]]*?(s\d+(?:–s\d+)?)\]/g)) refs.push(m[1]);
    const files = [...plain.matchAll(/([A-Za-z0-9][\w\- ]*?\.(?:mov|mp4|m4v|avi|mkv))\b/gi)].map((m) => m[1].trim());
    refs.push(...files);
    for (const part of plain.replace(/https?:\/\/\S+/g, '').split(/[\/\n,]+/)) {
      const t = part.replace(/[🎬•*\-–:]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (t.length < 3 || t.length > 30 || t.split(' ').length > 4 || !/[A-Z0-9]/.test(t) || STOCK.test(t) || /\.(mov|mp4|m4v)$/i.test(t)) continue;
      // Descriptions and generic words ("Source gloss", "dùng source VCC", "Exterior") would match random folders.
      if (/^(source|d[uù]ng|n[eế]u|em|anh|c[oó]|kh[aá]ch)\b/i.test(t) || t.split(' ').every((w) => GENERIC.has(fold(w)))) continue;
      if (!files.some((f) => f.toLowerCase().startsWith(t.toLowerCase()))) refs.push(t);
    }
    for (const ref of [...new Set(refs)]) form.sequence.push({ row, ref });
  }
  return form;
}

/** Read one tab (`tab` by name; otherwise the tab in the link, or the first): its script and the footage it links. */
export async function readSheet(link: string, step: (text: string) => void = () => {}, tab?: string) {
  const { id, gid } = sheetRef(link);
  if (!id) throw new HttpError(400, 'Link Google Sheet không hợp lệ');
  const { account, file } = await locate(id);
  if (file.mimeType !== SHEET_MIME) throw new HttpError(400, 'Link này không phải Google Sheet');
  step('Đang đọc sheet và các link trong sheet…');
  // A named tab comes from the whole workbook; otherwise the export of the tab in the link (gid) holds just that tab.
  const wb = workbook(await G.sheetExport(account, file.id, tab ? '' : gid, 'xlsx'));
  const pick = tab ? wb.tabs.find((t) => t.name === tab) : wb.tabs[0];
  if (!pick) throw new HttpError(404, `Không thấy tab “${tab}” trong sheet`);
  const { rows, links } = tabData(wb, pick.file);
  // Links first, in row order, so s1, s2… follow the script; each cell then shows which labels it points at.
  const p = pool(account);
  const notes = await linkedFootage(account, driveRefs(rows, links), p);
  for (const [ref, url] of links) { // non-Drive links (Pexels, Storyblocks…) are written out so the model sees them too
    const { row, col } = cellPos(ref);
    if (!/drive\.google\.com/.test(url)) notes.set(`${row}:${col}`, [...(notes.get(`${row}:${col}`) || []), `[link: ${url.replace(/[?&]utm_source=[^&]*/, '')}]`]);
  }
  for (const [key, list] of notes) {
    const [row, col] = key.split(':').map(Number);
    while (rows.length <= row) rows.push([]);
    while (rows[row].length <= col) rows[row].push('');
    rows[row][col] = [rows[row][col], ...list].filter(Boolean).join(' ');
  }
  const csv = toCsv(rows).slice(0, MAX_CSV);
  step('Đang đọc kịch bản từng cảnh…');
  // Read by the form's template. A sheet laid out otherwise keeps its whole text (csv): Claude Code reads it when it
  // builds the video (server/video-mcp.ts).
  const form = readFormLayout(file.name, rows);
  const warning = form.script?.length ? '' : 'Sheet không theo mẫu form nên chưa tách được kịch bản: Claude đọc sheet gốc khi dựng.';
  // A row without a purpose comes back as "3 · ": call it "Cảnh 3" everywhere (script and footage rows match on it).
  const label = (r: string) => { const t = String(r || '').trim().replace(/\s*·\s*$/, ''); return /^\d+$/.test(t) ? `Cảnh ${t}` : t; };
  form.script = (form.script || []).map((r) => ({ ...r, row: label(r.row) }));
  form.sequence = (form.sequence || []).map((x) => ({ ...x, row: label(x.row) }));
  step('Đang tìm source trên Drive…');
  const { missing: notFound } = await candidates(account, form.sequence || [], p);
  const missing = [...new Set(notFound)];
  const sheet: Sheet = { title: tab ? `${pick.name}` : file.name, link, csv, form, missing, ...(tab ? { tab } : {}), ...(warning ? { warning } : {}) };
  return { sheet, sources: [...p.out.values()], missing, links: notes.size, storyboard: null, warning };
}

/** A sheet sent back by the browser: plain fields only, size-capped. */
export function checkSheet(v: any): Sheet | null {
  if (!v || typeof v !== 'object' || typeof v.csv !== 'string') return null;
  const f = v.form || {};
  return {
    title: String(v.title || '').slice(0, 300), link: String(v.link || '').slice(0, 500), csv: v.csv.slice(0, MAX_CSV),
    missing: Array.isArray(v.missing) ? v.missing.map(String).slice(0, 100) : [],
    ...(typeof v.tab === 'string' && v.tab ? { tab: v.tab.slice(0, 200) } : {}),
    ...(typeof v.warning === 'string' && v.warning ? { warning: v.warning.slice(0, 400) } : {}),
    form: {
      customer: String(f.customer || '').slice(0, 200), aspect: ['16:9', '9:16', '1:1'].includes(f.aspect) ? f.aspect : '16:9',
      seconds: Math.min(180, Math.max(5, Number(f.seconds) || 30)),
      sequence: Array.isArray(f.sequence) ? f.sequence.slice(0, 200).map((x: any) => ({ row: String(x?.row || '').slice(0, 200), ref: String(x?.ref || '').slice(0, 300) })) : [],
      ignored_rows: String(f.ignored_rows || '').slice(0, 500),
      deadline: String(f.deadline || '').slice(0, 40), urgent: !!f.urgent,
      script: Array.isArray(f.script) ? f.script.slice(0, 60).map((r: any) => Object.fromEntries(
        ['row', 'meaning', 'voice_over', 'visual', 'on_screen', 'source', 'duration', 'note'].map((k) => [k, String(r?.[k] ?? '').slice(0, 2000)]))) as ScriptRow[] : [],
    },
  };
}

const progress = new Map<string, { text: string; at: number }>();

export function registerSheets(api: Router) {
  // Reading a sheet takes a minute or two; the page polls /progress with the token it chose to show each step.
  api.post('/api/sheets/read', async (req, res) => {
    const { link, token, tab } = await readJson(req);
    if (!isSheetLink(link)) throw new HttpError(400, 'Hãy dán link Google Sheet (docs.google.com/spreadsheets/…)');
    const key = typeof token === 'string' && /^[\w-]{8,64}$/.test(token) ? token : '';
    try { json(res, 200, await readSheet(link, (t) => { if (key) progress.set(key, { text: t, at: Date.now() }); }, typeof tab === 'string' && tab ? tab : undefined)); }
    finally { if (key) progress.delete(key); }
  });
  api.post('/api/sheets/tabs', async (req, res) => {
    const { link } = await readJson(req);
    if (!isSheetLink(link)) throw new HttpError(400, 'Hãy dán link Google Sheet (docs.google.com/spreadsheets/…)');
    json(res, 200, await sheetTabs(link));
  });
  api.get('/api/sheets/progress/:token', async (req, res) => json(res, 200, { text: progress.get(req.params.token)?.text || '' }));
}
