// Text conversions: subtitles (SRT ⇄ VTT, or plain text) and tables (CSV, TSV, JSON, Excel .xlsx — the first sheet).
import { unzip, zip } from './zip';

/** A text file's contents: UTF-8 (with or without BOM), UTF-16 with BOM, else the Vietnamese Windows code page. */
async function readText(file: Blob) {
  const b = new Uint8Array(await file.arrayBuffer());
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return new TextDecoder('windows-1258').decode(b); }
}
const textBlob = (s: string, type: string) => new Blob([s], { type: `${type};charset=utf-8` });

// ---------------------------------------------------------------- subtitles
type Cue = { start: number; end: number; text: string };
function seconds(s: string) {
  const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?/);
  return m ? Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number((m[4] || '0').padEnd(3, '0')) / 1000 : null;
}
const stamp = (t: number, sep: string) => {
  const ms = Math.round(t * 1000), two = (n: number) => String(n).padStart(2, '0');
  return `${two(Math.floor(ms / 3600000))}:${two(Math.floor(ms / 60000) % 60)}:${two(Math.floor(ms / 1000) % 60)}${sep}${String(ms % 1000).padStart(3, '0')}`;
};
/** SRT and WebVTT alike: blocks separated by a blank line, each with a "start --> end" line and the text under it. */
function cues(s: string): Cue[] {
  const out: Cue[] = [];
  for (const block of s.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const start = seconds(a), end = seconds(b);
    if (start !== null && end !== null) out.push({ start, end, text: lines.slice(i + 1).join('\n').trim() });
  }
  return out;
}

export async function convertSubtitle(file: File, to: string) {
  const list = cues(await readText(file));
  if (!list.length) throw new Error('Không thấy dòng phụ đề nào (cần dạng “00:00:01,000 --> 00:00:03,000”)');
  // SRT players know <i>, <b>, <u> and <font>; VTT's own tags (<c.class>, <v Name>, timestamps) are dropped.
  const srtText = (t: string) => t.replace(/<(?!\/?(?:i|b|u|font)\b)[^>]*>/g, '');
  if (to === 'srt') return textBlob(list.map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${srtText(c.text)}\n`).join('\n'), 'application/x-subrip');
  if (to === 'vtt') return textBlob('WEBVTT\n\n' + list.map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.text}\n`).join('\n'), 'text/vtt');
  return textBlob(list.map((c) => c.text.replace(/<[^>]*>/g, '')).filter(Boolean).join('\n') + '\n', 'text/plain');
}

// ---------------------------------------------------------------- tables
type Cell = string | number | boolean | null;

function parseDelimited(s: string, sep: string) {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, started = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
    } else if (c === '"' && !started) { quoted = true; started = true; }
    else if (c === sep) { row.push(cell); cell = ''; started = false; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = ''; started = false;
    } else { cell += c; started = true; }
  }
  if (started || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
/** A .csv's separator: comma, or the semicolon Excel uses in locales with a decimal comma, or a tab. */
function sniff(s: string) {
  const nl = s.search(/\r|\n/);
  const line = (nl < 0 ? s : s.slice(0, nl)).replace(/"[^"]*"/g, '');
  return [',', ';', '\t'].map((c) => [c, line.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0];
}
function fromJson(v: any): Cell[][] {
  const cell = (x: any): Cell => (x === undefined ? null : x === null || typeof x !== 'object' ? x : JSON.stringify(x));
  const list = Array.isArray(v) ? v : [v];
  if (list.every(Array.isArray)) return list.map((r: any[]) => r.map(cell));
  if (!list.every((r) => r && typeof r === 'object')) return [['value'], ...list.map((x) => [cell(x)])];
  const keys = [...new Set(list.flatMap((r) => Object.keys(r)))];
  return [keys, ...list.map((r) => keys.map((k) => cell(r[k])))];
}

// Excel stores dates as day numbers; the cell's number format says when a number is one.
const DATE_FMT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
const isDateFormat = (code: string) => /[dmyhs]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, ''));
function excelDate(n: number) {
  const d = new Date(Math.round((n - 25569) * 864e5)), two = (x: number) => String(x).padStart(2, '0');
  const day = `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`, time = `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
  return n < 1 ? time : Number.isInteger(n) ? day : `${day} ${time}`;
}
const colIndex = (ref: string) => [...ref.replace(/\d+$/, '')].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const colName = (i: number): string => (i >= 26 ? colName(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));

export async function readXlsx(file: Blob, sheetName?: string): Promise<Cell[][]> {
  const files = await unzip(await file.arrayBuffer(), (n) => /\.(xml|rels)$/.test(n));
  const xml = (name: string) => { const b = files.get(name); return b ? new DOMParser().parseFromString(new TextDecoder().decode(b), 'application/xml') : null; };
  const all = (doc: Document | Element | null, tag: string) => (doc ? Array.from(doc.getElementsByTagNameNS('*', tag)) : []);
  const wb = xml('xl/workbook.xml');
  const sheet = sheetName ? all(wb, 'sheet').find(s=>s.getAttribute('name')===sheetName) : all(wb, 'sheet')[0];
  if (!sheet) throw new Error('Không đọc được file Excel này');
  const rid = Array.from(sheet.attributes).find((a) => a.localName === 'id' && a.namespaceURI?.includes('relationships'))?.value;
  const target = all(xml('xl/_rels/workbook.xml.rels'), 'Relationship').find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target') || 'worksheets/sheet1.xml';
  const ws = xml(target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, ''));
  if (!ws) throw new Error('Không đọc được file Excel này');
  // Shared strings: the text of each <si>, its rich-text runs joined (phonetic hints left out).
  const strings = all(xml('xl/sharedStrings.xml'), 'si').map((si) => all(si, 't').filter((t) => t.parentElement?.localName !== 'rPh').map((t) => t.textContent).join(''));
  const styles = xml('xl/styles.xml');
  const custom = new Map(all(styles, 'numFmt').map((f) => [Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') || '']));
  const xfs = all(styles, 'cellXfs')[0];
  const dateStyle = (xfs ? all(xfs, 'xf') : []).map((x) => { const id = Number(x.getAttribute('numFmtId')); return DATE_FMT_IDS.has(id) || isDateFormat(custom.get(id) || ''); });
  const rows: Cell[][] = [];
  for (const [ri, r] of all(ws, 'row').entries()) {
    const at = Number(r.getAttribute('r')) - 1;
    const row: Cell[] = [];
    for (const [ci, c] of all(r, 'c').entries()) {
      const ref = c.getAttribute('r'), t = c.getAttribute('t'), v = all(c, 'v')[0]?.textContent ?? null;
      const value: Cell = t === 's' ? strings[Number(v)] ?? ''
        : t === 'inlineStr' ? all(c, 't').map((x) => x.textContent).join('')
        : t === 'b' ? v === '1'
        : t === 'str' || t === 'e' || v === null ? v
        : dateStyle[Number(c.getAttribute('s') || 0)] ? excelDate(Number(v)) : Number(v);
      row[ref ? colIndex(ref) : ci] = value;
    }
    rows[at >= 0 ? at : ri] = row;
  }
  return Array.from(rows, (r) => Array.from(r || [], (x) => x ?? null));
}

const esc = (s: string) => s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// A text cell that is a plain number becomes a number; leading zeros (phone numbers, codes) keep it text.
const NUM = /^-?(0|[1-9]\d{0,14})(\.\d+)?$/;
function writeXlsx(rows: Cell[][], sheetName: string) {
  const NS = 'http://schemas.openxmlformats.org', REL = `${NS}/officeDocument/2006/relationships`;
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const data = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    if (v === null || v === '') return '';
    const ref = colName(ci) + (ri + 1);
    if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
    if (typeof v === 'number' ? Number.isFinite(v) : NUM.test(v)) return `<c r="${ref}"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
  }).join('')}</row>`).join('');
  const enc = new TextEncoder();
  const part = (name: string, body: string) => ({ name, data: enc.encode(head + body) });
  return zip([
    part('[Content_Types].xml', `<Types xmlns="${NS}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    part('_rels/.rels', `<Relationships xmlns="${NS}/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    part('xl/workbook.xml', `<workbook xmlns="${NS}/spreadsheetml/2006/main" xmlns:r="${REL}"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    part('xl/_rels/workbook.xml.rels', `<Relationships xmlns="${NS}/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    part('xl/worksheets/sheet1.xml', `<worksheet xmlns="${NS}/spreadsheetml/2006/main"><sheetData>${data}</sheetData></worksheet>`),
  ]);
}

function writeDelimited(rows: Cell[][], sep: string) {
  const cell = (v: Cell) => { const s = v === null ? '' : String(v); return /[",\r\n;\t]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  // The BOM makes Excel read the file as UTF-8 (Vietnamese text stays intact).
  return '\ufeff' + rows.map((r) => r.map(cell).join(sep)).join('\r\n') + '\r\n';
}
export async function xlsxSheetNames(file: Blob): Promise<string[]> {
  const files = await unzip(await file.arrayBuffer(), (name) => name === 'xl/workbook.xml');
  const bytes = files.get('xl/workbook.xml');
  if (!bytes) throw new Error('Không đọc được workbook Excel.');
  const xml = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
  return [...xml.getElementsByTagNameNS('*','sheet')].map((s) => s.getAttribute('name') || '');
}
export const xlsxSheetText = async (file: Blob, sheetName: string) => writeDelimited(await readXlsx(file, sheetName), '\t');

/** A table file as tab-separated text (an Excel workbook's first sheet; CSV/TSV/text as written), for pasting-style imports. */
export async function tableText(file: File) {
  if (/\.xlsx$/i.test(file.name)) return writeDelimited(await readXlsx(file), '\t');
  if (/\.xls$/i.test(file.name)) throw new Error('File .xls (Excel 97–2003) chưa đọc được: mở trong Excel rồi lưu lại dạng .xlsx');
  return readText(file);
}
/** Rows as JSON objects, the first row giving the keys (blank or repeated names made unique); empty rows left out. */
function writeJson(rows: Cell[][]) {
  const [head = [], ...rest] = rows;
  const body = rest.filter((r) => r.some((v) => v !== null && v !== ''));
  const seen = new Map<string, number>();
  const keys = Array.from({ length: Math.max(head.length, ...body.map((r) => r.length)) }, (_, i) => {
    const k = String(head[i] ?? '').trim() || `Cột ${i + 1}`, n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    return n > 1 ? `${k} (${n})` : k;
  });
  return JSON.stringify(body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? null]))), null, 2) + '\n';
}

export async function convertTable(file: File, from: string, to: string) {
  let rows: Cell[][];
  if (from === 'xlsx') rows = await readXlsx(file);
  else {
    const s = await readText(file);
    if (from === 'json') {
      try { rows = fromJson(JSON.parse(s)); } catch { throw new Error('File JSON không hợp lệ'); }
    } else rows = parseDelimited(s, from === 'tsv' ? '\t' : sniff(s));
  }
  if (!rows.length) throw new Error('File không có dữ liệu');
  if (to === 'xlsx') {
    const name = file.name.replace(/\.[^.]+$/, '').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet1';
    return new Blob([writeXlsx(rows, name)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  if (to === 'json') return textBlob(writeJson(rows), 'application/json');
  return textBlob(writeDelimited(rows, to === 'tsv' ? '\t' : ','), to === 'tsv' ? 'text/tab-separated-values' : 'text/csv');
}
