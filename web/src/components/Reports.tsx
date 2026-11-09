import {BrandLoading} from './BrandLoading';
import {EntitySelect,useEntityRefresh} from './QuickCreate';
// Meta Ads campaign reports: the page sent to a client once a campaign is set up (budget, ad sets, audience,
// creatives with captions, headlines and descriptions) and how it performs (Meta Ads numbers for a period, taken from
// the Marketing API into the report). Báo cáo ▸ Tất cả báo cáo lists every report; a project's page lists its own.
// The form on the left has every field of that page; the right
// shows the page as it will be exported (one self-contained .html file, see server/reports.ts). Images go in by choosing a
// file, dropping one, or pasting (⌘V) while the pointer is over the image's box; videos come from a Drive folder.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import { toast } from '../store';
import { Icon, Segmented } from './ui';
import { setDriveView, useDriveView } from '../driveView';
import type { AdAccount, Report, ReportData, ReportDriveFolder, ReportItem, ReportKV, ReportShot, ReportVideo } from '../types';

const two = (n: number) => String(n).padStart(2, '0');
const day = (ms: number) => { const d = new Date(ms); return `${two(d.getHours())}:${two(d.getMinutes())} · ${two(d.getDate())}/${two(d.getMonth() + 1)}`; };
const imgUrl = (id: string, file: string) => `/api/reports/${id}/images/${file}`;

const iso = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const dmy = (s: string) => (s ? s.split('-').reverse().join('/') : '');

/** Every report, newest first: whose it is, which Meta Ads numbers it carries; make one (for a customer or none) and open it. */
export function ReportsPage() {
  const [list, setList] = useState<ReportItem[] | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [customer, setCustomer] = useState('');
  const reloadCustomers=()=>api.reportCustomers().then(setCustomers);
  useEntityRefresh(()=>{void reloadCustomers().catch(()=>{});});
  const [busy, setBusy] = useState(false);
  const load = () => api.reports({}).then(setList, (e) => { toast(e.message, true); setList([]); });
  useEffect(() => { load(); api.reportCustomers().then(setCustomers, (e) => { setCustomers([]); toast('Không tải được khách hàng: ' + e.message, true); }); }, []);
  const create = async () => {
    setBusy(true);
    try { setOpen((await api.createReport({ customerId: customer || null })).id); load(); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const del = async (r: ReportItem) => { if (confirm(`Xoá báo cáo “${r.title}”?`)) { await api.deleteReport(r.id).catch((e) => toast(e.message, true)); load(); } };
  const shown = (list || []).filter((r) => `${r.title} ${r.customerName || ''} ${r.client || ''} ${r.meta?.account || ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="ad-page rp-all">
      <header className="ad-head">
        <h1>Tất cả báo cáo</h1>
        <label className="rp-search"><Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm báo cáo, khách, tài khoản" aria-label="Tìm báo cáo" /></label>
      </header>
      <div className="rp-new">
        <label><span>Khách hàng trong database</span>
          <EntitySelect kind="customer" value={customer} onCreated={reloadCustomers} onChange={setCustomer}>
            <option value="">Không gắn khách</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </EntitySelect>
        </label>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={create}><Icon name="plus" size={14} />{busy ? 'Đang lấy dữ liệu…' : 'Tạo báo cáo'}</button>
        <span className="note">Báo cáo mới lấy sẵn logo, video và dịch vụ của khách; trong báo cáo, mục “Hiệu quả Meta Ads” lấy số liệu quảng cáo trực tiếp.</span>
      </div>
      {list === null ? <BrandLoading label="Đang tải…"/> : !shown.length ? <p className="note">{q ? 'Không có báo cáo nào khớp.' : 'Chưa có báo cáo nào. Chọn khách rồi bấm “Tạo báo cáo”.'}</p> : (
        <div className="ad-card">
          <div className="ad-scroll">
            <table className="ad-table rp-table">
              <thead><tr><th>Báo cáo</th><th>Khách hàng</th><th>Số liệu Meta Ads</th><th>Sửa lần cuối</th><th /></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td className="ad-name"><button className="rp-open" onClick={() => setOpen(r.id)}><b>{r.title}</b></button></td>
                    {/* A name typed in the report but no customer behind it (never linked, or the customer was deleted). */}
                    <td>{r.customerName || (r.client ? <>{r.client} <small className="note">(chưa gắn khách)</small></> : '—')}</td>
                    <td>{r.meta ? <>{r.meta.account}<small>{dmy(r.meta.since)} – {dmy(r.meta.until)}</small></> : <span className="rp-none">Chưa lấy</span>}</td>
                    <td>{day(r.updatedAt)}</td>
                    <td className="rp-row-actions">
                      <button className="btn btn-gray btn-sm" onClick={() => setOpen(r.id)}>Sửa</button>
                      <a className="btn btn-gray btn-sm" href={`/api/reports/${r.id}/html`} target="_blank" rel="noreferrer">Xem</a>
                      <a className="btn btn-gray btn-sm" href={`/api/reports/${r.id}/html?download=1`}><Icon name="download" size={13} />HTML</a>
                      <button className="btn btn-gray btn-sm" onClick={() => del(r)} aria-label={`Xoá ${r.title}`}><Icon name="trash" size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {open && <ReportEditor id={open} driveFolder="" onClose={() => { setOpen(null); load(); }} />}
    </div>
  );
}

/** The reports of a project's customer (or of the project), with a way to make one and open it. */
export function ReportList({ projectId, customerId, driveFolder }: { projectId: string; customerId: string | null; driveFolder: string }) {
  const [list, setList] = useState<ReportItem[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.reports(customerId ? { customer: customerId } : { project: projectId }).then(setList, () => setList([]));
  useEffect(() => { load(); }, [projectId, customerId]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = async () => {
    setBusy(true);
    try { setOpen((await api.createReport({ projectId, customerId })).id); load(); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const del = async (r: ReportItem) => { if (confirm(`Xoá báo cáo “${r.title}”?`)) { await api.deleteReport(r.id).catch((e) => toast(e.message, true)); load(); } };
  return (
    <div className="pd-card rp-list">
      {list === null ? <BrandLoading label="Đang tải…"/> : !list.length ? <p className="note">Chưa có báo cáo. Bấm “Tạo báo cáo” để lập trang tóm tắt chiến dịch gửi khách (ngân sách, ad set, đối tượng, video kèm caption, headline).</p> : (
        <ul>
          {list.map((r) => (
            <li key={r.id}>
              <button className="rp-name" onClick={() => setOpen(r.id)}><b>{r.title}</b><span>Sửa lần cuối {day(r.updatedAt)}</span></button>
              <a className="btn btn-gray btn-sm" href={`/api/reports/${r.id}/html`} target="_blank" rel="noreferrer">Xem</a>
              <a className="btn btn-gray btn-sm" href={`/api/reports/${r.id}/html?download=1`}><Icon name="download" size={13} />HTML</a>
              <button className="btn btn-gray btn-sm" onClick={() => del(r)} aria-label={`Xoá ${r.title}`}><Icon name="trash" size={13} /></button>
            </li>
          ))}
        </ul>
      )}
      <div><button className="btn btn-primary btn-sm" disabled={busy} onClick={create}><Icon name="plus" size={14} />{busy ? 'Đang lấy dữ liệu…' : 'Tạo báo cáo'}</button></div>
      {open && <ReportEditor id={open} driveFolder={driveFolder} onClose={() => { setOpen(null); load(); }} />}
    </div>
  );
}

// ---------------------------------------------------------------- the editor
export function ReportEditor({ id, driveFolder, onClose }: { id: string; driveFolder: string; onClose: () => void }) {
  const [r, setR] = useState<Report | null>(null);
  const [state, setSave] = useState<'saved' | 'dirty' | 'saving'>('saved');
  const [filling, setFilling] = useState(false);
  const [fillWarnings, setFillWarnings] = useState<string[]>([]);
  const [v, setV] = useState(0); // preview version
  const timer = useRef<any>(0);
  const latest = useRef<Report | null>(null);
  useEffect(() => { api.report(id).then((x) => { setR(x); latest.current = x; setFolder(x.data.creatives.folder?.url || driveFolder); }, (e) => { toast(e.message, true); onClose(); }); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const flush = async () => {
    clearTimeout(timer.current);
    const x = latest.current; if (!x) return false;
    setSave('saving');
    try { await api.saveReport(x.id, { title: x.title, data: x.data }); setSave('saved'); setV((n) => n + 1); return true; } catch (e: any) { setSave('dirty'); toast('Lưu thất bại: ' + e.message, true); return false; }
  };
  const change = (next: Report) => { latest.current = next; setR(next); setSave('dirty'); clearTimeout(timer.current); timer.current = setTimeout(flush, 700); };
  /** Edit the report's data (a copy of the latest, so an upload finishing later keeps what was typed meanwhile). */
  const up = (fn: (d: ReportData) => void) => { const cur = latest.current; if (!cur) return; const d = structuredClone(cur.data); fn(d); change({ ...cur, data: d }); };
  // Pasting an image (⌘V) puts it in the image box under the pointer; text pastes as usual.
  const pasteTo = useRef<((f: File) => void) | null>(null);
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
      if (!file) return;
      e.preventDefault();
      if (pasteTo.current) pasteTo.current(file);
      else toast('Rê chuột vào ô ảnh (logo, ảnh chụp, thumbnail) rồi bấm ⌘V để dán.');
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);
  const [folder, setFolder] = useState('');
  const [taking, setTaking] = useState(false);
  const [linkTarget, setLinkTarget] = useState<number | null>(null);
  const libRef = useRef<HTMLDivElement>(null);
  /** Each video of a Drive folder becomes a creative with its link and thumbnail (captions written so far stay). */
  const takeVideos = async () => {
    const link = (folder || latest.current?.data.creatives.folder?.url || driveFolder).trim();
    if (!link) { toast('Dán link thư mục chứa video trên Google Drive.', true); return; }
    setTaking(true);
    try {
      if (!await flush()) return;
      const x = await api.reportVideos(id, link);
      latest.current = x; setR(x); setV((n) => n + 1); setFolder(x.data.creatives.folder?.url || '');
      toast(`Đã lấy ${x.videos} video từ “${x.data.creatives.folder?.name || 'thư mục'}”.`);
    } catch (e: any) { toast(e.message, true); } finally { setTaking(false); }
  };
  const [sharing, setSharing] = useState(false);
  /** Videos play in the report from Drive: anyone with the link must be able to view them for the client to watch. */
  const shareVideos = async () => {
    setSharing(true);
    try {
      if (!await flush()) return;
      const x = await api.shareReportVideos(id);
      toast(x.failed.length ? `Đã chia sẻ ${x.shared} video; không chia sẻ được: ${x.failed.join(', ')}` : x.shared ? `Khách xem được ${x.shared} video bằng link.` : 'Báo cáo chưa có video nào trên Drive.', !!x.failed.length);
    } catch (e: any) { toast(e.message, true); } finally { setSharing(false); }
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && close(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); });
  const close = async () => { if (state !== 'saved' && !await flush()) return; onClose(); };
  if (!r) return <div className="rp-editor"><BrandLoading label="Đang mở…"/></div>;
  const d = r.data;
  const upload = async (file: File | undefined, set: (name: string) => void) => {
    if (!file) return;
    try { set((await api.reportImage(r.id, file)).file); } catch (e: any) { toast(e.message, true); }
  };
  const pics = { id: r.id, upload, target: (fn: ((f: File) => void) | null) => { pasteTo.current = fn; } }; // what every image box needs

  const autofill = async () => {
    setFilling(true);
    try {
      if (!await flush()) return;
      const x = await api.autofillReport(id);
      latest.current = x; setR(x); setV((n) => n + 1); setFolder(x.data.creatives.folder?.url || driveFolder); setFillWarnings(x.autofillWarnings || []);
      toast('Đã tự điền các ô trống từ dữ liệu hiện có.');
    } catch (e: any) { toast(e.message, true); } finally { setFilling(false); }
  };
  return (
    <div className="rp-editor" role="dialog" aria-label="Báo cáo chiến dịch">
      <header className="rp-bar">
        <button className="rp-back" onClick={close}><Icon name="left" size={16} />Đóng</button>
        <input className="rp-title" value={r.title} onChange={(e) => change({ ...r, title: e.target.value })} aria-label="Tên báo cáo" />
        <button className="btn btn-gray btn-sm" disabled={filling} onClick={autofill}><Icon name="refresh" size={13} />{filling ? 'Đang tự điền…' : 'Tự điền dữ liệu'}</button>
        <span className="rp-state">{state === 'saving' ? 'Đang lưu…' : state === 'dirty' ? 'Chưa lưu' : 'Đã lưu'}</span>
        <a className="btn btn-gray btn-sm" href={`/api/reports/${r.id}/html`} target="_blank" rel="noreferrer" onClick={() => flush()}><Icon name="share" size={13} />Mở trang</a>
        <a className="btn btn-primary btn-sm" href={`/api/reports/${r.id}/html?download=1`} onClick={() => flush()}><Icon name="download" size={13} />Tải HTML</a>
      </header>
      <div className="rp-body">
        <div className="rp-form" inert={filling}>
          <p className="rp-tip">Tự điền các ô trống từ khách hàng, dự án và Meta Ads đã liên kết. Nội dung bạn đã nhập được giữ lại. Cấu hình Ads là cấu hình hiện tại; chi tiêu là số thực tế trong kỳ.</p>
          {fillWarnings.map((w) => <p key={w} className="note warn" role="status">{w}</p>)}
          <p className="rp-tip">Ảnh: bấm vào ô để chọn file, kéo thả file vào ô, hoặc chụp màn hình (⌘⇧⌃4) rồi rê chuột vào ô và bấm ⌘V. Rê vào “Thêm ảnh chụp” rồi ⌘V để thêm dòng mới kèm ảnh.</p>
          <Section title="Đầu trang">
            <Grid>
              <Field label="Khách hàng" value={d.client} onChange={(x) => up((t) => { t.client = x; })} />
              <Field label="Dòng trên tiêu đề" value={d.hero.eyebrow} onChange={(x) => up((t) => { t.hero.eyebrow = x; })} />
              <Field label="Tiêu đề" value={d.hero.title} onChange={(x) => up((t) => { t.hero.title = x; })} />
              <Field label="Phụ đề" value={d.hero.subtitle} onChange={(x) => up((t) => { t.hero.subtitle = x; })} />
              <Field label="Năm" value={d.hero.year} onChange={(x) => up((t) => { t.hero.year = x; })} />
              <Field label="Tháng" value={d.hero.month} onChange={(x) => up((t) => { t.hero.month = x; })} />
              <Field label="Nhãn (dịch vụ · chiến dịch)" value={d.hero.pill} onChange={(x) => up((t) => { t.hero.pill = x; })} />
            </Grid>
            <div className="rp-logos">
              <ImagePick {...pics} label="Logo agency" value={d.hero.agencyLogo} onChange={(f) => up((t) => { t.hero.agencyLogo = f; })} />
              <ImagePick {...pics} label="Logo khách" value={d.hero.clientLogo} onChange={(f) => up((t) => { t.hero.clientLogo = f; })} />
              <label className="rp-field rp-small"><span>Nền logo khách</span>
                <select value={d.hero.clientBg} onChange={(e) => up((t) => { t.hero.clientBg = e.target.value; })}>
                  <option value="#050505">Đen</option><option value="#ffffff">Trắng</option><option value="#0d265c">Xanh đậm</option>
                </select>
              </label>
            </div>
            <Grid>
              <Field label="Chân trang: tên agency" value={d.footer.brand} onChange={(x) => up((t) => { t.footer.brand = x; })} />
              <Field label="Chân trang: dòng mô tả" value={d.footer.line} onChange={(x) => up((t) => { t.footer.line = x; })} />
            </Grid>
          </Section>

          <Section title="Hiệu quả Meta Ads" on={d.performance.on} onToggle={(on) => up((t) => { t.performance.on = on; })}>
            <MetaSection r={r} up={up} flush={flush} onBusy={setFilling} onTaken={(x) => { latest.current = x; setR(x); setV((n) => n + 1); setFillWarnings(x.autofillWarnings || []); }} />
          </Section>

          <Section title="Ngân sách" on={d.budget.on} onToggle={(on) => up((t) => { t.budget.on = on; })}>
            <Grid>
              <Field label="Dòng nhỏ" value={d.budget.kicker} onChange={(x) => up((t) => { t.budget.kicker = x; })} />
              <Field label="Tiêu đề mục" value={d.budget.title} onChange={(x) => up((t) => { t.budget.title = x; })} />
              <Field label="Tên chỉ số" value={d.budget.statLabel} onChange={(x) => up((t) => { t.budget.statLabel = x; })} />
              <Field label="Số tiền (vd. $35)" value={d.budget.amount} onChange={(x) => up((t) => { t.budget.amount = x; })} />
              <Field label="Đơn vị" value={d.budget.currency} onChange={(x) => up((t) => { t.budget.currency = x; })} />
              <Field label="Ghi chú dưới số" value={d.budget.statFoot} onChange={(x) => up((t) => { t.budget.statFoot = x; })} />
            </Grid>
            <Field label="Bảng 1: tiêu đề" value={d.budget.settingsTitle} onChange={(x) => up((t) => { t.budget.settingsTitle = x; })} />
            <KVList items={d.budget.settings} onChange={(x) => up((t) => { t.budget.settings = x; })} />
            <Field label="Bảng 2: tiêu đề" value={d.budget.focusTitle} onChange={(x) => up((t) => { t.budget.focusTitle = x; })} />
            <KVList items={d.budget.focus} onChange={(x) => up((t) => { t.budget.focus = x; })} />
            <ShotList {...pics} items={d.budget.shots} add="View Budget Screenshot" onChange={(x) => up((t) => { t.budget.shots = x; })} />
          </Section>

          <Section title="Ad set" on={d.adsets.on} onToggle={(on) => up((t) => { t.adsets.on = on; })}>
            <Grid>
              <Field label="Dòng nhỏ" value={d.adsets.kicker} onChange={(x) => up((t) => { t.adsets.kicker = x; })} />
              <Field label="Tiêu đề mục" value={d.adsets.title} onChange={(x) => up((t) => { t.adsets.title = x; })} />
            </Grid>
            <Field label="Ghi chú chung: tiêu đề" value={d.adsets.noteTitle} onChange={(x) => up((t) => { t.adsets.noteTitle = x; })} />
            <Field label="Ghi chú chung" multi value={d.adsets.note} onChange={(x) => up((t) => { t.adsets.note = x; })} />
            {d.adsets.sets.map((s, i) => (
              <div key={i} className="rp-sub">
                <div className="rp-sub-h"><b>Ad set {two(i + 1)}</b><button className="rp-x" onClick={() => up((t) => { t.adsets.sets.splice(i, 1); })} aria-label="Bỏ ad set"><Icon name="trash" size={13} /></button></div>
                <Grid>
                  <Field label="Tên" value={s.name} onChange={(x) => up((t) => { t.adsets.sets[i].name = x; })} />
                  <Field label="Loại (nhãn góc)" value={s.type} onChange={(x) => up((t) => { t.adsets.sets[i].type = x; })} />
                </Grid>
                <Field label="Mô tả" value={s.desc} onChange={(x) => up((t) => { t.adsets.sets[i].desc = x; })} />
                <KVList items={s.details} onChange={(x) => up((t) => { t.adsets.sets[i].details = x; })} />
                <Field label="Website & display URL" value={s.url} placeholder="ceramic.example.com" onChange={(x) => up((t) => { t.adsets.sets[i].url = x; })} />
                <ShotList {...pics} items={s.shots} add="View Screenshot" onChange={(x) => up((t) => { t.adsets.sets[i].shots = x; })} />
              </div>
            ))}
            <button className="rp-add" onClick={() => up((t) => { t.adsets.sets.push({ name: '', desc: '', type: '', details: [{ label: '', value: '' }], url: '', shots: [] }); })}><Icon name="plus" size={13} />Thêm ad set</button>
            <div className="rp-sub">
              <label className="rp-check"><input type="checkbox" checked={d.adsets.form.on} onChange={(e) => up((t) => { t.adsets.form.on = e.target.checked; })} />Các bước Instant Form (ảnh chụp từng bước)</label>
              {d.adsets.form.on && <>
                <Grid>
                  <Field label="Dòng nhỏ" value={d.adsets.form.eyebrow} onChange={(x) => up((t) => { t.adsets.form.eyebrow = x; })} />
                  <Field label="Tiêu đề" value={d.adsets.form.title} onChange={(x) => up((t) => { t.adsets.form.title = x; })} />
                </Grid>
                <Field label="Mô tả" value={d.adsets.form.desc} onChange={(x) => up((t) => { t.adsets.form.desc = x; })} />
                <ShotList {...pics} items={d.adsets.form.steps} add="Bước mới" onChange={(x) => up((t) => { t.adsets.form.steps = x; })} />
              </>}
            </div>
          </Section>

          <Section title="Đối tượng" on={d.audience.on} onToggle={(on) => up((t) => { t.audience.on = on; })}>
            <Grid>
              <Field label="Dòng nhỏ" value={d.audience.kicker} onChange={(x) => up((t) => { t.audience.kicker = x; })} />
              <Field label="Tiêu đề mục" value={d.audience.title} onChange={(x) => up((t) => { t.audience.title = x; })} />
            </Grid>
            <Field label="Ghi chú (dùng **chữ** để in đậm)" multi value={d.audience.note} onChange={(x) => up((t) => { t.audience.note = x; })} />
            <KVList items={d.audience.fields} onChange={(x) => up((t) => { t.audience.fields = x; })} />
            <ShotList {...pics} items={d.audience.shots} add="Ad Set 01 Location" onChange={(x) => up((t) => { t.audience.shots = x; })} />
          </Section>

          <Section title="Video & caption" on={d.creatives.on} onToggle={(on) => up((t) => { t.creatives.on = on; })}>
            <Grid>
              <Field label="Dòng nhỏ" value={d.creatives.kicker} onChange={(x) => up((t) => { t.creatives.kicker = x; })} />
              <Field label="Tiêu đề mục" value={d.creatives.title} onChange={(x) => up((t) => { t.creatives.title = x; })} />
            </Grid>
            <div className="rp-sub">
              <span className="rp-label">Video từ thư mục Google Drive: mỗi video thành một mục, kèm link xem và thumbnail</span>
              {d.creatives.folder && <a className="rp-folder" href={d.creatives.folder.url} target="_blank" rel="noreferrer"><Icon name="folder" size={13} />{d.creatives.folder.name}</a>}
              <form className="rp-take" onSubmit={(e) => { e.preventDefault(); takeVideos(); }}>
                <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder={d.creatives.folder?.url || driveFolder || 'Dán link thư mục video trên Drive'} aria-label="Link thư mục video" />
                <button className="btn btn-primary btn-sm" disabled={taking}>{taking ? 'Đang lấy…' : d.creatives.folder ? 'Lấy lại' : 'Lấy video'}</button>
              </form>
              <p className="rp-note">Trong báo cáo, bấm vào ảnh là video phát ngay (trình phát của Drive). Khách chỉ xem được khi video cho phép “Bất kỳ ai có đường liên kết”.</p>
              <button className="btn btn-gray btn-sm rp-share" disabled={sharing || !d.creatives.items.some((c) => /drive\.google\.com/.test(c.url))} onClick={shareVideos}>
                <Icon name="share" size={13} />{sharing ? 'Đang chia sẻ…' : 'Cho khách xem các video bằng link'}
              </button>
            </div>
            <div ref={libRef}>
              <VideoLibrarySection r={r} folderLink={folder || d.creatives.folder?.url || driveFolder} targetIndex={linkTarget} onTargetChange={setLinkTarget} flush={flush}
                onLinked={(x) => { latest.current = x; setR(x); setV((n) => n + 1); }} />
            </div>
            <span className="rp-label">Link xem trước trên Facebook</span>
            <div className="rp-rows">
              {d.creatives.previews.map((p, i) => (
                <div key={i} className="rp-kv">
                  <input value={p.label} placeholder={`Facebook Preview ${two(i + 1)}`} onChange={(e) => up((t) => { t.creatives.previews[i].label = e.target.value; })} />
                  <input value={p.url} placeholder="https://fb.me/…" onChange={(e) => up((t) => { t.creatives.previews[i].url = e.target.value; })} />
                  <button className="rp-x" onClick={() => up((t) => { t.creatives.previews.splice(i, 1); })} aria-label="Bỏ"><Icon name="x" size={13} /></button>
                </div>
              ))}
              <button className="rp-add" onClick={() => up((t) => { t.creatives.previews.push({ label: '', url: '' }); })}><Icon name="plus" size={13} />Thêm link</button>
            </div>
            <Field label="Ghi chú dưới các link" multi value={d.creatives.caveat} onChange={(x) => up((t) => { t.creatives.caveat = x; })} />
            {d.creatives.items.map((c, i) => (
              <div key={i} className={'rp-sub' + (linkTarget === i ? ' rp-sub-target' : '')}>
                <div className="rp-sub-h">
                  <b>Video {two(i + 1)}</b>
                  <div className="rp-sub-actions">
                    <button type="button" className="btn btn-gray btn-sm" onClick={() => { setLinkTarget(linkTarget === i ? null : i); libRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }}>
                      <Icon name="search" size={12} />{linkTarget === i ? 'Đang chọn video Drive…' : c.url ? 'Đổi video Drive' : 'Tìm & liên kết video'}
                    </button>
                    <button className="rp-x" onClick={() => { if (linkTarget === i) setLinkTarget(null); up((t) => { t.creatives.items.splice(i, 1); }); }} aria-label="Bỏ video"><Icon name="trash" size={13} /></button>
                  </div>
                </div>
                <div className="rp-creative">
                  <ImagePick {...pics} label="Thumbnail" value={c.thumb} onChange={(f) => up((t) => { t.creatives.items[i].thumb = f; })} />
                  <div>
                    <Field label="Tên video" value={c.title} onChange={(x) => up((t) => { t.creatives.items[i].title = x; })} />
                    <Field label="Loại" value={c.type} placeholder="Video Creative · With Voiceover" onChange={(x) => up((t) => { t.creatives.items[i].type = x; })} />
                    <Field label="Link xem video (Drive)" value={c.url} onChange={(x) => up((t) => { t.creatives.items[i].url = x; })} />
                  </div>
                </div>
                {c.captions.map((x, k) => (
                  <div key={k} className="rp-caption">
                    <div className="rp-sub-h">
                      <input className="rp-cap-label" value={x.label} onChange={(e) => up((t) => { t.creatives.items[i].captions[k].label = e.target.value; })} aria-label="Tên caption" />
                      <button className="rp-x" onClick={() => up((t) => { t.creatives.items[i].captions.splice(k, 1); })} aria-label="Bỏ caption"><Icon name="x" size={13} /></button>
                    </div>
                    <textarea rows={4} value={x.text} placeholder="Dòng đầu là tiêu đề caption, mỗi dòng sau là một đoạn" onChange={(e) => up((t) => { t.creatives.items[i].captions[k].text = e.target.value; })} />
                  </div>
                ))}
                <button className="rp-add" onClick={() => up((t) => { t.creatives.items[i].captions.push({ label: `Caption ${c.captions.length + 1}`, text: '' }); })}><Icon name="plus" size={13} />Thêm caption</button>
              </div>
            ))}
            <button className="rp-add" onClick={() => up((t) => { t.creatives.items.push({ type: 'Video Creative', title: `Video ${two(t.creatives.items.length + 1)}`, url: '', thumb: '', captions: [{ label: 'Caption 1', text: '' }, { label: 'Caption 2', text: '' }, { label: 'Comment', text: '' }] }); })}><Icon name="plus" size={13} />Thêm video</button>
          </Section>

          <Section title="Headline & description" on={d.copy.on} onToggle={(on) => up((t) => { t.copy.on = on; })}>
            <Grid>
              <Field label="Dòng nhỏ" value={d.copy.kicker} onChange={(x) => up((t) => { t.copy.kicker = x; })} />
              <Field label="Tiêu đề mục" value={d.copy.title} onChange={(x) => up((t) => { t.copy.title = x; })} />
            </Grid>
            <Lines label="Headlines (mỗi dòng một phương án)" value={d.copy.headlines} onChange={(x) => up((t) => { t.copy.headlines = x; })} />
            <Lines label="Descriptions (mỗi dòng một phương án)" value={d.copy.descriptions} onChange={(x) => up((t) => { t.copy.descriptions = x; })} />
          </Section>
        </div>
        <Preview id={r.id} v={v} />
      </div>
    </div>
  );
}

/** The exported page, shown at its desktop width and scaled down to fit. */
const RANGES: [string, string, () => { since: string; until: string }][] = [
  ['lastMonth', 'Tháng trước', () => { const t = new Date(); return { since: iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), until: iso(new Date(t.getFullYear(), t.getMonth(), 0)) }; }],
  ['30', '30 ngày qua', () => { const t = new Date(); return { since: iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 30)), until: iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1)) }; }],
  ['7', '7 ngày qua', () => { const t = new Date(); return { since: iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 7)), until: iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1)) }; }],
  ['month', 'Tháng này', () => { const t = new Date(), y = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1); return { since: iso(new Date(y.getFullYear(), y.getMonth(), 1)), until: iso(y) }; }],
];
/**
 * The report's Meta Ads results: an ad account and a period; "Lấy số liệu" takes the numbers into the report (the page
 * keeps them as they were then, against the same number of days before), for those who may see Meta Ads numbers.
 */
function MetaSection({ r, up, flush, onTaken, onBusy }: { r: Report; up: (fn: (d: ReportData) => void) => void; flush: () => Promise<boolean>; onTaken: (x: Report) => void; onBusy: (busy: boolean) => void }) {
  const pf = r.data.performance;
  const [accounts, setAccounts] = useState<AdAccount[] | null>(null);
  const [err, setErr] = useState('');
  const [account, setAccount] = useState(pf.account?.id || '');
  const [range, setRange] = useState(() => (pf.since && pf.until ? { since: pf.since, until: pf.until } : RANGES[0][2]()));
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (pf.account?.id) setAccount(pf.account.id); if (pf.since && pf.until) setRange({ since: pf.since, until: pf.until }); }, [pf.account?.id, pf.since, pf.until]);
  useEffect(() => {
    api.adAccounts().then((a) => { setAccounts(a); setAccount((cur) => cur || a.find((x) => x.active)?.id || a[0]?.id || ''); },
      (e) => { setAccounts([]); setErr(/quyền vào trang/.test(e.message) ? 'Cần quyền trang Báo cáo (Meta Ads) để lấy số liệu; quản trị viên cấp trong Quản trị.' : e.message); });
  }, []);
  const take = async () => {
    if (range.since > range.until) { toast('Ngày bắt đầu phải trước ngày kết thúc', true); return; }
    setBusy(true); onBusy(true);
    try { if (!await flush()) return; const x = await api.reportMeta(r.id, { account, since: range.since, until: range.until }); onTaken(x); setErr(''); toast(x.autofillWarnings?.length ? 'Đã lấy số liệu. Một số cấu hình chưa đọc được từ token.' : 'Đã lấy số liệu và tự điền các ô trống.'); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(false); onBusy(false); }
  };
  const money = (v: number) => v.toLocaleString('vi-VN', { style: 'currency', currency: pf.account?.currency || 'USD', maximumFractionDigits: 2 });
  return (
    <>
      <Grid>
        <Field label="Dòng nhỏ" value={pf.kicker} onChange={(x) => up((t) => { t.performance.kicker = x; })} />
        <Field label="Tiêu đề mục" value={pf.title} onChange={(x) => up((t) => { t.performance.title = x; })} />
      </Grid>
      {err ? <p className="note err">{err}</p> : accounts === null ? <BrandLoading label="Đang đọc tài khoản quảng cáo…"/> : !accounts.length ? <p className="note">Token Meta chưa đọc được tài khoản quảng cáo nào.</p> : (
        <div className="rp-meta">
          <label className="rp-field"><span>Tài khoản quảng cáo</span>
            <select value={account} onChange={(e) => setAccount(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.accountId}{a.active ? '' : ` (${a.status})`}</option>)}
            </select>
          </label>
          <div className="rp-meta-ranges">
            {RANGES.map(([k, label, f]) => { const x = f(); return <button key={k} className={x.since === range.since && x.until === range.until ? 'on' : ''} onClick={() => setRange(x)}>{label}</button>; })}
          </div>
          <div className="rp-meta-dates">
            <input type="date" value={range.since} max={range.until} onChange={(e) => e.target.value && setRange({ ...range, since: e.target.value })} aria-label="Từ ngày" />
            <span>–</span>
            <input type="date" value={range.until} min={range.since} onChange={(e) => e.target.value && setRange({ ...range, until: e.target.value })} aria-label="Đến ngày" />
            <button className="btn btn-primary btn-sm" disabled={busy || !account} onClick={take}>{busy ? 'Đang lấy từ Meta…' : pf.data ? 'Lấy lại số liệu' : 'Lấy số liệu'}</button>
          </div>
        </div>
      )}
      {pf.data && pf.account
        ? <p className="rp-meta-sum">Trong báo cáo: <b>{pf.account.name}</b> · {dmy(pf.since)} – {dmy(pf.until)}{pf.fetchedAt ? ` · lấy lúc ${day(pf.fetchedAt)}` : ''}. Chi tiêu {money(pf.data.current.spend)}, tổng kết quả {pf.data.current.total.toLocaleString('vi-VN')}, {pf.data.campaigns.length} chiến dịch.</p>
        : <p className="rp-meta-sum">Chưa có số liệu: mục này chỉ hiện trong trang sau khi bấm “Lấy số liệu”.</p>}
      <Field label="Nhận xét dưới số liệu (không bắt buộc; **chữ đậm**)" multi value={pf.note} onChange={(x) => up((t) => { t.performance.note = x; })} />
    </>
  );
}

const durLabel = (s: number | null) => s && isFinite(s) ? `${Math.floor(s / 60)}:${two(Math.round(s % 60))}` : '';
const driveIdFromUrl = (url: string) => url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{20,})/)?.[1] || '';

/** Videos come from Drive through a picker: nothing is listed until it opens, and then one folder at a time. */
function VideoLibrarySection({ r, folderLink, targetIndex, onTargetChange, flush, onLinked }: {
  r: Report; folderLink: string; targetIndex: number | null; onTargetChange: (idx: number | null) => void; flush: () => Promise<boolean>; onLinked: (x: Report) => void;
}) {
  const [open, setOpen] = useState(false);
  const [linking, setLinking] = useState(false);
  const linkedIds = new Set(r.data.creatives.items.map((c) => driveIdFromUrl(c.url)).filter(Boolean));

  const linkItems = async (list: ReportVideo[], toIndex: number | null) => {
    if (!list.length) return false;
    setLinking(true);
    try {
      if (!await flush()) return false;
      const res = await api.linkReportVideos(r.id, list.map((v) => ({ id: v.id, account: v.account })), toIndex);
      onLinked(res);
      if (toIndex !== null) {
        toast(`Đã liên kết “${list[0].name}” vào Video ${two(toIndex + 1)}.`);
        onTargetChange(null);
      } else {
        toast(res.added ? `Đã liên kết thêm ${res.added} video vào báo cáo.` : 'Các video đã chọn đều có sẵn trong báo cáo.');
      }
      return true;
    } catch (e: any) {
      toast(e.message, true);
      return false;
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="rp-sub rp-vlib">
      <div className="rp-sub-h">
        <span className="rp-label"><b>Video từ Google Drive</b> (mở Drive, vào thư mục và chọn video)</span>
        <select className="rp-vlib-target" value={targetIndex === null ? '' : String(targetIndex)} onChange={(e) => onTargetChange(e.target.value === '' ? null : Number(e.target.value))} aria-label="Chế độ liên kết video">
          <option value="">+ Thêm thành mục video mới</option>
          {r.data.creatives.items.map((c, idx) => (
            <option key={idx} value={String(idx)}>Gắn vào Video {two(idx + 1)}: {c.title || 'Chưa đặt tên'}</option>
          ))}
        </select>
      </div>
      <button type="button" className="btn btn-primary btn-sm rp-vlib-open" disabled={linking} onClick={() => setOpen(true)}>
        <Icon name="folder" size={14} />{targetIndex !== null ? `Chọn video cho Video ${two(targetIndex + 1)} từ Drive` : 'Chọn video từ Drive'}
      </button>
      {open && <DriveVideoPicker r={r} folderLink={folderLink} single={targetIndex !== null} linkedIds={linkedIds} busy={linking}
        title={targetIndex !== null ? `Chọn video cho Video ${two(targetIndex + 1)}` : 'Chọn video từ Google Drive'}
        onClose={() => setOpen(false)} onPick={async (list) => { if (await linkItems(list, targetIndex)) setOpen(false); }} />}
    </div>
  );
}

/** Drive in a popup: the connected accounts' drives on the side, one folder's sub-folders and videos in the middle (it
 *  starts in the report's video folder when it has one), and a search by name across Drive when asked. */
function DriveVideoPicker({ r, folderLink, single, linkedIds, busy, title, onClose, onPick }: {
  r: Report; folderLink: string; single: boolean; linkedIds: Set<string>; busy: boolean; title: string; onClose: () => void; onPick: (list: ReportVideo[]) => void;
}) {
  const [places, setPlaces] = useState<NonNullable<ReportDriveFolder['places']>>([]);
  const [folder, setFolder] = useState<ReportDriveFolder | null>(null);
  const [found, setFound] = useState<ReportVideo[] | null>(null);
  const [q, setQ] = useState('');
  const view = useDriveView();
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Record<string, ReportVideo>>({});
  const dialog = useRef<HTMLDialogElement>(null);

  const go = async (at: { account?: string; id?: string; folder?: string; places?: boolean }) => {
    setLoading(true); setErr(''); setFound(null);
    try { const f = await api.reportDriveBrowse(r.id, at); if (f.places) setPlaces(f.places); setFolder(f); }
    catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { dialog.current?.showModal(); void go({ folder: folderLink.trim() || undefined, places: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) { setFound(null); return; }
    setLoading(true); setErr('');
    try { setFound((await api.reportVideoLibrary(r.id, q.trim())).videos); }
    catch (x: any) { setErr(x.message); }
    finally { setLoading(false); }
  };
  const toggle = (v: ReportVideo) => setPicked((cur) => { const next = { ...cur }; if (next[v.id]) delete next[v.id]; else next[v.id] = v; return next; });
  const chosen = Object.values(picked), videos = found ?? folder?.videos ?? [];

  return (
    <dialog ref={dialog} className="sheet wide rp-picker" onClose={onClose} onCancel={onClose} onClick={(e) => { if (e.target === dialog.current) onClose(); }}>
      <div className="sheet-in">
        <header className="sheet-h"><h2>{title}</h2><button className="bd-icon close" onClick={onClose} aria-label="Đóng"><Icon name="x" size={16} /></button></header>
        <div className="rp-picker-body">
          <nav className="rp-picker-places" aria-label="Drive">
            {places.map((p) => (
              <button key={p.account + p.id} className={folder?.account === p.account && folder.crumbs[0]?.name === p.label ? 'on' : ''} onClick={() => go({ account: p.account, id: p.id })}>
                <Icon name="folder" size={15} /><span><b>{p.label}</b><small>{p.account}</small></span>
              </button>
            ))}
          </nav>
          <section className="rp-picker-main">
            <form className="rp-take" onSubmit={search}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm video theo tên trên Drive…" aria-label="Tìm video theo tên" />
              <button className="btn btn-gray btn-sm" disabled={loading}><Icon name="search" size={13} />Tìm</button>
              <Segmented small value={view} onChange={setDriveView} ariaLabel="Kiểu xem mặc định của Drive"
                options={[['grid', <span key="g" className="dv-seg" title="Dạng lưới"><Icon name="grid" size={15} /></span>], ['list', <span key="l" className="dv-seg" title="Dạng danh sách"><Icon name="list" size={15} /></span>]]} />
            </form>
            {found ? (
              <p className="rp-picker-crumbs"><button className="link" onClick={() => { setFound(null); setQ(''); }}><Icon name="left" size={12} />Quay lại thư mục</button><span>Kết quả cho “{q}”</span></p>
            ) : folder && (
              <p className="rp-picker-crumbs">{folder.crumbs.map((c, i) => (
                <span key={c.id}>{i > 0 && <i>›</i>}{i < folder.crumbs.length - 1 ? <button className="link" onClick={() => go({ account: folder.account, id: c.id })}>{c.name}</button> : <b>{c.name}</b>}</span>
              ))}</p>
            )}
            {err ? <p className="note err" role="alert">{err}</p> : loading ? <BrandLoading label="Đang mở Drive…" compact /> : (
              <div className={'rp-picker-list' + (view === 'grid' ? ' grid' : '')}>
                {!found && folder?.dirs.map((d) => (
                  <button key={d.id} className="rp-picker-dir" onClick={() => go({ account: folder.account, id: d.id })}><Icon name="folder" size={18} /><span>{d.name}</span><Icon name="right" size={14} /></button>
                ))}
                {videos.map((v) => {
                  const isLinked = linkedIds.has(v.id), isChecked = !!picked[v.id];
                  return (
                    <div key={v.id} className={'rp-vlib-item' + (isLinked ? ' linked' : '') + (isChecked ? ' checked' : '')}>
                      {!single && <input type="checkbox" checked={isChecked} disabled={isLinked} onChange={() => toggle(v)} aria-label={`Chọn ${v.name}`} />}
                      <div className="rp-vlib-thumb">
                        <img src={v.thumb} alt="" loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                        {durLabel(v.seconds) && <span>{durLabel(v.seconds)}</span>}
                      </div>
                      <div className="rp-vlib-meta"><b title={v.name}>{v.name}</b><small><a href={v.url} target="_blank" rel="noreferrer">Xem trên Drive ↗</a></small></div>
                      {single ? <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onPick([v])}>Chọn</button>
                        : isLinked ? <span className="rp-note">Đã liên kết</span> : null}
                    </div>
                  );
                })}
                {!videos.length && !(folder?.dirs.length && !found) && <p className="rp-note">{found ? `Không có video nào tên có “${q}”.` : 'Thư mục này không có video.'}</p>}
              </div>
            )}
          </section>
        </div>
        {!single && <footer className="sheet-f"><span className="rp-note">{chosen.length ? `Đã chọn ${chosen.length} video` : 'Tích các video muốn liên kết'}</span>
          <button className="btn btn-gray" onClick={onClose}>Huỷ</button>
          <button className="btn btn-primary" disabled={busy || !chosen.length} onClick={() => onPick(chosen)}>{busy ? 'Đang liên kết…' : `Liên kết ${chosen.length || ''} video`}</button></footer>}
      </div>
    </dialog>
  );
}

function Preview({ id, v }: { id: string; v: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0.4);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setK(el.clientWidth / 1440));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="rp-preview" ref={box}>
      <iframe title="Xem trước báo cáo" src={`/api/reports/${id}/html?v=${v}`} style={{ width: 1440, height: `${100 / k}%`, transform: `scale(${k})` }} />
    </div>
  );
}

// ---------------------------------------------------------------- form pieces
function Section({ title, on, onToggle, children }: { title: string; on?: boolean; onToggle?: (on: boolean) => void; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className={'rp-section' + (on === false ? ' off' : '')}>
      <header>
        <button className="rp-fold" onClick={() => setOpen(!open)} aria-expanded={open}><Icon name={open ? 'down' : 'right'} size={14} />{title}</button>
        {onToggle && <label className="rp-check"><input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} />Hiện trong trang</label>}
      </header>
      {open && on !== false && <div className="rp-section-b">{children}</div>}
    </section>
  );
}
const Grid = ({ children }: { children: ReactNode }) => <div className="rp-grid">{children}</div>;
function Field({ label, value, onChange, multi, placeholder }: { label: string; value: string; onChange: (v: string) => void; multi?: boolean; placeholder?: string }) {
  return (
    <label className="rp-field"><span>{label}</span>
      {multi ? <textarea rows={3} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /> : <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
    </label>
  );
}
/** Label/value rows (a table of the page). */
function KVList({ items, onChange }: { items: ReportKV[]; onChange: (x: ReportKV[]) => void }) {
  const set = (i: number, p: Partial<ReportKV>) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <div className="rp-rows">
      {items.map((x, i) => (
        <div key={i} className="rp-kv">
          <input value={x.label} placeholder="Tên trường" onChange={(e) => set(i, { label: e.target.value })} />
          <input value={x.value} placeholder="Giá trị" onChange={(e) => set(i, { value: e.target.value })} />
          <button className="rp-x" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Bỏ dòng"><Icon name="x" size={13} /></button>
        </div>
      ))}
      <button className="rp-add" onClick={() => onChange([...items, { label: '', value: '' }])}><Icon name="plus" size={13} />Thêm dòng</button>
    </div>
  );
}
/** A list as one item per line. */
function Lines({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join('\n'));
  return (
    <label className="rp-field"><span>{label}</span>
      <textarea rows={6} value={text} onChange={(e) => { setText(e.target.value); onChange(e.target.value.split('\n').map((l) => l.trim()).filter(Boolean)); }} />
    </label>
  );
}
type Upload = (f: File | undefined, set: (name: string) => void) => Promise<void>;
/** Screenshots behind buttons: the button's words and the picture. */
type Target = (fn: ((f: File) => void) | null) => void;
function ShotList({ id, upload, target, items, onChange, add }: { id: string; upload: Upload; target: Target; items: ReportShot[]; onChange: (x: ReportShot[]) => void; add: string }) {
  const latest = useRef({ items, onChange });
  latest.current = { items, onChange };
  // A picture pasted or dropped on "Thêm ảnh chụp" becomes a new row.
  const addWith = (f: File) => upload(f, (image) => latest.current.onChange([...latest.current.items, { label: add, image }]));
  return (
    <div className="rp-rows">
      {items.map((s, i) => (
        <div key={i} className="rp-shot">
          <input value={s.label} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="Chữ trên nút" />
          <ImagePick id={id} upload={upload} target={target} value={s.image} label="Ảnh chụp" onChange={(f) => latest.current.onChange(latest.current.items.map((x, j) => (j === i ? { ...x, image: f } : x)))} />
          <button className="rp-x" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Bỏ"><Icon name="x" size={13} /></button>
        </div>
      ))}
      <button className="rp-add" onClick={() => onChange([...items, { label: add, image: '' }])} title="Bấm để thêm dòng; rê chuột vào đây rồi ⌘V để thêm dòng kèm ảnh vừa chụp"
        onMouseEnter={() => target(addWith)} onMouseLeave={() => target(null)}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) addWith(f); }}>
        <Icon name="plus" size={13} />Thêm ảnh chụp</button>
    </div>
  );
}
/** An image box: click to choose a file, drop one on it, or paste (⌘V) while the pointer is over it. */
function ImagePick({ id, value, onChange, label, upload, target }: { id: string; value: string; onChange: (f: string) => void; label: string; upload: Upload; target: Target }) {
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(onChange);
  latest.current = onChange;
  const [over, setOver] = useState(false);
  const take = (f: File | undefined) => upload(f, (name) => latest.current(name));
  const aim = (on: boolean) => { setOver(on); target(on ? (f) => take(f) : null); };
  return (
    <div className={'rp-img' + (over ? ' over' : '')} onMouseEnter={() => aim(true)} onMouseLeave={() => aim(false)}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) take(f); }}>
      <button className="rp-img-b" onClick={() => input.current?.click()} onFocus={() => aim(true)} onBlur={() => aim(false)} title={`${value ? 'Đổi ảnh' : 'Chọn ảnh'} · ⌘V để dán · kéo thả file`} style={value ? { backgroundImage: `url("${imgUrl(id, value)}")` } : undefined}>
        {!value && <><Icon name="photo" size={16} /><span>{label}</span></>}
        {over && <em className="rp-paste">⌘V để dán</em>}
      </button>
      {value && <button className="rp-img-x" onClick={() => onChange('')} aria-label={`Bỏ ${label}`}><Icon name="x" size={11} /></button>}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}
