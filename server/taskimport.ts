// Reading a task list exported from the team's task app ("Tên công việc, Trạng thái, Thời gian bắt đầu, Thời hạn, Thời
// gian hoàn thành, Dự án (or Dịch vụ), Công việc cha, Danh sách nhãn, Tạo bởi, Giao cho, Mô tả, Kết quả công việc, Cập nhật gần nhất,
// Mã công việc (ID)"), pasted or saved as TSV/CSV: quoted cells may hold line breaks, HTML entities (&#124; &#61; …)
// are decoded, the rows that only group the list by assignee ("Bang Manh (9)") are skipped, and times
// ("23:59 30/10/2026") are Vietnam time. No I/O here (see tasks.ts).

export interface TaskRow {
  externalId: string; title: string; status: string; startAt: number | null; dueAt: number | null; doneAt: number | null;
  project: string; parent: string; labels: string[]; createdBy: string; assignees: string[]; description: string; result: string; sourceUpdatedAt: number | null;
}
type Field = keyof TaskRow;
/** Each field's column, by the names the app (or a person) may give it. */
const COLUMNS: [Field, string[]][] = [
  ['externalId', ['mã công việc (id)', 'mã công việc', 'id', 'task id']],
  ['title', ['tên công việc', 'công việc', 'tiêu đề', 'task', 'title', 'name']],
  ['status', ['trạng thái', 'status']],
  ['startAt', ['thời gian bắt đầu', 'ngày bắt đầu', 'bắt đầu', 'start', 'start date']],
  ['dueAt', ['thời hạn', 'hạn', 'hạn chót', 'deadline', 'due', 'due date']],
  ['doneAt', ['thời gian hoàn thành', 'ngày hoàn thành', 'hoàn thành lúc', 'completed', 'completed at']],
  ['project', ['dự án', 'dịch vụ', 'project', 'service']],
  ['parent', ['công việc cha', 'parent', 'parent task']],
  ['labels', ['danh sách nhãn', 'nhãn', 'labels', 'tags']],
  ['createdBy', ['tạo bởi', 'người tạo', 'created by']],
  ['assignees', ['giao cho', 'người thực hiện', 'người được giao', 'assignee', 'assignees']],
  ['description', ['mô tả', 'description']],
  ['result', ['kết quả công việc', 'kết quả', 'result']],
  ['sourceUpdatedAt', ['cập nhật gần nhất', 'cập nhật', 'last updated', 'updated']],
];
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const decodeEntities = (s: string) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, k) => ENT[k]);
/** A name compared without case, marks or extra spaces ("Nguyễn Đình Duy" = "nguyen dinh duy"). */
export const normName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, ' ').trim();

/** Rows of cells from delimited text; a cell in double quotes may hold the delimiter, line breaks and "" for a quote. */
export function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, i = 0;
  const s = text.replace(/^﻿/, '');
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i += 2; continue; } quoted = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell.trim() === '') { quoted = true; cell = ''; i++; continue; }
    if (ch === delim) { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += ch; i++;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** "23:59 30/10/2026", "30/10/2026 23:59" or "30/10/2026", Vietnam time (UTC+7, no daylight saving) → ms. */
export function parseVnDate(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const date = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/), time = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!date) return null;
  const [d, m, y] = [Number(date[1]), Number(date[2]), Number(date[3])];
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const [hh, mm, ss] = time ? [Number(time[1]), Number(time[2]), Number(time[3] || 0)] : [0, 0, 0];
  return Date.UTC(y, m - 1, d, hh - 7, mm, ss);
}

export type StatusKey = 'done' | 'done_late' | 'overdue' | 'doing' | 'todo' | 'paused' | 'cancelled' | 'other';
/** The app's status words, sorted into a few kinds. */
export function statusKey(s: string): StatusKey {
  const n = normName(s);
  if (!n) return 'todo';
  if (/hoan thanh muon|completed late|done late/.test(n)) return 'done_late';
  if (/^(hoan thanh|da hoan thanh|hoan tat|da xong|xong|done|completed)/.test(n)) return 'done';
  if (/qua han|overdue|tre han/.test(n)) return 'overdue';
  if (/dang (thuc hien|lam|xu ly)|in progress|doing/.test(n)) return 'doing';
  if (/chua (thuc hien|bat dau|lam)|^moi$|can lam|to ?do|not started|open/.test(n)) return 'todo';
  if (/tam dung|tam hoan|paused|on hold/.test(n)) return 'paused';
  if (/huy|cancel/.test(n)) return 'cancelled';
  return 'other';
}
const list = (s: string) => [...new Set(s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean))];

/** The source sheet, keeping original column names/order, extra fields and cell text. */
export function readTaskSheet(text: string) {
  const titles = COLUMNS.find(([f]) => f === 'title')![1].map(normName);
  const candidates = ['\t', ',', ';'].map(delim => {
    const rows = parseDelimited(text, delim);
    const known = rows.some(r => r.some(c => titles.includes(normName(decodeEntities(c)))));
    const width = rows.slice(0,25).reduce((n,r) => Math.max(n,r.length),0);
    return { rows, score: (known ? 100000 : 0) + width };
  }).sort((a,b) => b.score-a.score);
  const grid = candidates[0].rows;
  const knownHeader = grid.findIndex((r) => r.some((c) => titles.includes(normName(decodeEntities(c)))));
  const headAt = knownHeader >= 0 ? knownHeader : grid.findIndex(r => r.some(c => c.trim()));
  if (headAt < 0) throw new Error('File chưa có dữ liệu');
  const headers = [...grid[headAt]], rows = grid.slice(headAt + 1);
  const width = rows.reduce((n,r) => Math.max(n,r.length), headers.length);
  while (headers.length < width) headers.push('');
  return { headers, rows: rows.map(r => Array.from({ length: width }, (_, i) => r[i] ?? '')), titleColumn: headers.findIndex(c => titles.includes(normName(decodeEntities(c)))) };
}

/** Parsed tasks and their row indexes in the source sheet. */
export function readTaskExport(text: string) {
  const sheet = readTaskSheet(text);
  if (sheet.titleColumn < 0) throw new Error('Không thấy dòng tiêu đề (cần có cột “Tên công việc”)');
  const grid = [sheet.headers, ...sheet.rows], headAt = 0;
  const head = grid[headAt].map((c) => normName(decodeEntities(c)));
  const col = new Map<Field, number>();
  for (const [f, names] of COLUMNS) {
    const i = head.findIndex((h) => names.some((n) => normName(n) === h));
    if (i >= 0) col.set(f, i);
  }
  if (!col.has('title')) throw new Error('Thiếu cột “Tên công việc”');
  const rows: TaskRow[] = [];
  const sourceRows: number[] = [];
  let skipped = 0;
  for (const [sourceRow, r] of grid.slice(headAt + 1).entries()) {
    const get = (f: Field) => { const i = col.get(f); return i === undefined ? '' : decodeEntities(String(r[i] ?? '')).trim(); };
    const title = get('title');
    const filled = r.filter((c) => c.trim()).length;
    // "Bang Manh (9)": a group of the list by assignee, not a task.
    if (!title || (filled === 1 && /\(\d+\)$/.test(title))) { skipped++; continue; }
    sourceRows.push(sourceRow);
    rows.push({
      externalId: get('externalId'), title: title.slice(0, 500), status: get('status').slice(0, 60),
      startAt: parseVnDate(get('startAt')), dueAt: parseVnDate(get('dueAt')), doneAt: parseVnDate(get('doneAt')),
      project: get('project').slice(0, 200), parent: get('parent').slice(0, 500), labels: list(get('labels')).slice(0, 20),
      createdBy: get('createdBy').slice(0, 120), assignees: list(get('assignees')).slice(0, 20),
      description: get('description').slice(0, 20000), result: get('result').slice(0, 20000), sourceUpdatedAt: parseVnDate(get('sourceUpdatedAt')),
    });
  }
  return { rows, skipped, columns: [...col.keys()], sourceRows };
}
