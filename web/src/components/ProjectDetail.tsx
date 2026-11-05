// A project's page (Trình dựng ▸ a project's ⓘ): its request sheet, the customer it belongs to and its own
// link on Drive, where the work stands, the script with what the timeline has for each scene, notes and exports. The
// editor is one click away.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStore, setState, openProject, toast, fmt } from '../store';
import { Icon } from './ui';
import { ReportList } from './Reports';
import type { Project, Render, Status } from '../types';

export const STATUS: [Exclude<Status, ''>, string][] = [['todo', 'Chưa làm'], ['doing', 'Đang dựng'], ['review', 'Chờ duyệt'], ['fix', 'Cần sửa'], ['done', 'Đã giao']];
/** A project nobody has given a status counts as being edited once it has clips. */
export const statusOf = (s: Status | undefined, clips: number): Exclude<Status, ''> => s || (clips ? 'doing' : 'todo');
export const statusName = (s: Status) => STATUS.find(([k]) => k === s)?.[1] || '';
/** "30/10/2026" (a sheet's deadline) → that day's time, or null. */
export function due(d?: string) {
  const m = String(d || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : null;
}
const DAY = 864e5;
const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime(); };
const two = (n: number) => String(n).padStart(2, '0');
const day = (ms: number) => { const d = new Date(ms); return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}`; };
const stamp = (ms: number) => { const d = new Date(ms); return `${two(d.getHours())}:${two(d.getMinutes())} · ${day(ms)}`; };
const norm = (r: string) => r.toLowerCase().replace(/\s+/g, ' ').trim();
const mb = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);

export function ProjectDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const editorOk = useStore((s) => s.pages.includes('editor') && s.editorAvailable);
  const [p, setP] = useState<Project | null>(null);
  const [err, setErr] = useState('');
  const [renders, setRenders] = useState<Render[]>([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [driveSource, setDriveSource] = useState<{ customerId: string; count: number | null; error?: string } | null>(null);
  const customerId = p?.customerId;
  useEffect(() => {
    let active = true;
    setDriveSource(null);
    if (customerId) {
      api.customer(customerId, true).then((customer) => {
        if (!active) return;
        if (customer.error) { setDriveSource({ customerId, count: null, error: customer.error }); return; }
        if (customer.storage === 'local') { setDriveSource({ customerId, count: null, error: 'Thư mục khách hàng chưa liên kết Drive' }); return; }
        const count = [...(customer.files || []), ...(customer.folders || []).flatMap((folder) => folder.files)].filter((f) => f.kind === 'video').length;
        setDriveSource({ customerId, count });
      }, (e) => { if (active) setDriveSource({ customerId, count: null, error: e.message }); });
    }
    return () => { active = false; };
  }, [customerId]);
  useEffect(() => {
    api.getProject(id).then((x) => { setP(x); setNote(x.note || ''); }, (e) => setErr(e.message));
    api.renders(id).then(setRenders, () => {});
  }, [id]);
  const back = <button className="pd-back" onClick={onBack}><Icon name="left" size={15} />Dự án</button>;
  if (!p) return <section className="ws-detail dash pd">{back}<p className={err ? 'note err' : 'note'}>{err || 'Đang tải…'}</p></section>;

  const sb = p.storyboard, sheet = p.sheet, form = sheet?.form, script = form?.script || [];
  const clips = (sb?.scenes || []).flatMap((s) => s.shots || []).filter((x) => x.media.provider !== 'outro').length;
  const length = (sb?.scenes || []).reduce((a, s) => a + s.duration, 0);
  const status = statusOf(p.status, clips);
  const missing = sheet?.missing || [];
  const exports = p.exports || [];
  const d = due(form?.deadline), t0 = today();
  const late = d !== null && d < t0 && status !== 'done', soon = d !== null && d >= t0 && d - t0 <= 2 * DAY && status !== 'done';
  const save = async (patch: { status?: Status; note?: string }) => {
    setSaving(true);
    try { const x = await api.saveProject(p.id, patch); setP((cur) => cur ? { ...cur, status: x.status, note: x.note, updatedAt: x.updatedAt } : cur); }
    catch (e: any) { toast(e.message, true); }
    finally { setSaving(false); }
  };
  const edit = async () => { setState({ view: 'editor' }); await openProject(p.id); };

  const steps: { name: string; ok: boolean; warn?: boolean; info: string }[] = [
    { name: 'Đọc sheet', ok: !!sheet, info: sheet ? `${sheet.tab ? `Tab “${sheet.tab}” · ` : ''}${script.length} cảnh trong kịch bản` : 'Dự án không có sheet' },
    { name: 'Khách hàng trên Drive', ok: !!p.customer, info: p.customer ? p.customer.name : 'Chưa gắn' },
    { name: 'Đang chỉnh sửa', ok: clips > 0, info: clips ? `${clips} clip · ${fmt(length)}${form?.seconds ? ` · sheet yêu cầu ~${form.seconds}s` : ''}` : 'Chưa có clip' },
    { name: 'Source trên Drive', ok: !!customerId && driveSource?.customerId === customerId && (driveSource.count || 0) > 0,
      warn: !!customerId && driveSource?.customerId === customerId && (!!driveSource.error || driveSource.count === 0),
      info: !customerId ? 'Chưa gắn khách hàng' : driveSource?.customerId !== customerId ? 'Đang kiểm tra video…' : driveSource.error ? `Không kiểm tra được: ${driveSource.error}` : driveSource.count ? `${driveSource.count} video trong thư mục khách hàng` : 'Chưa có video trong thư mục khách hàng' },
    { name: 'Outro logo', ok: !!p.outro, info: p.outro ? `${fmt(p.outro.media.duration || 0)} ở cuối video` : 'Chưa có' },
    { name: 'Giao khách', ok: status === 'done', info: statusName(status) },
  ];
  const done = steps.filter((s) => s.ok).length;
  // Where each script row sits on the timeline.
  const onTimeline = new Map<string, { clips: number; dur: number }>();
  for (const sc of sb?.scenes || []) onTimeline.set(norm(sc.headline || ''), { clips: sc.shots?.length || 0, dur: sc.duration });
  const history = [
    ...exports.map((e) => ({ at: e.at, what: e.to === 'capcut' ? 'Đưa vào CapCut' : 'Dự án CapCut (.zip)', name: e.name, link: '' })),
    ...renders.map((r) => ({ at: r.createdAt, what: `Video MP4 · ${mb(r.bytes)}`, name: '', link: r.download })),
  ].sort((a, b) => b.at - a.at);

  return (
    <section className="ws-detail dash pd">
      {back}
      <header className="pd-h">
        <div className="pd-title">
          <h2>{p.title}</h2>
          <p>
            <span>{form?.customer || 'Chưa rõ khách hàng'}</span>
            {form?.urgent && <em className="tag hot">Gấp</em>}
            {d !== null && <span className={late ? 'late' : soon ? 'soon' : ''}>Deadline {day(d)}{late ? ' · trễ hạn' : soon ? ' · sắp đến hạn' : ''}</span>}
            <span>Sửa lần cuối {stamp(p.updatedAt)}</span>
          </p>
        </div>
        <div className="pd-actions">
          {sheet && <a className="btn btn-gray" href={sheet.link} target="_blank" rel="noreferrer"><Icon name="share" size={14} />Mở sheet</a>}
          {editorOk && <button className="btn btn-primary" onClick={edit}><Icon name="film" size={15} />Mở trong Trình dựng</button>}
        </div>
      </header>

      <div className="pd-status">
        <span>Trạng thái</span>
        <div className="pd-seg" role="radiogroup" aria-label="Trạng thái">
          {STATUS.map(([k, l]) => <button key={k} role="radio" aria-checked={status === k} className={status === k ? `on ${k}` : ''} disabled={saving} onClick={() => status !== k && save({ status: k })}>{l}</button>)}
        </div>
      </div>

      <div className="dash-block">
        <h3>Tiến trình <span className="pd-count">{done}/{steps.length}</span></h3>
        <div className="pd-bar"><i style={{ width: `${(done / steps.length) * 100}%` }} /></div>
        <ol className="pd-steps">
          {steps.map((s) => (
            <li key={s.name} className={s.ok ? 'ok' : s.warn ? 'warn' : ''}>
              <span className="pd-dot">{s.ok ? <Icon name="check" size={12} /> : s.warn ? '!' : ''}</span>
              <b>{s.name}</b><span>{s.info}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="dash-block">
        <h3>Khách hàng</h3>
        <DriveCard p={p} onChange={(x) => setP((cur) => cur ? { ...cur, customerId: x.customerId, customer: x.customer, drive: x.drive, updatedAt: x.updatedAt } : x)} />
      </div>

      <div className="dash-block">
        <h3>Báo cáo Meta Ads (HTML)</h3>
        <ReportList projectId={p.id} customerId={p.customerId || null} driveFolder={p.drive?.folder ? p.drive.url : ''} />
      </div>

      <div className="pd-cols">
        <div className="dash-block">
          <h3>Thông tin sheet</h3>
          {sheet ? (
            <div className="pd-card">
              <a className="pd-sheet" href={sheet.link} target="_blank" rel="noreferrer">📄 {sheet.title}</a>
              <dl className="pd-dl">
                <dt>Khách hàng</dt><dd>{form?.customer || '—'}</dd>
                {sheet.tab && <><dt>Tab</dt><dd>{sheet.tab}</dd></>}
                <dt>Khung hình</dt><dd>{form?.aspect}</dd>
                <dt>Độ dài yêu cầu</dt><dd>~{form?.seconds}s</dd>
                <dt>Deadline</dt><dd>{form?.deadline || '—'}{form?.urgent ? ' · Gấp' : ''}</dd>
                <dt>Source tìm được</dt><dd>{p.sources?.length || 0} video</dd>
                {form?.ignored_rows && <><dt>Bỏ qua</dt><dd>{form.ignored_rows}</dd></>}
              </dl>
              {sheet.warning && <p className="pd-warn">⚠ {sheet.warning}</p>}
              {missing.length > 0 && (
                <div className="pd-warn">
                  <b>Thiếu {missing.length} file trên Drive</b>
                  <ul>{missing.map((m) => <li key={m}>{m}</li>)}</ul>
                  <p>Chia sẻ thư mục chứa các file này cho tài khoản Google đã kết nối, rồi mở dự án và bấm “Đọc lại sheet”.</p>
                </div>
              )}
            </div>
          ) : <p className="note">Dự án này không có sheet.</p>}
        </div>
        <div className="dash-block">
          <h3>Ghi chú</h3>
          <textarea className="pd-note" rows={5} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (p.note || '') && save({ note })}
            placeholder="Yêu cầu thêm của khách, việc còn lại, ai đang làm…" />
          <h3>Lịch sử xuất</h3>
          {history.length ? (
            <ul className="pd-history">
              {history.map((h, i) => (
                <li key={i}>
                  <b>{h.what}</b>{h.name && <span>{h.name}</span>}<time>{stamp(h.at)}</time>
                  {h.link && <a href={h.link}><Icon name="download" size={13} />Tải</a>}
                </li>
              ))}
            </ul>
          ) : <p className="note">Chưa xuất lần nào.</p>}
        </div>
      </div>

      {script.length > 0 && (
        <div className="dash-block">
          <h3>Kịch bản <span className="pd-count">{script.length} cảnh</span></h3>
          <div className="dash-table pd-script">
            <div className="pd-tr head"><span>Cảnh</span><span>Nội dung</span><span>Voice over</span><span>Source</span><span>Trên timeline</span></div>
            {script.map((r, i) => {
              const tl = onTimeline.get(norm(r.row));
              return (
                <div key={i} className="pd-tr">
                  <span><b>{r.row}</b>{r.duration && <small>{r.duration}</small>}</span>
                  <span title={r.visual}>{r.visual || '—'}</span>
                  <span title={r.voice_over}>{r.voice_over || '—'}</span>
                  <span title={r.source}>{r.source || '—'}</span>
                  <span className={tl ? '' : 'soon'}>{tl ? `${tl.clips} clip · ${fmt(tl.dur)}` : 'Chưa có clip'}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Choose the customer folder from CLIENTS and open its Drive link.
 */
function DriveCard({ p, onChange }: { p: Project; onChange: (p: Project) => void }) {
  const [list, setList] = useState<{ id: string; name: string; label: string }[] | null>(null);
  const [busy, setBusy] = useState('');
  const [listError, setListError] = useState('');
  const [choosing, setChoosing] = useState(false);
  const [query, setQuery] = useState('');
  const picker = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closePicker = () => { setChoosing(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!choosing) return;
    const outside = (e: PointerEvent) => { if (!picker.current?.contains(e.target as Node)) setChoosing(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [choosing]);
  const foldName = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();
  const matches = (list || []).filter((x) => foldName(x.name).includes(foldName(query)));

  useEffect(() => { api.customersAll().then(setList, (e) => { setList([]); setListError(e.message); }); }, []);
  const run = async (what: string, fn: () => Promise<Project>) => {
    setBusy(what);
    try { onChange(await fn()); return true; } catch (e: any) { toast(e.message, true); return false; } finally { setBusy(''); }
  };
  const c = p.customer;
  return (
    <div className="pd-card pd-drive">
      <div className="pd-line">
        <span className="pd-k">Khách hàng</span>
        <div className="pd-v">
          {c ? <>
            <b>{c.name}</b>
            <small title={c.label}>{c.label}</small>
            {c.driveUrl && <a href={c.driveUrl} target="_blank" rel="noreferrer"><Icon name="share" size={12} />Mở thư mục trên Drive</a>}
          </> : <span className="muted">{busy === 'auto' ? 'Đang tìm…' : 'Chưa gắn với khách hàng nào trên Drive'}</span>}
        </div>
        <div className="pd-ctl">
          <div className="pd-customer-picker" ref={picker} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); closePicker(); } }}>
            <button ref={trigger} type="button" className="pd-customer-trigger" disabled={!list || !!busy} aria-haspopup="dialog" aria-expanded={choosing} onClick={() => { setQuery(''); setChoosing(!choosing); }}>
              <span>{list === null ? 'Đang tải CLIENTS…' : c?.name || 'Chọn khách hàng'}</span><Icon name="down" size={14} />
            </button>
            {choosing && <div className="pd-customer-menu" role="dialog" aria-label="Chọn khách hàng trong CLIENTS">
              <input autoFocus type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm tên khách hàng…" aria-label="Tìm tên khách hàng" onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); picker.current?.querySelector<HTMLButtonElement>('.pd-customer-options button')?.focus(); }
                if (e.key === 'Enter' && matches.length === 1) { e.preventDefault(); closePicker(); void run('customer', () => api.saveProject(p.id, { customerId: matches[0].id })); }
              }} />
              <div className="pd-customer-options">
                <button type="button" className={!p.customerId ? 'selected' : ''} onClick={() => { closePicker(); void run('customer', () => api.saveProject(p.id, { customerId: null })); }}>— Bỏ gắn khách hàng —</button>
                {matches.map((x) => <button type="button" key={x.id} className={p.customerId === x.id ? 'selected' : ''} onClick={() => { closePicker(); void run('customer', () => api.saveProject(p.id, { customerId: x.id })); }}><span>{x.name}</span>{p.customerId === x.id && <Icon name="check" size={14} />}</button>)}
                {!matches.length && <p className="note" role="status">Không tìm thấy khách hàng.</p>}
              </div>
            </div>}
          </div>
          {!c && <button className="btn btn-gray btn-sm" disabled={!!busy} onClick={async () => { if (await run('auto', () => api.projectAutoCustomer(p.id))) toast('Đã tìm xong.'); }}>Tự tìm</button>}
        </div>
      </div>
      {listError && <p className="note err" role="alert">{listError}</p>}
      {list && !list.length && !listError && <p className="note">Chưa có khách hàng trong thư mục CLIENTS của workspace.</p>}
      <p className="note">Chọn khách hàng trong CLIENTS để liên kết dự án với thư mục Drive của khách hàng.</p>
    </div>
  );
}
