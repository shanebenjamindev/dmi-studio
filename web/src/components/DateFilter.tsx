// Lists filtered and grouped by when things were made or last changed: the field (Ngày tạo / Ngày sửa), a span of days
// (the Airbnb-like picker), and groups from today back (Hôm nay, Hôm qua, 7 ngày qua…), newest first in each.
import { useState } from 'react';
import { DayRangeField } from './DateRange';

export type DateField = 'created' | 'updated';
export type DateFilterState = { field: DateField; from: string; to: string };
type Dated = { createdAt?: number | null; updatedAt?: number | null };

const at = (r: Dated, field: DateField) => (field === 'created' ? r.createdAt : r.updatedAt ?? r.createdAt) ?? null;
const VN = 7 * 3600e3, DAY = 86400e3;
const dayStart = (d: string) => new Date(`${d}T00:00`).getTime();

export function useDateFilter() {
  const [f, setF] = useState<DateFilterState>({ field: 'updated', from: '', to: '' });
  return [f, setF] as const;
}
/** The rows whose date (of the field chosen) falls within the span; all of them when no span is set. */
export function filterByDate<T extends Dated>(rows: T[], f: DateFilterState) {
  if (!f.from && !f.to) return rows;
  const from = f.from ? dayStart(f.from) : -Infinity, to = f.to ? dayStart(f.to) + DAY : Infinity;
  return rows.filter((r) => { const t = at(r, f.field); return t != null && t >= from && t < to; });
}
/** Groups by how long ago they were made (`created`) or changed (`updated`), newest first. */
export function byRecent<T extends Dated>(rows: T[], field: DateField) {
  const today = Math.floor((Date.now() + VN) / DAY) * DAY - VN;
  const slot = (t: number | null) => t == null ? 'none' : t >= today ? 'today' : t >= today - DAY ? 'yesterday' : t >= today - 7 * DAY ? 'week' : t >= today - 30 * DAY ? 'month' : 'older';
  const order: [string, string][] = [['today', 'Hôm nay'], ['yesterday', 'Hôm qua'], ['week', '7 ngày qua'], ['month', '30 ngày qua'], ['older', 'Cũ hơn'], ['none', 'Không rõ ngày']];
  return order.map(([key, label]) => ({ key, label, rows: rows.filter((r) => slot(at(r, field)) === key).sort((a, b) => (at(b, field) ?? 0) - (at(a, field) ?? 0)) }))
    .filter((g) => g.rows.length);
}

/** The filter's controls: which date, then the span. */
export function DateFilterBar({ value, onChange }: { value: DateFilterState; onChange: (v: DateFilterState) => void }) {
  return (
    <span className="date-filter">
      <select className="date-filter-field" aria-label="Lọc theo ngày" value={value.field} onChange={(e) => onChange({ ...value, field: e.target.value as DateField })}>
        <option value="created">Ngày tạo</option>
        <option value="updated">Ngày sửa</option>
      </select>
      <DayRangeField from={value.from} to={value.to} placeholder="Mọi ngày" onChange={(from, to) => onChange({ ...value, from, to })} />
    </span>
  );
}
