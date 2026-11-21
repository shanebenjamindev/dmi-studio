// The chart views of Trang chủ's widgets (Home.tsx), drawn in plain SVG and HTML: a donut, horizontal bars, columns,
// stacked bars and stat tiles. Every mark carries its name and number in text (labels, a legend, a tooltip on hover),
// so nothing is told by colour alone; colours come from the --chart-* tokens (states) or are given per item.
import type { ReactNode } from 'react';

export type Part = { label: string; value: number; color: string; onClick?: () => void };

const pct = (n: number, all: number) => (all ? Math.round((n / all) * 100) : 0);
const tip = (p: Pick<Part, 'label' | 'value'>, all?: number) => `${p.label}: ${p.value}${all ? ` (${pct(p.value, all)}%)` : ''}`;

/** A ring of parts with the total in the middle and a legend of names, counts and shares beside it. */
export function Donut({ parts, total = parts.reduce((n, p) => n + p.value, 0), caption }: { parts: Part[]; total?: number; caption: string }) {
  const R = 52, W = 16, C = 2 * Math.PI * R, GAP = parts.filter((p) => p.value).length > 1 ? 2 : 0;
  let at = 0;
  return (
    <div className="hc-donut">
      <svg viewBox="0 0 128 128" role="img" aria-label={`${caption}: ${total}`}>
        <circle cx="64" cy="64" r={R} fill="none" stroke="var(--fill)" strokeWidth={W} />
        {total > 0 && parts.map((p) => {
          if (!p.value) return null;
          const len = (p.value / total) * C, dash = Math.max(0, len - GAP);
          const el = (
            <circle key={p.label} className={p.onClick ? 'go' : ''} cx="64" cy="64" r={R} fill="none" stroke={p.color} strokeWidth={W}
              strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-at} transform="rotate(-90 64 64)" onClick={p.onClick}>
              <title>{tip(p, total)}</title>
            </circle>
          );
          at += len;
          return el;
        })}
        <text x="64" y="62" textAnchor="middle" className="hc-donut-n">{total}</text>
        <text x="64" y="80" textAnchor="middle" className="hc-donut-c">{caption}</text>
      </svg>
      <Legend parts={parts} total={total} />
    </div>
  );
}

export function Legend({ parts, total }: { parts: Part[]; total?: number }) {
  return (
    <ul className="hc-legend">
      {parts.map((p) => (
        <li key={p.label} className={p.onClick ? 'go' : ''} onClick={p.onClick} title={tip(p, total)}>
          <i style={{ background: p.color }} /><span>{p.label}</span><b>{p.value}</b>{total ? <small>{pct(p.value, total)}%</small> : null}
        </li>
      ))}
    </ul>
  );
}

/** One bar per item, longest first as given: its name on the left, its count on the right. */
export function Bars({ items }: { items: Part[] }) {
  const max = Math.max(1, ...items.map((p) => p.value));
  return (
    <ul className="hc-bars">
      {items.map((p) => (
        <li key={p.label} className={p.onClick ? 'go' : ''} onClick={p.onClick} title={tip(p)}>
          <span className="hc-bars-l">{p.label}</span>
          <span className="hc-bars-t"><i style={{ width: `${(p.value / max) * 100}%`, background: p.color }} /></span>
          <b>{p.value}</b>
        </li>
      ))}
    </ul>
  );
}

/** Columns along a baseline, the count over each and its name under it (names may be short: dates, steps). */
export function Columns({ items, note }: { items: Part[]; note?: ReactNode }) {
  const max = Math.max(1, ...items.map((p) => p.value));
  return (
    <div className="hc-cols-wrap">
      <div className="hc-cols" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((p) => (
          <div key={p.label} className={'hc-col' + (p.onClick ? ' go' : '')} onClick={p.onClick} title={tip(p)}>
            <b>{p.value || ''}</b>
            <span className="hc-col-t"><i style={{ height: `${(p.value / max) * 100}%`, background: p.color }} /></span>
            <small>{p.label}</small>
          </div>
        ))}
      </div>
      {note}
    </div>
  );
}

/** One stacked bar per row (its parts side by side with a gap), the row's total at the end, the legend on top. */
export function Stacked({ rows, legend }: { rows: { label: string; parts: Part[]; onClick?: () => void }[]; legend: Part[] }) {
  const max = Math.max(1, ...rows.map((r) => r.parts.reduce((n, p) => n + p.value, 0)));
  return (
    <div className="hc-stacked">
      <Legend parts={legend} />
      <ul className="hc-bars">
        {rows.map((r) => {
          const all = r.parts.reduce((n, p) => n + p.value, 0);
          return (
            <li key={r.label} className={r.onClick ? 'go' : ''} onClick={r.onClick}>
              <span className="hc-bars-l" title={r.label}>{r.label}</span>
              <span className="hc-bars-t stacked"><span style={{ width: `${(all / max) * 100}%` }}>
                {r.parts.filter((p) => p.value).map((p) => <i key={p.label} style={{ flexGrow: p.value, background: p.color }} title={`${r.label} · ${tip(p, all)}`} />)}
              </span></span>
              <b>{all}</b>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Big numbers with their names; a tone marks the one that needs attention. */
export function Stats({ items }: { items: (Pick<Part, 'label' | 'value' | 'onClick'> & { tone?: 'bad' | 'good' })[] }) {
  return (
    <div className="hc-stats">
      {items.map((s) => (
        <div key={s.label} className={(s.tone || '') + (s.onClick ? ' go' : '')} onClick={s.onClick}><b>{s.value}</b><span>{s.label}</span></div>
      ))}
    </div>
  );
}
