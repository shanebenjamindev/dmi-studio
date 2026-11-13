// Báo cáo Ads: Meta Ads numbers pulled straight from the Marketing API for one ad account over a period, against the
// same number of days just before: the headline tiles (spend, total results, cost per result, CTR), the delivery
// numbers, a day-by-day chart of one measure at a time (with its table), and every campaign with its results by its
// conversion type. Admins connect Meta (an access token) on the settings tab. The formulas are the agency's reporting
// sheets' (server/meta.ts).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStore, toast } from '../store';
import { ReportEditor } from './Reports';
import { Icon, Segmented } from './ui';
import type { AdAccount, AdsConversion, AdsReport, AdsSettings } from '../types';
import { DayRangeField } from './DateRange';
import { askConfirm } from './AskDialog';

const LS = 'dms.ads';
type Preset = '7' | '14' | '30' | 'month' | 'lastMonth' | 'custom';
type Measure = 'spend' | 'leads' | 'messages' | 'linkClicks';
type Saved = { account: string; preset: Preset; since: string; until: string; measure: Measure };
const load = (): Saved => {
  const d: Saved = { account: '', preset: '30', since: '', until: '', measure: 'spend' };
  try { return { ...d, ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch { return d; }
};
const two = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const dmy = (s: string) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
const dm = (s: string) => { const [, m, d] = s.split('-'); return `${d}/${m}`; };
const PRESETS: [Preset, string][] = [['7', '7 ngày'], ['14', '14 ngày'], ['30', '30 ngày'], ['month', 'Tháng này'], ['lastMonth', 'Tháng trước'], ['custom', 'Tuỳ chọn']];
/** The days a preset covers, up to yesterday (today's numbers are still coming in). */
function rangeOf(p: Preset, s: Saved) {
  const t = new Date(), y = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1);
  if (p === 'month') return { since: iso(new Date(y.getFullYear(), y.getMonth(), 1)), until: iso(y) };
  if (p === 'lastMonth') return { since: iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), until: iso(new Date(t.getFullYear(), t.getMonth(), 0)) };
  if (p === 'custom' && s.since && s.until) return { since: s.since, until: s.until };
  const n = p === 'custom' ? 30 : Number(p);
  return { since: iso(new Date(y.getFullYear(), y.getMonth(), y.getDate() - n + 1)), until: iso(y) };
}

const nf = (v: number, digits = 0) => v.toLocaleString('vi-VN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const money = (v: number | null, cur: string) => (v === null ? '—' : v.toLocaleString('vi-VN', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: cur === 'VND' ? 0 : 2 }));
const pct = (v: number | null) => (v === null ? '—' : `${nf(v, 2)}%`);
const count = (v: number | null) => (v === null ? '—' : nf(v, v % 1 ? 1 : 0));
const compact = (v: number) => (v >= 1000 ? new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 }).format(v) : nf(v, v % 1 && v < 10 ? 1 : 0));
const TYPE_NAME: Record<AdsConversion, string> = { LeadForm: 'Lead', Messages: 'Tin nhắn', Traffic: 'Click link', Engagement: 'Tương tác' };
/** "Lead 52 · Tin nhắn 79 · Click link 364 · Bình luận 6": what the total adds up (results of different kinds are summed). */
function byType(r: AdsReport) {
  const sum = new Map<AdsConversion, number>();
  for (const k of r.campaigns) if (k.results.primary) sum.set(k.results.type, (sum.get(k.results.type) || 0) + k.results.primary);
  const parts = (['LeadForm', 'Messages', 'Traffic'] as AdsConversion[]).filter((t) => sum.get(t)).map((t) => `${TYPE_NAME[t]} ${count(sum.get(t)!)}`);
  if (r.current.comments) parts.push(`Bình luận ${count(r.current.comments)}`);
  return parts.join(' · ');
}

/** "↑ 4,2% so với kỳ trước", coloured by whether that direction is good for the measure. */
function Delta({ cur, prev, good }: { cur: number | null; prev: number | null; good: 'up' | 'down' }) {
  if (cur === null || prev === null) return <span className="ad-delta">—</span>;
  if (!prev) return <span className="ad-delta">{cur ? 'Mới so với kỳ trước' : 'Như kỳ trước'}</span>;
  const p = ((cur - prev) / Math.abs(prev)) * 100, flat = Math.abs(p) < 0.05;
  const tone = flat ? '' : (p > 0) === (good === 'up') ? 'good' : 'warn';
  return <span className={'ad-delta ' + tone}>{!flat && <Icon name={p > 0 ? 'up' : 'down'} size={12} />}{flat ? 'Như kỳ trước' : `${p > 0 ? '+' : '−'}${nf(Math.abs(p), 1)}% so với kỳ trước`}</span>;
}

export function AdsPage() {
  const admin = useStore((s) => s.user?.role === 'admin');
  const [reportId, setReportId] = useState<string | null>(() => location.hash.match(/^#ads\/report\/(r_\w+)$/)?.[1] || null);
  const openReport = (id: string | null) => { setReportId(id); history.replaceState(null, '', id ? `#ads/report/${id}` : '#ads'); };
  const [tab, setTab] = useState<'meta' | 'settings'>('meta');
  const [settings, setSettings] = useState<AdsSettings | null>(null);
  const [accounts, setAccounts] = useState<AdAccount[] | null>(null);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState<Saved>(load);
  const save = (p: Partial<Saved>) => setSaved((s) => { const n = { ...s, ...p }; try { localStorage.setItem(LS, JSON.stringify(n)); } catch { /* private mode */ } return n; });
  const readAccounts = (fresh = false) => {
    setErr('');
    api.adAccounts(fresh).then((a) => {
      setAccounts(a);
      if (a.length && !a.some((x) => x.id === saved.account)) save({ account: a[0].id });
    }, (e) => { setAccounts([]); setErr(e.message); });
  };
  useEffect(() => {
    readAccounts();
    if (admin) api.adsSettings().then(setSettings).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const notConnected = /Chưa kết nối Meta/.test(err);

  return (
    <div className="ad-page">
      <header className="ad-head">
        <h1>Meta Ads</h1>
        <div className="ad-presets" role="group" aria-label="Mục báo cáo Ads">
          {([['meta','Chi tiết Meta'],...(admin?[['settings','Cài đặt']]:[])] as ['meta'|'settings',string][]).map(([key,label])=><button key={key} className={tab===key?'on':''} aria-pressed={tab===key} onClick={()=>setTab(key)}>{label}</button>)}
        </div>
      </header>
      {tab === 'settings' && admin
        ? <AdsSettingsForm settings={settings} onSaved={(s) => { setSettings(s); readAccounts(true); if (s.metaConnected) setTab('meta'); }} />
        : notConnected
        ? <div className="ad-empty"><Icon name="key" size={22} /><h2>Chưa kết nối Meta Ads</h2>
            <p>{admin ? 'Dán access token của Meta (quyền ads_read) để DMI Workspace đọc số liệu quảng cáo trực tiếp.' : 'Quản trị viên chưa kết nối Meta Ads cho DMI Workspace.'}</p>
            {admin && <button className="btn btn-primary" onClick={() => setTab('settings')}>Kết nối Meta Ads</button>}</div>
        : accounts === null ? <p className="note ad-pad">Đang đọc tài khoản quảng cáo…</p>
        : err ? <p className="note err ad-pad">{err} <button className="bk-link" onClick={() => readAccounts(true)}>Thử lại</button></p>
        : !accounts.length ? <p className="note ad-pad">Token này chưa được cấp tài khoản quảng cáo nào. Trong Business Manager, giao tài khoản quảng cáo cho người dùng hệ thống của token (quyền xem hiệu quả).</p>
        : <MetaReport accounts={accounts} saved={saved} save={save} onAccounts={() => readAccounts(true)} onReport={openReport} />}
      {reportId && <ReportEditor id={reportId} driveFolder="" onClose={() => openReport(null)} />}
    </div>
  );
}

function MetaReport({ accounts, saved, save, onAccounts, onReport }: { accounts: AdAccount[]; saved: Saved; save: (p: Partial<Saved>) => void; onAccounts: () => void; onReport: (id: string) => void }) {
  const account = accounts.find((a) => a.id === saved.account) || accounts[0];
  const { since, until } = rangeOf(saved.preset, saved);
  const [r, setR] = useState<AdsReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [table, setTable] = useState(false);
  const [creating, setCreating] = useState(false);
  const createReport = async () => {
    setCreating(true);
    try { const report = await api.createReport({ meta: { account: account.id, since, until } }); onReport(report.id); if (report.autofillWarnings?.length) toast(report.autofillWarnings.join(' '), true); }
    catch (e: any) { toast(e.message, true); }
    finally { setCreating(false); }
  };
  const read = (fresh = false) => {
    let live = true;
    setBusy(true); setErr('');
    api.adsReport(account.id, since, until, fresh).then((x) => { if (live) setR(x); }, (e) => { if (live) { setErr(e.message); setR(null); } }).finally(() => live && setBusy(false));
    return () => { live = false; };
  };
  useEffect(() => read(), [account.id, since, until]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = account.currency, c = r?.current, p = r?.previous;
  const MEASURES: [Measure, string][] = [['spend', 'Chi tiêu'], ['leads', 'Lead'], ['messages', 'Tin nhắn'], ['linkClicks', 'Click link']];
  const fmt = (m: Measure) => (v: number) => (m === 'spend' ? money(v, cur) : count(v));

  return (
    <>
      <div className="ad-filters">
        <label className="ad-account">
          <span>Tài khoản quảng cáo</span>
          <select value={account.id} onChange={(e) => save({ account: e.target.value })}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.accountId}{a.active ? '' : ` (${a.status})`}</option>)}
          </select>
        </label>
        <div className="ad-presets" role="group" aria-label="Khoảng ngày">
          {PRESETS.map(([k, label]) => <button key={k} className={saved.preset === k ? 'on' : ''} aria-pressed={saved.preset === k}
            onClick={() => save(k === 'custom' ? { preset: k, since, until } : { preset: k })}>{label}</button>)}
        </div>
        {saved.preset === 'custom' && (
          <div className="ad-custom">
            <DayRangeField from={since} to={until} onChange={(f, t) => f && save({ since: f, until: t || f })} />
          </div>
        )}
        <button className="btn btn-primary btn-sm" disabled={creating || busy || !r || !!err || since > until} onClick={createReport}><Icon name="plus" size={14} />{creating ? 'Đang tạo báo cáo…' : 'Tạo báo cáo'}</button>
        <button className="btn btn-gray btn-sm ad-refresh" disabled={busy} onClick={() => { read(true); }} title="Lấy lại số liệu mới nhất từ Meta"><Icon name="refresh" size={14} />{busy ? 'Đang lấy…' : 'Làm mới'}</button>
      </div>
      <p className="ad-range">
        {dmy(since)} – {dmy(until)}{r && <> · so với {dmy(r.compare.since)} – {dmy(r.compare.until)}</>}
        {account.timezone && <> · giờ tài khoản {account.timezone}</>}{r?.lastDataDate && r.lastDataDate < until && <> · số liệu đến {dmy(r.lastDataDate)}</>}
        <button className="bk-link" onClick={onAccounts}>Tải lại danh sách tài khoản</button>
      </p>
      {err && <p className="note err">{err}</p>}
      {!r && !err ? <p className="note">Đang lấy số liệu từ Meta…</p> : r && c && p && (
        <div className={'ad-body' + (busy ? ' busy' : '')}>
          <section className="ad-tiles" aria-label="Chỉ số chính">
            <article><span>Tổng chi tiêu</span><b>{money(c.spend, cur)}</b><Delta cur={c.spend} prev={p.spend} good="up" /><small>Kỳ trước: {money(p.spend, cur)}</small></article>
            <article><span>Tổng kết quả</span><b>{count(c.total)}</b><Delta cur={c.total} prev={p.total} good="up" /><small>{byType(r) || 'Chưa có kết quả'} · Kỳ trước: {count(p.total)}</small></article>
            <article><span>Chi phí / kết quả</span><b>{money(c.costPerTotal, cur)}</b><Delta cur={c.costPerTotal} prev={p.costPerTotal} good="down" /><small>Kỳ trước: {money(p.costPerTotal, cur)}</small></article>
            <article><span>CTR</span><b>{pct(c.ctr)}</b><Delta cur={c.ctr} prev={p.ctr} good="up" /><small>{count(c.clicks)} click · {count(c.impressions)} hiển thị</small></article>
          </section>
          <section className="ad-delivery" aria-label="Phân phối">
            {([
              ['Hiển thị', count(c.impressions)], ['Tiếp cận', count(c.reach)], ['Tần suất', c.frequency === null ? '—' : nf(c.frequency, 2)], ['Click link', count(c.linkClicks)],
              ['CPC', money(c.cpc, cur)], ['CPM', money(c.cpm, cur)], ['Lead', count(c.leads)], ['CPL', money(c.cpl, cur)],
              ['Tin nhắn', count(c.messages)], ['Chi phí / tin nhắn', money(c.cpme, cur)], ['Chi phí / click link', money(c.cplc, cur)], ['Bình luận', count(c.comments)],
            ] as [string, string][]).map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
          </section>

          <section className="ad-card">
            <header className="ad-card-h">
              <h2>{(MEASURES.find(([m]) => m === saved.measure) || MEASURES[0])[1]} theo ngày</h2>
              <Segmented<Measure> small ariaLabel="Chỉ số" value={saved.measure} onChange={(m) => save({ measure: m })} options={MEASURES} />
              <button className="bk-link" onClick={() => setTable(!table)}>{table ? 'Xem biểu đồ' : 'Xem dạng bảng'}</button>
            </header>
            {table
              ? <div className="ad-scroll"><table className="ad-table"><thead><tr><th>Ngày</th><th>Chi tiêu</th><th>Hiển thị</th><th>Click</th><th>Click link</th><th>Lead</th><th>Tin nhắn</th></tr></thead>
                  <tbody>{r.daily.map((d) => <tr key={d.date}><td>{dmy(d.date)}</td><td>{money(d.spend, cur)}</td><td>{count(d.impressions)}</td><td>{count(d.clicks)}</td><td>{count(d.linkClicks)}</td><td>{count(d.leads)}</td><td>{count(d.messages)}</td></tr>)}</tbody></table></div>
              : <DailyBars days={r.daily.map((d) => ({ date: d.date, value: Number(d[saved.measure]) || 0 }))} format={fmt(saved.measure)} />}
          </section>

          <section className="ad-card">
            <header className="ad-card-h"><h2>Chiến dịch</h2><span className="ad-card-note">Kết quả chính theo loại chiến dịch; tổng kết quả = kết quả chính + bình luận</span></header>
            {!r.campaigns.length ? <p className="note">Không có chiến dịch nào chạy trong khoảng này.</p> : (
              <div className="ad-scroll">
                <table className="ad-table">
                  <thead><tr><th>Chiến dịch</th><th>Loại</th><th>Chi tiêu</th><th>Kết quả chính</th><th>Bình luận</th><th>Tổng</th><th>Chi phí / tổng</th><th>Kỳ trước</th><th>Thay đổi</th><th>CTR</th><th>Click link</th></tr></thead>
                  <tbody>
                    {r.campaigns.map((k) => {
                      const now = k.results.costPerTotal, before = k.previousCostPerTotal;
                      const ch = now !== null && before ? ((now - before) / before) * 100 : null;
                      return (
                        <tr key={k.id}>
                          <td className="ad-name"><b>{k.name}</b><small>{k.objective.replace(/^OUTCOME_/, '').toLowerCase()}</small></td>
                          <td>{TYPE_NAME[k.results.type]}{k.results.kpi && <small>{k.results.kpi}</small>}</td>
                          <td>{money(k.spend, cur)}</td>
                          <td>{count(k.results.primary)}</td>
                          <td>{count(k.comments)}</td>
                          <td>{count(k.results.total)}</td>
                          <td>{money(now, cur)}</td>
                          <td>{money(before, cur)}</td>
                          <td className={ch === null ? '' : Math.abs(ch) < 0.05 ? '' : ch < 0 ? 'good' : 'warn'}>{ch === null ? (now !== null && before === null && k.previousSpend === null ? 'Mới' : '—') : `${ch > 0 ? '+' : '−'}${nf(Math.abs(ch), 1)}%`}</td>
                          <td>{pct(k.ctr)}</td>
                          <td>{count(k.linkClicks)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}

/** One measure per day as columns from one baseline, with its value on hover or focus (and the table view for all). */
function DailyBars({ days, format }: { days: { date: string; value: number }[]; format: (v: number) => string }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  if (!days.length) return <div className="ad-chart" ref={box}><p className="note">Không có số liệu theo ngày trong khoảng này.</p></div>;
  const H = 220, left = 52, bottom = 26, top = 10, iw = Math.max(40, w - left - 8), ih = H - top - bottom;
  // Clean ticks: a step of 1, 2, 2.5 or 5 × 10ⁿ, four of them.
  const max = Math.max(...days.map((d) => d.value), 0);
  const raw = max / 4 || 1, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw)!;
  const top4 = step * 4, y = (v: number) => top + ih - (v / top4) * ih;
  const band = iw / days.length, bw = Math.max(2, Math.min(24, band - 2));
  const every = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(iw / 56))));
  const bar = (x: number, v: number) => {
    const h = Math.max(0, (v / top4) * ih), r = Math.min(4, h / 2, bw / 2), b = top + ih;
    return h ? `M${x},${b}V${b - h + r}Q${x},${b - h} ${x + r},${b - h}H${x + bw - r}Q${x + bw},${b - h} ${x + bw},${b - h + r}V${b}Z` : '';
  };
  const hd = hover === null ? null : days[hover];
  return (
    <div className="ad-chart" ref={box}>
      <svg width={w} height={H} role="img" aria-label="Biểu đồ cột theo ngày">
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1={left} x2={left + iw} y1={y(step * i)} y2={y(step * i)} className="ad-grid" />
            <text x={left - 8} y={y(step * i) + 4} className="ad-tick" textAnchor="end">{compact(step * i)}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = left + i * band + (band - bw) / 2;
          return (
            <g key={d.date} tabIndex={0} role="img" aria-label={`${dmy(d.date)}: ${format(d.value)}`} className={'ad-bar' + (hover === i ? ' on' : '')}
              onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
              <rect x={left + i * band} y={top} width={band} height={ih} fill="transparent" />
              <path d={bar(x, d.value)} />
              {i % every === 0 && <text x={x + bw / 2} y={H - 8} className="ad-tick" textAnchor="middle">{dm(d.date)}</text>}
            </g>
          );
        })}
      </svg>
      {hd && (
        <div className="ad-tip" style={{ left: Math.min(w - 140, Math.max(0, left + hover! * band + band / 2 - 70)) }}>
          <b>{format(hd.value)}</b><span>{dmy(hd.date)}</span>
        </div>
      )}
    </div>
  );
}

function AdsSettingsForm({ settings, onSaved }: { settings: AdsSettings | null; onSaved: (s: AdsSettings) => void }) {
  const [token, setToken] = useState('');
  const [version, setVersion] = useState(settings?.metaVersion || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (settings) setVersion(settings.metaVersion); }, [settings]);
  const submit = async (body: { metaToken?: string; metaVersion?: string }) => {
    setBusy(true); setMsg(null);
    try {
      const s = await api.saveAdsSettings(body);
      setToken('');
      setMsg({ ok: true, text: s.who ? `Đã kết nối: ${s.who.name} · đọc được ${s.who.accounts} tài khoản quảng cáo.` : 'Đã ngắt kết nối Meta Ads.' });
      onSaved(s);
    } catch (e: any) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  };
  return (
    <div className="ad-settings">
      <section className="ad-card">
        <h2>Kết nối Meta Ads</h2>
        <p className="ad-status">{settings === null ? 'Đang đọc…' : settings.metaConnected ? <><span className="ad-dot on" />Đang kết nối · token {settings.metaToken}</> : <><span className="ad-dot" />Chưa kết nối</>}</p>
        <form onSubmit={(e) => { e.preventDefault(); if (token.trim()) submit({ metaToken: token.trim(), metaVersion: version.trim() }); }}>
          <label className="ws-field"><span>Access token (quyền ads_read)</span>
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={settings?.metaConnected ? 'Dán token mới để thay' : 'EAAG…'} autoComplete="off" spellCheck={false} />
          </label>
          <label className="ws-field ad-version"><span>Phiên bản Graph API</span><input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="v26.0" /></label>
          <div className="ad-actions">
            <button className="btn btn-primary" disabled={busy || !token.trim()}>{busy ? 'Đang kiểm tra với Meta…' : 'Lưu và kiểm tra'}</button>
            {settings?.metaConnected && <button type="button" className="btn btn-gray" disabled={busy} onClick={async () => { if (await askConfirm('Ngắt kết nối Meta Ads? Trang Báo cáo Ads sẽ không đọc được số liệu cho tới khi dán token mới.')) submit({ metaToken: '' }); }}>Ngắt kết nối</button>}
            {settings?.metaConnected && <button type="button" className="btn btn-gray" disabled={busy || !version.trim() || version === settings.metaVersion} onClick={() => submit({ metaVersion: version.trim() })}>Lưu phiên bản</button>}
          </div>
          {msg && <p className={'note' + (msg.ok ? '' : ' err')}>{msg.text}</p>}
        </form>
      </section>
      <section className="ad-card ad-howto">
        <h2>Lấy token ở đâu</h2>
        <ol>
          <li>Vào <b>Business Settings</b> của Business Manager ▸ <b>Users ▸ System users</b> ▸ thêm một người dùng hệ thống (vai trò Employee là đủ).</li>
          <li><b>Assign assets</b>: chọn các tài khoản quảng cáo của khách, quyền <b>View performance</b>.</li>
          <li><b>Generate new token</b>: chọn app của công ty, hạn <b>Never</b>, tích quyền <b>ads_read</b>, rồi sao chép token và dán vào ô trên.</li>
        </ol>
        <p className="note">Token chỉ được lưu trên máy chủ DMI Workspace, không hiện lại đầy đủ và không gửi tới trình duyệt của người khác. DMI Workspace chỉ đọc số liệu, không sửa quảng cáo.</p>
      </section>
    </div>
  );
}
