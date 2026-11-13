// Charts for Thống kê, drawn as SVG: a line chart over periods (crosshair and one tooltip for every series), columns
// for one series over periods, horizontal bars for a distribution (with stacked segments for two parts), and a donut for
// a part-to-whole of a few kinds. One axis each. Series colours come in a fixed order (--viz-1…8, validated for colour
// blindness in light and dark); kinds with a colour of their own (a status, a category) keep it. Every chart has a
// legend when it has two series or more, and can be read as a table.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fmtNum } from './kit';

export const SERIES = (i: number) => `var(--viz-${(i % 8) + 1})`;
export type Dist = { key: string; label: string; value: number; color?: string }[];
export type Trend = { keys: string[]; lines: { name: string; values: number[] }[] };

/** A period key ('2026-11-07', '2026-11', '2026-Q4', '2026') as people read it. */
export function periodLabel(k: string, period: string) {
  if (period === 'quarter' || period === 'year') return k.replace('-Q', ' Q');
  if (period === 'month') { const [y, m] = k.split('-'); return `${m}/${y}`; }
  const [, m, d] = k.split('-');
  return period === 'week' ? `Tuần ${d}/${m}` : `${d}/${m}`;
}
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null), [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 600));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}
/** Round axis ticks from 0 to just above the largest value. */
function ticks(max: number) {
  if (max <= 0) return [0, 1];
  // Counts: whole steps only.
  const raw = Math.max(1, max / 4), mag = 10 ** Math.floor(Math.log10(raw)), step = Math.max(1, [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!);
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001 || out.length < 2; v += step) out.push(Math.round(v * 1000) / 1000);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

/** A chart with its title, legend and the switch to read its numbers as a table. */
export function ChartCard({ title, sub, legend, table, children, wide }: { title: string; sub?: ReactNode; legend?: { label: string; color: string }[]; table: { head: string[]; rows: (string | number)[][] }; children: ReactNode; wide?: boolean }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={'ax-chart' + (wide ? ' wide' : '')}>
      <header>
        <div><h3>{title}</h3>{sub && <p>{sub}</p>}</div>
        <button className="ax-chart-switch" onClick={() => setAsTable(!asTable)} aria-pressed={asTable}>{asTable ? 'Biểu đồ' : 'Bảng'}</button>
      </header>
      {legend && legend.length > 1 && !asTable && <ul className="ax-legend">{legend.map((l) => <li key={l.label}><i style={{ background: l.color }} />{l.label}</li>)}</ul>}
      {asTable ? (
        <div className="ax-table-wrap"><table className="ax-table compact"><thead><tr>{table.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={j ? { textAlign: 'right' } : undefined}>{typeof c === 'number' ? fmtNum(c) : c}</td>)}</tr>)}</tbody></table></div>
      ) : children}
    </section>
  );
}

const H = 220, PAD = { l: 40, r: 12, t: 12, b: 26 };
/** Lines over periods; the pointer's period shows every series at once. */
export function LineChart({ trend, period, colors }: { trend: Trend; period: string; colors?: string[] }) {
  const [ref, w] = useWidth<HTMLDivElement>(), [at, setAt] = useState<number | null>(null);
  const n = trend.keys.length, max = Math.max(0, ...trend.lines.flatMap((l) => l.values)), ys = ticks(max), top = ys[ys.length - 1] || 1;
  const x = (i: number) => PAD.l + (n <= 1 ? (w - PAD.l - PAD.r) / 2 : (i * (w - PAD.l - PAD.r)) / (n - 1)), y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / top);
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((w - PAD.l) / 70))));
  const color = (i: number) => colors?.[i] || SERIES(i);
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), px = e.clientX - r.left;
    setAt(n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((px - PAD.l) / (w - PAD.l - PAD.r)) * (n - 1)))));
  };
  return (
    <div className="ax-plot" ref={ref}>
      <svg width={w} height={H} onPointerMove={move} onPointerLeave={() => setAt(null)} role="img" aria-label={trend.lines.map((l) => l.name).join(', ')}>
        {ys.map((v) => <g key={v}><line className="ax-grid" x1={PAD.l} x2={w - PAD.r} y1={y(v)} y2={y(v)} /><text className="ax-tick" x={PAD.l - 6} y={y(v) + 4} textAnchor="end">{fmtNum(v)}</text></g>)}
        {trend.keys.map((k, i) => (i % every === 0 ? <text key={k} className="ax-tick" x={x(i)} y={H - 8} textAnchor="middle">{periodLabel(k, period)}</text> : null))}
        {at !== null && <line className="ax-cross" x1={x(at)} x2={x(at)} y1={PAD.t} y2={H - PAD.b} />}
        {trend.lines.map((l, li) => (
          <g key={l.name}>
            <polyline fill="none" stroke={color(li)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={l.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
            {(at !== null || n <= 1) && <circle cx={x(at ?? 0)} cy={y(l.values[at ?? 0] || 0)} r={4} fill={color(li)} stroke="var(--ax-surface)" strokeWidth={2} />}
          </g>
        ))}
      </svg>
      {at !== null && (
        <div className="ax-tip" style={{ left: Math.min(Math.max(x(at), 80), w - 80) }}>
          <b>{periodLabel(trend.keys[at], period)}</b>
          {trend.lines.map((l, li) => <span key={l.name}><i style={{ background: color(li) }} /><strong>{fmtNum(l.values[at])}</strong>{l.name}</span>)}
        </div>
      )}
    </div>
  );
}

/** One series as columns over periods. */
export function Columns({ keys, values, period, name }: { keys: string[]; values: number[]; period: string; name: string }) {
  const [ref, w] = useWidth<HTMLDivElement>(), [at, setAt] = useState<number | null>(null);
  const n = keys.length, ys = ticks(Math.max(0, ...values)), top = ys[ys.length - 1] || 1;
  const band = (w - PAD.l - PAD.r) / Math.max(1, n), bw = Math.max(2, Math.min(28, band - 2));
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / top), every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((w - PAD.l) / 70))));
  return (
    <div className="ax-plot" ref={ref}>
      <svg width={w} height={H} role="img" aria-label={name}>
        {ys.map((v) => <g key={v}><line className="ax-grid" x1={PAD.l} x2={w - PAD.r} y1={y(v)} y2={y(v)} /><text className="ax-tick" x={PAD.l - 6} y={y(v) + 4} textAnchor="end">{fmtNum(v)}</text></g>)}
        {keys.map((k, i) => {
          const cx = PAD.l + band * i + band / 2, h = H - PAD.b - y(values[i]);
          return (
            <g key={k}>
              <rect x={PAD.l + band * i} y={PAD.t} width={band} height={H - PAD.t - PAD.b} fill="transparent" onPointerEnter={() => setAt(i)} onPointerLeave={() => setAt(null)} />
              {values[i] > 0 && <path d={`M${cx - bw / 2},${H - PAD.b} v${-Math.max(0, h - 4)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${Math.max(0, h - 4)} z`} fill={at === i ? 'var(--viz-1-strong)' : 'var(--viz-1)'} pointerEvents="none" />}
              {i % every === 0 && <text className="ax-tick" x={cx} y={H - 8} textAnchor="middle">{periodLabel(k, period)}</text>}
            </g>
          );
        })}
      </svg>
      {at !== null && <div className="ax-tip" style={{ left: Math.min(Math.max(PAD.l + band * at + band / 2, 80), w - 80) }}><b>{periodLabel(keys[at], period)}</b><span><strong>{fmtNum(values[at])}</strong>{name}</span></div>}
    </div>
  );
}

/** A distribution as horizontal bars, largest first, each with its value at the end. */
/** Props of a row that opens what it counts (`onPick`): a button for the pointer and the keyboard alike. */
const pickable = (key: string, onPick?: (key: string) => void) => onPick
  ? { role: 'button', className: 'pick', onClick: () => onPick(key), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(key); } } }
  : {};
export function Bars({ dist, total, onPick }: { dist: Dist; total?: number; onPick?: (key: string) => void }) {
  const max = Math.max(1, ...dist.map((d) => d.value)), sum = total ?? dist.reduce((a, d) => a + d.value, 0);
  if (!dist.length) return <p className="ax-nodata">Chưa có số liệu</p>;
  return (
    <ul className="ax-bars">{dist.map((d, i) => (
      <li key={d.key} title={`${d.label}: ${fmtNum(d.value)}${sum ? ` (${Math.round((d.value / sum) * 100)}%)` : ''}`} tabIndex={0} {...pickable(d.key, onPick)}>
        <span className="ax-bar-label">{d.label}</span>
        <span className="ax-bar-track"><span className="ax-bar-fill" style={{ width: `${(d.value / max) * 100}%`, background: d.color || (dist.length > 8 ? 'var(--viz-1)' : SERIES(i)) }} /></span>
        <span className="ax-bar-value">{fmtNum(d.value)}{sum ? <small>{Math.round((d.value / sum) * 100)}%</small> : null}</span>
      </li>
    ))}</ul>
  );
}
/** Two parts of each row side by side in one bar (e.g. in progress and overdue). */
export function StackBars({ rows, parts, onPick }: { rows: { key: string; label: string; values: number[] }[]; parts: { name: string; color: string }[]; onPick?: (key: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.values.reduce((a, v) => a + v, 0)));
  if (!rows.length) return <p className="ax-nodata">Chưa có số liệu</p>;
  return (
    <ul className="ax-bars">{rows.map((r) => (
      <li key={r.key} title={`${r.label}: ${r.values.map((v, i) => `${parts[i].name} ${fmtNum(v)}`).join(' · ')}`} tabIndex={0} {...pickable(r.key, onPick)}>
        <span className="ax-bar-label">{r.label}</span>
        <span className="ax-bar-track stack">{r.values.map((v, i) => (v ? <span key={i} className="ax-bar-fill" style={{ width: `${(v / max) * 100}%`, background: parts[i].color }} /> : null))}</span>
        {/* Each part's name is its own text, so the English interface can put it in English; a code (REVIEW) keeps its case. */}
        <span className="ax-bar-value">{r.values.map((v, i) => <span key={i}>{i > 0 && ' · '}{fmtNum(v)} {/^[A-Z]+$/.test(parts[i].name) ? parts[i].name : parts[i].name.toLocaleLowerCase('vi')}</span>)}</span>
      </li>
    ))}</ul>
  );
}
/** Part-to-whole of a few kinds; the middle holds the total, the list beside it each kind's share. */
/** Whole percentages that add up to 100: rounded down, then the points left go to the largest remainders. */
function shares(values: number[]) {
  const total = values.reduce((a, v) => a + v, 0);
  if (!total) return values.map(() => 0);
  const raw = values.map((v) => (v / total) * 100), out = raw.map(Math.floor);
  const left = 100 - out.reduce((a, v) => a + v, 0);
  raw.map((v, i) => [v - out[i], i]).sort((x, y) => y[0] - x[0]).slice(0, left).forEach(([, i]) => out[i]++);
  return out;
}
export function Donut({ dist, center }: { dist: Dist; center: string }) {
  const total = dist.reduce((a, d) => a + d.value, 0), [at, setAt] = useState<string | null>(null), share = shares(dist.map((d) => d.value));
  if (!total) return <p className="ax-nodata">Chưa có số liệu</p>;
  const R = 70, r = 46, C = 90;
  let a0 = -Math.PI / 2;
  const arcs = dist.filter((d) => d.value > 0).map((d, i) => {
    const a1 = a0 + (d.value / total) * Math.PI * 2, gap = dist.length > 1 ? 0.012 : 0, large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad: number, a: number) => `${C + rad * Math.cos(a)},${C + rad * Math.sin(a)}`;
    const path = a1 - a0 >= Math.PI * 2 - 1e-6
      ? `M${C},${C - R} a${R},${R} 0 1,1 0,${2 * R} a${R},${R} 0 1,1 0,${-2 * R} M${C},${C - r} a${r},${r} 0 1,0 0,${2 * r} a${r},${r} 0 1,0 0,${-2 * r}`
      : `M${p(R, a0 + gap)} A${R},${R} 0 ${large} 1 ${p(R, a1 - gap)} L${p(r, a1 - gap)} A${r},${r} 0 ${large} 0 ${p(r, a0 + gap)} Z`;
    a0 = a1;
    return { d, path, color: d.color || SERIES(dist.indexOf(d)), i };
  });
  const hit = arcs.find((x) => x.d.key === at);
  return (
    <div className="ax-donut">
      <svg viewBox="0 0 180 180" width={180} height={180} role="img" aria-label={center}>
        {arcs.map((x) => <path key={x.d.key} d={x.path} fill={x.color} fillRule="evenodd" opacity={at && at !== x.d.key ? 0.45 : 1} onPointerEnter={() => setAt(x.d.key)} onPointerLeave={() => setAt(null)} />)}
        <text x={C} y={C - 2} textAnchor="middle" className="ax-donut-total">{fmtNum(hit ? hit.d.value : total)}</text>
        <text x={C} y={C + 16} textAnchor="middle" className="ax-tick">{hit ? `${share[dist.indexOf(hit.d)]}%` : center}</text>
      </svg>
      <ul className="ax-legend vertical">{dist.map((d, i) => (
        <li key={d.key} onPointerEnter={() => setAt(d.key)} onPointerLeave={() => setAt(null)}><i style={{ background: d.color || SERIES(i) }} /><span>{d.label}</span><b>{fmtNum(d.value)}</b><small>{share[i]}%</small></li>
      ))}</ul>
    </div>
  );
}
