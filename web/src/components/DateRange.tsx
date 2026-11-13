// Picking dates the way Airbnb does: one field for the whole span (start → due), opening a calendar of two months side
// by side. The first click is the start, the next the end, and the days between are shaded as one band (as the pointer
// moves, too); the bar on top says which end the next click sets, and the times sit right under the calendar.
import { useState, type ReactNode } from 'react';
import { Icon } from './ui';
import { Pop } from './boardkit';

/** A span of time in ms (either end may be missing: a task with a due date and no start, say). */
export type Span = { start: number | null; end: number | null };

const two = (n: number) => String(n).padStart(2, '0');
const keyOf = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const dayOf = (ms: number) => keyOf(new Date(ms));
const timeOf = (ms: number) => { const d = new Date(ms); return `${two(d.getHours())}:${two(d.getMinutes())}`; };
const msOf = (day: string, time: string) => new Date(`${day}T${time || '00:00'}`).getTime();
const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00`); d.setDate(d.getDate() + n); return keyOf(d); };
const WEEK = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
/** Every half hour of the day, for the time lists. */
const TIMES = Array.from({ length: 48 }, (_, i) => `${two(Math.floor(i / 2))}:${i % 2 ? '30' : '00'}`);

/** "17 thg 11" (and the year when it is not this one); with `time`, ", 09:00". */
export function dayLabel(ms: number, time = false) {
  const d = new Date(ms), year = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${d.getDate()} thg ${d.getMonth() + 1}${year}${time ? `, ${timeOf(ms)}` : ''}`;
}

/** The calendar with its bar and times. `single`: only the end (one date); `time`: the hours too (else whole days, the
 *  start at 00:00 and the end at 23:59 when `wholeDays`). Every click is a change (`onChange`): nothing to confirm. */
export function SpanPicker({ value, onChange, single = false, time = true, wholeDays = false, startLabel = 'Bắt đầu', endLabel = 'Hạn chót', footer }: {
  value: Span; onChange: (v: Span) => void; single?: boolean; time?: boolean; wholeDays?: boolean; startLabel?: string; endLabel?: string; footer?: ReactNode;
}) {
  const startDay = value.start != null ? dayOf(value.start) : null, endDay = value.end != null ? dayOf(value.end) : null;
  const [editing, setEditing] = useState<'start' | 'end'>(single || (startDay && !endDay) ? 'end' : 'start');
  const [hover, setHover] = useState<string | null>(null);
  const first = new Date(`${(editing === 'end' ? endDay || startDay : startDay || endDay) || keyOf(new Date())}T12:00`);
  const [view, setView] = useState(() => new Date(first.getFullYear(), first.getMonth(), 1));
  const months = typeof window !== 'undefined' && window.innerWidth < 720 ? 1 : 2;
  const startTime = value.start != null ? timeOf(value.start) : wholeDays || !time ? '00:00' : '09:00';
  const endTime = value.end != null ? timeOf(value.end) : wholeDays || !time ? '23:59' : '17:00';
  const today = keyOf(new Date());

  const set = (s: string | null, e: string | null, st = startTime, et = endTime) => onChange({ start: s ? msOf(s, st) : null, end: e ? msOf(e, et) : null });
  const pick = (day: string) => {
    if (single) { set(startDay, day); return; }
    if (editing === 'start') {
      set(day, endDay && endDay >= day ? endDay : null);
      setEditing('end');
    } else if (startDay && day < startDay) set(day, null);           // before the start: a new start, the end comes next
    else { set(startDay, day); setEditing('start'); }
  };
  // The band: from the start to the end, or to the day under the pointer while the end is being picked.
  const to = endDay || (editing === 'end' && startDay && hover && hover >= startDay ? hover : null);
  const from = single ? null : startDay;

  const month = (base: Date) => {
    const y = base.getFullYear(), m = base.getMonth(), lead = (new Date(y, m, 1).getDay() + 6) % 7, count = new Date(y, m + 1, 0).getDate();
    const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => keyOf(new Date(y, m, i + 1)))];
    return (
      <div className="dr-month" key={`${y}-${m}`}>
        <h4>Tháng {m + 1} năm {y}</h4>
        <div className="dr-grid" role="grid">
          {WEEK.map((w) => <span key={w} className="dr-wd">{w}</span>)}
          {cells.map((day, i) => {
            if (!day) return <span key={'e' + i} />;
            const isStart = day === from, isEnd = day === to || (single && day === endDay);
            const inside = !!from && !!to && day > from && day < to;
            const cls = ['dr-day', isStart && 'is-start', isEnd && 'is-end', inside && 'in-range', from && to && from !== to && (isStart || isEnd) && 'has-band', day === today && 'is-today', day < today && 'is-past'].filter(Boolean).join(' ');
            return <button type="button" key={day} className={cls} onClick={() => pick(day)} onMouseEnter={() => setHover(day)} onMouseLeave={() => setHover(null)}
              aria-pressed={isStart || isEnd} aria-label={dayLabel(new Date(`${day}T12:00`).getTime())}><span>{Number(day.slice(8))}</span></button>;
          })}
        </div>
      </div>
    );
  };
  const shift = (n: number) => setView(new Date(view.getFullYear(), view.getMonth() + n, 1));
  const seg = (which: 'start' | 'end', label: string, ms: number | null) => (
    <button type="button" className={'dr-seg' + (editing === which ? ' on' : '')} onClick={() => { setEditing(which); if (ms != null) setView(new Date(new Date(ms).getFullYear(), new Date(ms).getMonth() - (which === 'end' && months > 1 ? 1 : 0), 1)); }}>
      <small>{label}</small><b>{ms != null ? dayLabel(ms, time) : 'Chọn ngày'}</b>
      {ms != null && <i role="button" aria-label={`Bỏ ${label.toLowerCase()}`} onClick={(e) => { e.stopPropagation(); which === 'start' ? set(null, endDay) : set(startDay, null); setEditing(which); }}><Icon name="x" size={11} /></i>}
    </button>
  );
  // Quick ends, counted from the start (or today): Airbnb's "± days" chips.
  const base = startDay || today;
  const quick: [string, string][] = [['Hôm nay', today], ['Ngày mai', addDays(today, 1)], ['+3 ngày', addDays(base, 3)], ['+1 tuần', addDays(base, 7)], ['+2 tuần', addDays(base, 14)]];
  return (
    <div className="dr" onMouseDown={(e) => e.stopPropagation()}>
      <div className={'dr-bar' + (single ? ' single' : '')}>
        {!single && seg('start', startLabel, value.start)}
        {seg('end', endLabel, value.end)}
      </div>
      <div className="dr-cal">
        <button type="button" className="dr-nav prev" onClick={() => shift(-1)} aria-label="Tháng trước"><Icon name="left" size={16} /></button>
        <button type="button" className="dr-nav next" onClick={() => shift(1)} aria-label="Tháng sau"><Icon name="right" size={16} /></button>
        <div className="dr-months">{Array.from({ length: months }, (_, i) => month(new Date(view.getFullYear(), view.getMonth() + i, 1)))}</div>
      </div>
      <div className="dr-quick">
        {quick.filter(([, d]) => single || !startDay || d >= startDay).map(([label, d]) => <button type="button" key={label} className={'dr-chip' + (d === endDay ? ' on' : '')} onClick={() => { set(single ? startDay : startDay, d); setEditing('start'); setView(new Date(new Date(`${d}T12:00`).getFullYear(), new Date(`${d}T12:00`).getMonth(), 1)); }}>{label}</button>)}
      </div>
      {time && (
        <div className="dr-times">
          {!single && <label><span>Giờ bắt đầu</span><TimeSelect value={startTime} disabled={!startDay} onChange={(t) => set(startDay, endDay, t, endTime)} /></label>}
          <label><span>{single ? 'Giờ' : 'Giờ kết thúc'}</span><TimeSelect value={endTime} disabled={!endDay} onChange={(t) => set(startDay, endDay, startTime, t)} /></label>
        </div>
      )}
      <footer className="dr-foot">
        <button type="button" className="dr-clear" disabled={value.start == null && value.end == null} onClick={() => { onChange({ start: null, end: null }); setEditing(single ? 'end' : 'start'); }}>Xoá ngày</button>
        {footer}
      </footer>
    </div>
  );
}

function TimeSelect({ value, onChange, disabled }: { value: string; onChange: (t: string) => void; disabled?: boolean }) {
  return <select className="bk-in dr-time" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
    {!TIMES.includes(value) && <option value={value}>{value}</option>}
    {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
  </select>;
}

/** The field: the span in one pill ("17 thg 11, 09:00 → 19 thg 11, 17:00"), opening the calendar under it. */
export function SpanField({ value, onChange, single = false, time = true, wholeDays = false, startLabel = 'Bắt đầu', endLabel = 'Hạn chót', placeholder, disabled, className = '' }: {
  value: Span; onChange: (v: Span) => void; single?: boolean; time?: boolean; wholeDays?: boolean; startLabel?: string; endLabel?: string; placeholder?: string; disabled?: boolean; className?: string;
}) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const part = (ms: number | null, label: string) => <span className={'dr-part' + (ms == null ? ' empty' : '')}><small>{label}</small>{ms != null ? dayLabel(ms, time) : 'Thêm ngày'}</span>;
  const width = Math.min(single ? 360 : 680, (typeof window !== 'undefined' ? window.innerWidth : 680) - 16);
  return <>
    <button type="button" className={'dr-field ' + className + (el ? ' open' : '')} disabled={disabled} onClick={(e) => setEl(el ? null : e.currentTarget)} aria-haspopup="dialog" aria-expanded={!!el}>
      <Icon name="calendar" size={15} />
      {value.start == null && value.end == null && placeholder ? <span className="dr-part empty">{placeholder}</span>
        : single ? part(value.end, endLabel) : <>{part(value.start, startLabel)}<Icon name="right" size={12} />{part(value.end, endLabel)}</>}
    </button>
    {el && <Pop anchor={el} title={single ? endLabel : 'Chọn thời gian'} width={width} className="dr-pop" onClose={() => setEl(null)}>
      <SpanPicker value={value} onChange={onChange} single={single} time={time} wholeDays={wholeDays} startLabel={startLabel} endLabel={endLabel}
        footer={<button type="button" className="btn btn-primary btn-sm" onClick={() => setEl(null)}>Xong</button>} />
    </Pop>}
  </>;
}

/** The same for whole days kept as 'YYYY-MM-DD' (report ranges, filters): `from`/`to` may be ''. */
export function DayRangeField({ from, to, onChange, single = false, startLabel = 'Từ ngày', endLabel = 'Đến ngày', placeholder, min, max }: {
  from: string; to: string; onChange: (from: string, to: string) => void; single?: boolean; startLabel?: string; endLabel?: string; placeholder?: string; min?: string; max?: string;
}) {
  const ms = (d: string, t: string) => (d ? msOf(d, t) : null);
  const clamp = (d: string) => (d && max && d > max ? max : d && min && d < min ? min : d);
  return <SpanField value={{ start: ms(from, '00:00'), end: ms(to, '23:59') }} time={false} wholeDays single={single} startLabel={startLabel} endLabel={endLabel} placeholder={placeholder}
    onChange={(v) => onChange(v.start != null ? clamp(dayOf(v.start)) : '', v.end != null ? clamp(dayOf(v.end)) : '')} />;
}

/** 'YYYY-MM-DDTHH:mm' (the forms' own values) to ms and back. */
export const fromLocal = (s: string) => (s ? new Date(s).getTime() : null);
export const toLocal = (ms: number | null) => (ms == null ? '' : `${dayOf(ms)}T${timeOf(ms)}`);

/** The calendar in a window under what opened it, kept until Lưu (a card's or task's dates). */
export function SpanPop({ anchor, value, title = 'Thời gian', onClose, onSave }: { anchor: HTMLElement; value: Span; title?: string; onClose: () => void; onSave: (v: Span) => void }) {
  const [v, setV] = useState(value);
  const width = Math.min(680, window.innerWidth - 16);
  return <Pop anchor={anchor} title={title} width={width} className="dr-pop" onClose={onClose}>
    <SpanPicker value={v} onChange={setV} footer={<button type="button" className="btn btn-primary btn-sm" onClick={() => { onClose(); onSave(v); }}>Lưu</button>} />
  </Pop>;
}
