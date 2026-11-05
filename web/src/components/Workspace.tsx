import {Rich} from './boardkit';
// Workspace: customers, their info, their videos (on Google Drive via Google sign-in, or a folder on this Mac) and their projects.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStore, toast } from '../store';
import { Icon, IconButton, Menu, Segmented } from './ui';
import { FolderPicker } from './FolderPicker';
import { Dashboard } from './Dashboard';
import type { Loc, Customer, CustomerLink, DriveFile, DriveFolder, FileKind, WorkspaceInfo } from '../types';

const LS_SEL = 'dms.customer', LS_VIEW = 'dms.driveView';
const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const size = (b: number) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : b >= 1e3 ? Math.round(b / 1e3) + ' KB' : b + ' B');
const date = (t: number) => new Date(t).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Kinds of file, in the order and with the names, icons and colours of Drive's "Type" filter.
const FILE_KINDS: FileKind[] = ['folder', 'video', 'image', 'audio', 'pdf', 'doc', 'sheet', 'slides', 'archive', 'other'];
const KIND_NAME: Record<FileKind, string> = { folder: 'Thư mục', video: 'Video', image: 'Hình ảnh', audio: 'Âm thanh', pdf: 'PDF', doc: 'Tài liệu', sheet: 'Bảng tính', slides: 'Bản trình bày', archive: 'File nén', other: 'Khác' };
const KIND_ICON: Record<FileKind, string> = { folder: 'folder', video: 'film', image: 'photo', audio: 'music', pdf: 'file', doc: 'doc', sheet: 'sheet', slides: 'slides', archive: 'zip', other: 'file' };
const KIND_COLOR: Record<FileKind, string> = { folder: '#5f6368', video: '#d93025', image: '#e37400', audio: '#9334e6', pdf: '#b31412', doc: '#1a73e8', sheet: '#188038', slides: '#f9ab00', archive: '#80868b', other: '#80868b' };
const KindIcon = ({ kind, size: s = 16 }: { kind: FileKind; size?: number }) => <span className="dv-kind" style={{ color: KIND_COLOR[kind] }}><Icon name={KIND_ICON[kind]} size={s} /></span>;
type SortBy = 'modified' | 'name' | 'size';
const SORTS: [SortBy, string][] = [['modified', 'Mới sửa nhất'], ['name', 'Tên (A–Z)'], ['size', 'Lớn nhất']];
/** Folders first, like Drive; then the chosen order. */
const sorter = (by: SortBy) => (a: DriveFile, b: DriveFile) => (+(b.kind === 'folder') - +(a.kind === 'folder'))
  || (by === 'name' ? a.name.localeCompare(b.name, 'vi', { numeric: true }) : by === 'size' ? b.bytes - a.bytes : b.modifiedAt - a.modifiedAt);
/** Browsers show these images; others (HEIC, TIFF…) use Drive's thumbnail. */
const showable = (f: DriveFile) => /^image\/(jpeg|png|gif|webp|svg\+xml|avif|bmp)$/.test(f.mime);

export function WorkspacePage() {
  const me = useStore((s) => s.user)!;
  // Company admins and department admins manage customers, folders and files; a view-only role changes nothing here.
  const sysAdmin = me.role === 'admin', admin = sysAdmin || me.level === 'admin', viewOnly = !admin && me.level === 'observer';
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const [list, setList] = useState<Customer[]>([]);
  const [sel, setSel] = useState<string | null>(() => ls.get(LS_SEL));
  // Tổng quan: the customers with their tasks and videos (opened only from the header button) instead of one folder.
  const [dash, setDashState] = useState(() => ls.get('dms.dash') === '1');
  const setDash = (v: boolean) => { setDashState(v); ls.set('dms.dash', v ? '1' : '0'); };
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [syncing, setSyncing] = useState(false);
  // The folder this person is browsing (their own; null = the shared root). Kept per account in this browser.
  const LS_AT = `dms.at.${me.id}`;
  const [at, setAtState] = useState<Loc | null>(() => { try { return JSON.parse(ls.get(LS_AT) || 'null'); } catch { return null; } });
  const atRef = useRef(at);
  atRef.current = at;

  // Listing also picks up new customer folders made directly on Drive.
  const load = async (where: Loc | null, fresh = false) => {
    setSyncing(true);
    try {
      const [w, l] = await Promise.all([api.workspace(where), api.customers(fresh, where)]);
      setInfo(w); setList(l);
    } catch (e: any) {
      // A folder that is gone or out of reach: back to the root.
      if (where) { toast(e.message, true); return go(null); }
      toast(e.message, true);
    } finally { setSyncing(false); }
  };
  const loadList = (fresh = false) => load(atRef.current, fresh);
  const go = (loc: Loc | null) => {
    setAtState(loc); atRef.current = loc; ls.set(LS_AT, JSON.stringify(loc)); setSel(null); setQ('');
    return load(loc);
  };
  useEffect(() => {
    loadList();
    // Coming back to the tab picks up folders added on Drive meanwhile (at most every 30 s).
    let last = Date.now();
    const onFocus = () => { if (document.visibilityState === 'visible' && Date.now() - last > 30e3) { last = Date.now(); loadList(); } };
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (sel) ls.set(LS_SEL, sel); }, [sel]);
  useEffect(() => { if (list.length && (!sel || !list.some((c) => c.id === sel))) setSel(list[0].id); }, [list]); // eslint-disable-line react-hooks/exhaustive-deps

  const makeRoot = async () => {
    if (!info || !confirm(`Đặt “${info.crumbs.at(-1)?.name}” làm thư mục gốc cho mọi người?`)) return;
    try { await api.setWorkspace(info.view); toast('Đã đặt làm thư mục gốc'); await go(null); } catch (e: any) { toast(e.message, true); }
  };
  const create = async () => {
    const name = draft.trim(); if (!name) return;
    try { const c = await api.createCustomer({ name }, at); setDraft(''); setAdding(false); await loadList(); setSel(c.id); }
    catch (e: any) { toast(e.message, true); }
  };
  const needle = q.trim().toLowerCase();
  const shown = list.filter((c) => !needle || [c.name, ...c.links.flatMap((l) => [l.label, l.url])].some((x) => x?.toLowerCase().includes(needle)));

  return (
    <main className="ws">
      <aside className="ws-side">
        <header className="ws-side-h">
          <h1 className="side-title ws-side-title" title={info?.crumbs.map((c) => c.name).join(' › ')}>{info?.crumbs.at(-1)?.name || 'Khách hàng'}</h1>
          <Menu label="Tuỳ chọn" items={[
            { label: 'Tải lại từ Drive', icon: 'refresh', onClick: () => loadList(true) },
            { label: 'Về thư mục gốc', icon: 'folder', onClick: () => go(null), hidden: !info || info.viewIsRoot },
            { label: 'Đặt làm thư mục gốc', icon: 'check', onClick: makeRoot, hidden: !sysAdmin || !info || info.viewIsRoot },
          ]} />
          <IconButton icon="grid" label="Tổng quan khách hàng" active={dash} onClick={() => setDash(!dash)} />
          {admin && <IconButton icon="plus" label="Khách hàng mới" className={syncing ? 'busy' : ''} onClick={() => setAdding(true)} />}
        </header>
        {info && info.crumbs.length > 1 && (
          <nav className="ws-root" aria-label="Đường dẫn">
            {info.crumbs.slice(0, -1).map((cr, i) => (
              <span key={i}>
                {/* Every part of the path, "My Drive" included, opens that folder on Drive; the overview has its own button above. */}
                <button className="link" onClick={() => { setDash(false); go(cr.loc); }} title={`Xem các thư mục trong “${cr.name}”`}>{cr.name}</button>
                <i>›</i>
              </span>
            ))}
          </nav>
        )}
        {adding && (
          <form className="ws-add" onSubmit={(e) => { e.preventDefault(); create(); }}>
            <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Tên khách hàng, nhấn Enter" onKeyDown={(e) => e.key === 'Escape' && setAdding(false)} onBlur={() => !draft.trim() && setAdding(false)} />
          </form>
        )}
        {list.length > 5 && (
          <label className="tpl-field ws-search"><Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm trong thư mục này" /></label>
        )}
        <nav className="ws-list">
          {!list.length && !adding && !syncing && <p className="empty-note">Thư mục này chưa có thư mục con.{admin ? ' Bấm ＋ để tạo.' : ''}</p>}
          {shown.map((c) => (
            <div key={c.id} className={'ws-item' + (c.id === sel && !dash ? ' on' : '')}>
              <button className="ws-item-b" onClick={() => { setSel(c.id); setDash(false); }}>
                <span className="ws-fico"><Icon name="folder" size={18} /></span>
                <span className="ws-item-t"><b>{c.name}</b><span>{c.videoCount == null ? 'Không đọc được thư mục' : `${c.folderCount || 0} thư mục · ${c.fileCount ?? c.videoCount} file`}</span></span>
              </button>
              {!!c.folderCount && <IconButton icon="right" label={`Mở bên trong “${c.name}”`} size={14} className="ws-item-in" onClick={() => c.folderLoc && go(c.folderLoc)} />}
            </div>
          ))}
        </nav>
        {info && (
          <footer className="ws-foot ws-foot-min" title={info.label}>
            <span className={'ws-dot' + (info.storage !== 'local' ? ' ok' : '')} />
            {info.storage === 'google' ? 'Google Drive' : info.storage === 'desktop' ? 'Google Drive (app)' : 'Trên máy'}{info.account ? ` · ${info.account}` : ''}
          </footer>
        )}
      </aside>

      {dash
        ? <Dashboard customers={list} onOpenCustomer={(id) => { setSel(id); setDash(false); }} />
        : sel && list.some((c) => c.id === sel)
        ? <CustomerDetail key={sel} id={sel} admin={admin} viewOnly={viewOnly} onChanged={() => loadList()} onDeleted={() => { setSel(null); loadList(); }} />
        : <section className="ws-detail ws-empty"><Icon name="folder" size={36} /><p>Chọn một thư mục để xem video.</p></section>}
    </main>
  );
}

interface Upload { id: number; name: string; folder: string; where: string; progress: number; error?: string }
const LS_TAB = (id: string) => `dms.tab.${id}`;

/** Members browse, upload and edit links/notes; creating, renaming, linking and deleting stay with admins. */
export function CustomerDetail({ id, admin, canDelete = admin, viewOnly, onChanged, onDeleted }: { id: string; admin: boolean; canDelete?: boolean; viewOnly: boolean; onChanged: () => void; onDeleted: () => void }) {
  const [c, setC] = useState<Customer | null>(null);
  const [form, setForm] = useState({ name: '', notes: '' });
  const [uploads, setUploads] = useState<Upload[]>([]);
  /** File open in the viewer panel on the right; the panel shows links & notes when nothing is open. */
  const [viewing, setViewing] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [linking, setLinking] = useState(false);
  const [tab, setTab] = useState(() => ls.get(LS_TAB(id)) ?? '');
  /** Inline name field for a new folder or renaming the open one. */
  const [naming, setNaming] = useState<{ mode: 'new' | 'rename'; value: string } | null>(null);
  // Like Drive: grid or list, a type filter and an order; folders inside a tab open in place (deepest last).
  const [view, setViewState] = useState<'grid' | 'list'>(() => (ls.get(LS_VIEW) === 'list' ? 'list' : 'grid'));
  const setView = (v: 'grid' | 'list') => { setViewState(v); ls.set(LS_VIEW, v); };
  const [kind, setKind] = useState<FileKind | ''>('');
  const [sort, setSort] = useState<SortBy>('modified');
  const [trail, setTrail] = useState<{ key: string; name: string; driveUrl: string | null }[]>([]);
  const [inner, setInner] = useState<DriveFile[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const timer = useRef<any>(null);

  const load = async (fresh = false) => {
    clearTimeout(timer.current);
    try {
      const x = await api.customer(id, fresh);
      setC(x);
      if (x.error) toast(x.error, true);
      // Drive for desktop assigns the file ID once its sync finishes: keep checking while a recent file has none.
      const all = [...(x.files || []), ...(x.folders || []).flatMap((f) => f.files)];
      if (x.storage === 'desktop' && all.some((f) => !f.driveId && Date.now() - f.modifiedAt < 10 * 60e3)) timer.current = setTimeout(() => load(), 5000);
      return x;
    } catch (e: any) { toast(e.message, true); }
  };
  useEffect(() => {
    load().then((x) => x && setForm({ name: x.name, notes: x.notes }));
    return () => clearTimeout(timer.current);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (k: keyof typeof form) => {
    if (!c || form[k] === (c as any)[k]) return;
    if (k === 'name' && !form.name.trim()) { setForm({ ...form, name: c.name }); return; }
    try { setC(await api.updateCustomer(id, { [k]: form[k] })); if (k === 'name') onChanged(); }
    catch (e: any) { toast(e.message, true); }
  };
  // Folders opened inside the current tab: what is in the deepest one comes from the server each time it opens.
  const trailRef = useRef(trail);
  trailRef.current = trail;
  const openFolder = async (f: { key: string; name: string; driveUrl: string | null }, keep: number) => {
    const before = trailRef.current, was = inner, next = [...before.slice(0, keep), f];
    setTrail(next); setInner(null); setViewing(null);
    try { const r = await api.browseCustomer(id, f.key); if (trailRef.current.at(-1)?.key === f.key) setInner(r.files); }
    catch (e: any) { toast(e.message, true); setTrail(before); setInner(was); }
  };
  /** Back to the tab itself (`keep` 0) or to one of the folders opened in it. */
  const closeTo = (keep: number) => { if (keep) openFolder(trailRef.current[keep - 1], keep - 1); else { setTrail([]); setInner(null); setViewing(null); } };
  /** After a change: the customer again, and the open folder inside the tab if there is one. */
  const refresh = async () => {
    await load(true);
    const at = trailRef.current.at(-1);
    if (at) { const r = await api.browseCustomer(id, at.key).catch(() => null); if (r && trailRef.current.at(-1)?.key === at.key) setInner(r.files); }
  };
  const upload = async (picked: FileList | File[] | null) => {
    // Every kind of file, like Drive (a dropped folder arrives as an empty entry with no type and is skipped).
    const list = [...(picked || [])].filter((f) => f.size > 0 || f.type);
    if (!list.length) return toast('Hãy chọn file để tải lên (chưa tải được cả thư mục).', true);
    const here = trailRef.current.at(-1), folder = here?.key ?? cur?.key ?? '', where = here?.name ?? cur?.name ?? 'Chung';
    const items = list.map((f) => ({ f, u: { id: Math.random(), name: f.name, folder, where, progress: 0 } as Upload }));
    setUploads((x) => [...x, ...items.map((i) => i.u)]);
    const direct = c?.storage === 'google';
    // Up to 3 files at once: one connection rarely fills the uplink, and the grid refreshes as each one lands.
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const { f, u } = items[next++];
        try {
          await api.uploadCustomerFile(id, f, u.folder, direct, (k) => setUploads((x) => x.map((y) => (y.id === u.id ? { ...y, progress: k } : y))));
          setUploads((x) => x.filter((y) => y.id !== u.id));
          await refresh(); onChanged();
        } catch (e: any) {
          setUploads((x) => x.map((y) => (y.id === u.id ? { ...y, error: e.message } : y)));
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  };
  const remove = async (v: DriveFile) => {
    if (!confirm(`Xoá “${v.name}”?${c?.storage !== 'local' ? ' File sẽ vào Thùng rác của Google Drive (khôi phục được trong 30 ngày).' : ''}`)) return;
    const k = files.findIndex((x) => x.key === v.key);
    try {
      await api.deleteCustomerFile(id, v.key);
      if (viewing === v.key) setViewing((files[k + 1] || files[k - 1])?.key || null);
      await refresh(); onChanged();
    } catch (e: any) { toast(e.message, true); }
  };
  const copyLink = async (v: DriveFile) => {
    if (!v.driveUrl) return;
    try { await navigator.clipboard.writeText(v.driveUrl); toast(v.shared || c?.storage !== 'google' ? 'Đã sao chép link Google Drive' : 'Đã sao chép link (chỉ người có quyền mới xem được — bấm "Chia sẻ" để ai có link cũng xem được)'); }
    catch { toast('Trình duyệt chặn clipboard', true); }
  };
  const share = async (v: DriveFile) => {
    try { const r = await api.shareCustomerFile(id, v.key); await navigator.clipboard.writeText(r.url).catch(() => {}); toast('Ai có link đều xem được. Đã sao chép link.'); await refresh(); }
    catch (e: any) { toast(e.message, true); }
  };
  const download = (v: DriveFile) => { if (!v.url) return; const a = document.createElement('a'); a.href = v.url; a.download = v.name; a.click(); };
  const del = async () => {
    if (!c || !confirm(`Ẩn “${c.name}” khỏi danh sách?\nThư mục và video trên Drive vẫn giữ nguyên. Muốn hiện lại: “Đổi thư mục” của một khách bất kỳ và chọn lại thư mục này.`)) return;
    try { await api.deleteCustomer(id); onDeleted(); } catch (e: any) { toast(e.message, true); }
  };

  const saveLinks = async (links: CustomerLink[]) => {
    try { setC(await api.updateCustomer(id, { links })); onChanged(); } catch (e: any) { toast(e.message, true); }
  };

  // Tabs: one per folder, plus "Chung" for files lying directly in the customer folder (or when there are no folders yet).
  const tabs: DriveFolder[] = c ? [
    ...(c.files?.length || !c.folders?.length ? [{ key: '', name: 'Chung', driveUrl: c.driveFolderUrl || null, files: c.files || [] }] : []),
    ...(c.folders || []),
  ] : [];
  const cur = tabs.find((t) => t.key === tab) || tabs.find((t) => t.key) || tabs[0];
  useEffect(() => { if (cur && cur.key !== tab) setTab(cur.key); }, [cur?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { ls.set(LS_TAB(id), tab); }, [id, tab]);
  // Another tab: folders opened in the previous one close.
  useEffect(() => { setTrail([]); setInner(null); }, [cur?.key]);

  // What is shown: the open folder (or the tab), of the chosen type, in the chosen order.
  const here = trail.at(-1);
  const items = here ? inner || [] : cur?.files || [];
  const present = FILE_KINDS.filter((k) => items.some((f) => f.kind === k));
  const shownItems = items.filter((f) => !kind || f.kind === kind).sort(sorter(sort));
  const folderItems = shownItems.filter((f) => f.kind === 'folder'), files = shownItems.filter((f) => f.kind !== 'folder');
  const openItem = (f: DriveFile) => {
    if (f.kind !== 'folder') return setViewing(f.key);
    // A shortcut points outside the customer folder: it opens on Drive.
    if (f.shortcut) { if (f.driveUrl) window.open(f.driveUrl, '_blank', 'noopener'); return; }
    openFolder({ key: f.key, name: f.name, driveUrl: f.driveUrl }, trail.length);
  };
  const itemMenu = (f: DriveFile) => [
    { label: 'Mở trên Google Drive', icon: 'share', href: f.driveUrl || undefined, hidden: !f.driveUrl },
    { label: 'Tải về', icon: 'download', onClick: () => download(f), hidden: !f.url },
    { label: 'Sao chép link', icon: 'copy', onClick: () => copyLink(f), hidden: !f.driveUrl },
    { label: 'Xoá', icon: 'trash', onClick: () => remove(f), danger: true, hidden: !admin || f.kind === 'folder' },
  ];

  const submitName = async () => {
    if (!naming || !naming.value.trim()) return;
    try {
      if (naming.mode === 'new') {
        const f = await api.createVideoFolder(id, naming.value.trim());
        toast(`Đã tạo thư mục “${f.name}”${c?.storage === 'local' ? '' : ' trên Drive'}`);
        setTab(f.key);
      } else {
        const f = await api.renameVideoFolder(id, cur!.key, naming.value.trim());
        setTab(f.key);
      }
      setNaming(null); await load(); onChanged();
    } catch (e: any) { toast(e.message, true); }
  };
  const removeFolder = async () => {
    if (!cur?.key || !confirm(`Xoá thư mục “${cur.name}”?`)) return;
    try { await api.deleteVideoFolder(id, cur.key); setTab(''); await load(); onChanged(); } catch (e: any) { toast(e.message, true); }
  };

  // Folder tabs stay on one line and scroll sideways; the open tab is kept in view and the fade hides once the end is reached.
  const tabsRef = useRef<HTMLDivElement>(null);
  const fadeTabs = () => { const el = tabsRef.current; if (el) el.classList.toggle('at-end', el.scrollLeft + el.clientWidth >= el.scrollWidth - 4); };
  useEffect(() => {
    tabsRef.current?.querySelector('.ws-tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    fadeTabs();
  }, [cur?.key, tabs.length, !!viewing]); // eslint-disable-line react-hooks/exhaustive-deps

  // The viewer follows what is listed: another folder or type closes it, deleting the file moves to a neighbour.
  const shown = files.find((v) => v.key === viewing) || null;

  if (!c) return <section className="ws-detail" />;
  if (!c.folderLoc) return <section className="crm-campaigns"><h2>{c.name}</h2><p className="note">Khách hàng trong database. Chưa liên kết thư mục Drive.</p><label className="tm-field">Tên khách hàng<input className="bk-in" readOnly={!admin} value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})} onBlur={()=>save('name')} /></label><label className="tm-field">Ghi chú<textarea className="bk-in" readOnly={viewOnly} value={form.notes} onChange={(e)=>setForm({...form,notes:e.target.value})} onBlur={()=>save('notes')} />{form.notes&&<Rich text={form.notes}/>}</label>{admin && <><button className="btn btn-primary" onClick={()=>setLinking(true)}>Liên kết thư mục Drive</button>{canDelete&&<button className="btn btn-gray" onClick={del}>Xoá khách hàng</button>}<FolderPicker open={linking} title={`Thư mục của ${c.name}`} confirmLabel="Xác nhận liên kết thư mục" onClose={()=>setLinking(false)} onPick={async(loc)=>{setC(await api.linkCustomerFolder(id,loc));setLinking(false);onChanged();}} /></>}</section>;


  return (
    <section className={'ws-detail' + (drag ? ' drag' : '')}
      onDragOver={(e) => { if (!viewOnly && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}>
      <header className="ws-head">
        <div className="ws-head-t">
          <p className="ws-crumb" title={c.folderPath || c.folderLabel}>
            {c.folderLabel.split(' › ').slice(0, -1).join(' › ')}{c.account ? ` · ${c.account}` : ''}
          </p>
          <input className="ws-name" readOnly={!admin} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} onBlur={() => save('name')}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label="Tên khách hàng" />
        </div>
        <Menu label="Tuỳ chọn khách hàng" items={[
          { label: 'Mở trên Google Drive', icon: 'share', href: c.driveFolderUrl || undefined, hidden: !c.driveFolderUrl },
          { label: 'Mở trong Finder', icon: 'folder', onClick: () => api.revealCustomer(id).catch((e) => toast(e.message, true)), hidden: c.storage === 'google' },
          { label: 'Liên kết thư mục khác…', icon: 'layers', onClick: () => setLinking(true), hidden: !admin },
          { label: 'Ẩn khỏi danh sách', icon: 'trash', onClick: del, danger: true, hidden: !canDelete },
        ]} />
      </header>
      <FolderPicker open={linking} title={`Thư mục của ${c.name}`} start={c.folderLoc} confirmLabel="Liên kết thư mục này" onClose={() => setLinking(false)}
        onPick={async (loc) => { setC(await api.linkCustomerFolder(id, loc)); onChanged(); toast('Đã liên kết thư mục'); }} />

      <div className="ws-body">
      <div className="ws-main">
      <div className="ws-tabrow">
        <div className="ws-tabs" role="tablist" aria-label="Thư mục" ref={tabsRef} onScroll={fadeTabs}
          onWheel={(e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY; }}>
          {tabs.map((t) => (
            <button key={t.key || '_'} role="tab" aria-selected={t.key === cur?.key} className={'ws-tab' + (t.key === cur?.key ? ' on' : '')}
              onClick={() => { setTab(t.key); setNaming(null); if (t.key === cur?.key) closeTo(0); }}
              onDoubleClick={() => admin && t.key && setNaming({ mode: 'rename', value: t.name })}>
              <Icon name={t.key ? 'folder' : 'file'} size={14} />{t.name}<em>{t.files.length}</em>
            </button>
          ))}
          {admin && naming?.mode !== 'new' && <button className="ws-tab ws-tab-add" onClick={() => setNaming({ mode: 'new', value: '' })} title="Thư mục mới" aria-label="Thư mục mới"><Icon name="plus" size={14} /></button>}
        </div>
        {cur && <Menu label="Tuỳ chọn thư mục" items={[
          { label: 'Mở trên Google Drive', icon: 'share', href: (here ? here.driveUrl : cur.driveUrl) || undefined, hidden: !(here ? here.driveUrl : cur.driveUrl) },
          { label: 'Đổi tên', icon: 'text', onClick: () => setNaming({ mode: 'rename', value: cur.name }), hidden: !admin || !cur.key || !!here },
          { label: 'Xoá thư mục', icon: 'trash', onClick: removeFolder, danger: true, hidden: !admin || !cur.key || !!here || !!cur.files.length },
        ]} />}
        {!viewOnly && <button className="btn btn-primary btn-sm" onClick={() => fileRef.current?.click()}><Icon name="plus" size={14} />Tải lên</button>}
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
      </div>
      {naming && (
        <form className="ws-add ws-name-f" onSubmit={(e) => { e.preventDefault(); submitName(); }}>
          <Icon name="folder" size={16} />
          <input autoFocus value={naming.value} onChange={(e) => setNaming({ ...naming, value: e.target.value })} onKeyDown={(e) => e.key === 'Escape' && setNaming(null)}
            placeholder={naming.mode === 'new' ? 'Tên thư mục mới' : 'Tên mới'} />
          <button className="btn btn-primary btn-sm" disabled={!naming.value.trim()}>{naming.mode === 'new' ? 'Tạo' : 'Lưu'}</button>
          <IconButton icon="x" label="Huỷ" size={15} onClick={() => setNaming(null)} />
        </form>
      )}
      {uploads.map((u) => (
        <div key={u.id} className={'ws-up' + (u.error ? ' err' : '')}>
          <span className="ws-up-bar" style={{ width: `${Math.round(u.progress * 100)}%` }} />
          <span className="ws-up-t">{u.name} → {u.where} · {u.error || `${Math.round(u.progress * 100)}%`}</span>
          {u.error && <IconButton icon="x" label="Ẩn" size={13} onClick={() => setUploads((x) => x.filter((y) => y.id !== u.id))} />}
        </div>
      ))}
      {trail.length > 0 && (
        <nav className="dv-trail" aria-label="Thư mục đang mở">
          <button className="link" onClick={() => closeTo(0)}>{cur?.name}</button>
          {trail.map((t, i) => <span key={t.key}><i>›</i>{i === trail.length - 1 ? <b>{t.name}</b> : <button className="link" onClick={() => closeTo(i + 1)}>{t.name}</button>}</span>)}
        </nav>
      )}
      {/* Drive's "Type" filter and order, and its grid / list switch. */}
      {items.length > 0 && (
        <div className="dv-bar">
          <label className={'dv-chip' + (kind ? ' on' : '')}>
            <Icon name={kind ? KIND_ICON[kind] : 'filter'} size={14} /><span>{kind ? KIND_NAME[kind] : 'Loại'}</span>
            {kind ? <button className="dv-x" onClick={(e) => { e.preventDefault(); setKind(''); }} aria-label="Bỏ lọc loại"><Icon name="x" size={12} /></button> : <Icon name="chevron" size={12} />}
            <select value={kind} onChange={(e) => setKind(e.target.value as FileKind | '')} aria-label="Lọc theo loại">
              <option value="">Tất cả ({items.length})</option>
              {FILE_KINDS.filter((k) => present.includes(k) || k === kind).map((k) => <option key={k} value={k}>{KIND_NAME[k]} ({items.filter((f) => f.kind === k).length})</option>)}
            </select>
          </label>
          <label className="dv-chip">
            <Icon name={sort === 'name' ? 'up' : 'down'} size={14} /><span>{SORTS.find(([k]) => k === sort)![1]}</span><Icon name="chevron" size={12} />
            <select value={sort} onChange={(e) => setSort(e.target.value as SortBy)} aria-label="Sắp xếp">{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          <span className="dv-gap" />
          <Segmented small value={view} onChange={setView} ariaLabel="Kiểu xem"
            options={[['grid', <span key="g" className="dv-seg" title="Dạng lưới"><Icon name="grid" size={15} />Lưới</span>], ['list', <span key="l" className="dv-seg" title="Dạng danh sách"><Icon name="list" size={15} />Danh sách</span>]]} />
        </div>
      )}
      {here && inner === null ? <p className="dv-none">Đang mở thư mục…</p>
        : !items.length ? (viewOnly ? <p className="dv-none">Thư mục trống.</p> : !uploads.some((u) => u.folder === (here?.key ?? cur?.key)) && (
          <button className="an-drop ws-drop" onClick={() => fileRef.current?.click()}>
            <Icon name="folder" size={28} /><b>Thư mục trống</b>
            <span>Kéo thả file vào đây hoặc bấm để chọn file.</span>
          </button>
        ))
        : !shownItems.length ? <p className="dv-none">Không có {kind ? KIND_NAME[kind].toLowerCase() : 'file'} nào ở đây. <button className="link" onClick={() => setKind('')}>Xem tất cả</button></p>
        : view === 'grid' ? <>
          {folderItems.length > 0 && (
            <div className="dv-sec">
              <h4>Thư mục</h4>
              <div className="dv-folders">
                {folderItems.map((f) => (
                  <button key={f.key} className="dv-folder" onClick={() => openItem(f)} title={f.shortcut ? `${f.name} (lối tắt, mở trên Drive)` : f.name}>
                    <Icon name="folder" size={18} /><span>{f.name}</span>{f.shortcut && <Icon name="share" size={12} />}
                  </button>
                ))}
              </div>
            </div>
          )}
          {files.length > 0 && (
            <div className="dv-sec">
              {folderItems.length > 0 && <h4>File</h4>}
              <div className="dv-files">
                {files.map((f) => (
                  <button key={f.key} className={'dv-card' + (f.key === viewing ? ' on' : '')} onClick={() => openItem(f)} title={f.name} aria-pressed={f.key === viewing}>
                    <span className="dv-card-h"><KindIcon kind={f.kind} /><b>{f.name}</b></span>
                    <span className="dv-prev" style={f.thumb ? { backgroundImage: `url("${f.thumb}")` } : undefined}>
                      {!f.thumb && <span style={{ color: KIND_COLOR[f.kind] }}><Icon name={KIND_ICON[f.kind]} size={44} /></span>}
                      {f.kind === 'video' && <i className="dv-play"><Icon name="play" size={13} /></i>}
                      {c.storage === 'desktop' && !f.driveId && <span className="tpl-badge ws-sync">Đang đồng bộ…</span>}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </> : (
          <div className="dv-list" role="table" aria-label="File">
            <div className="dv-row dv-head" role="row">
              {([['name', 'Tên'], ['modified', 'Ngày sửa đổi'], ['size', 'Kích thước']] as [SortBy, string][]).map(([k, l]) => (
                <button key={k} role="columnheader" className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{l}{sort === k && <Icon name={k === 'name' ? 'up' : 'down'} size={12} />}</button>
              ))}
              <span />
            </div>
            {shownItems.map((f) => (
              <div key={f.key} role="row" tabIndex={0} className={'dv-row' + (f.key === viewing ? ' on' : '')} onClick={() => openItem(f)} onKeyDown={(e) => { if (e.key === 'Enter') openItem(f); }}>
                <span className="dv-name">
                  <KindIcon kind={f.kind} /><b title={f.name}>{f.name}</b>
                  {f.shortcut && <em className="dv-tag">Lối tắt</em>}
                  {c.storage === 'desktop' && !f.driveId && f.kind !== 'folder' && <em className="dv-tag">Đang đồng bộ…</em>}
                </span>
                <span>{date(f.modifiedAt)}</span>
                <span>{f.kind === 'folder' || !f.bytes ? '—' : size(f.bytes)}</span>
                <span className="dv-act" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}><Menu label={`Tuỳ chọn “${f.name}”`} size={15} items={itemMenu(f)} /></span>
              </div>
            ))}
          </div>
        )}
      </div>

      <aside className={'ws-aside' + (shown ? ' viewing' : '')}>
        {shown && cur ? (
          <Viewer key={shown.key} v={shown} list={files} storage={c.storage} folder={here?.name ?? (cur.key ? cur.name : c.name)}
            onPick={setViewing} onClose={() => setViewing(null)} onCopy={copyLink} onShare={viewOnly ? undefined : share} onDownload={download} onDelete={admin ? remove : undefined} />
        ) : <>
        <Links links={c.links} onSave={saveLinks} readOnly={viewOnly} />
        <label className="ws-field ws-notes"><span>Ghi chú</span>
          <textarea rows={4} value={form.notes} readOnly={viewOnly} placeholder={viewOnly ? 'Chưa có ghi chú' : 'Brief, yêu cầu, deadline…'} onChange={(e) => setForm({ ...form, notes: e.target.value })} onBlur={() => !viewOnly && save('notes')} />
          {form.notes&&<Rich text={form.notes}/>} 
        </label>
        </>}
      </aside>
      </div>

      {drag && <div className="ws-dropover"><Icon name="download" size={32} />Thả để tải file vào “{here?.name || cur?.name || 'Chung'}”</div>}
    </section>
  );
}

// ---------------------------------------------------------------- links (Google Sheet, Docs, Facebook…)
const KINDS: { test: RegExp; label: string; icon: string; color: string }[] = [
  { test: /docs\.google\.com\/spreadsheets/, label: 'Google Sheet', icon: 'grid', color: '#188038' },
  { test: /docs\.google\.com\/document/, label: 'Google Docs', icon: 'text', color: '#1a73e8' },
  { test: /docs\.google\.com\/presentation/, label: 'Google Slides', icon: 'photo', color: '#e8a400' },
  { test: /docs\.google\.com\/forms|forms\.gle/, label: 'Google Form', icon: 'check', color: '#7248b9' },
  { test: /drive\.google\.com/, label: 'Google Drive', icon: 'folder', color: '#1a73e8' },
  { test: /facebook\.com|fb\.com|m\.me\//, label: 'Facebook', icon: 'share', color: '#1877f2' },
  { test: /zalo\.me/, label: 'Zalo', icon: 'share', color: '#0068ff' },
  { test: /tiktok\.com/, label: 'TikTok', icon: 'film', color: '#1d1d1f' },
  { test: /instagram\.com/, label: 'Instagram', icon: 'photo', color: '#d62976' },
  { test: /youtube\.com|youtu\.be/, label: 'YouTube', icon: 'play', color: '#ff0000' },
];
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const kindOf = (u: string) => KINDS.find((k) => k.test.test(u)) || { label: host(u), icon: 'share', color: '#8e8e93' };

function Links({ links, onSave, readOnly }: { links: CustomerLink[]; onSave: (l: CustomerLink[]) => Promise<void>; readOnly?: boolean }) {
  const [draft, setDraft] = useState('');

  const add = async () => {
    let url = draft.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    try { new URL(url); } catch { return toast('Link không hợp lệ', true); }
    await onSave([...links, { label: '', url }]);
    setDraft('');
  };
  const copy = (u: string) => navigator.clipboard.writeText(u).then(() => toast('Đã sao chép link'), () => toast('Trình duyệt chặn clipboard', true));

  return (
    <div className="ws-field ws-links">
      <span>Liên kết</span>
      {links.map((l, i) => {
        const k = kindOf(l.url);
        return (
          <div key={i + l.url} className="ws-link">
            <a className="ws-link-main" href={l.url} target="_blank" rel="noreferrer" title={l.url}>
              <span className="ws-link-ico" style={{ background: k.color }}><Icon name={k.icon} size={14} /></span>
              <span className="ws-link-t"><b>{l.label || k.label}</b><em>{host(l.url)}</em></span>
            </a>
            {!readOnly && <Menu label="Tuỳ chọn link" size={15} items={[
              { label: 'Đổi tên…', icon: 'text', onClick: () => { const n = prompt('Tên link', l.label || k.label); if (n !== null) onSave(links.map((x, j) => (j === i ? { ...x, label: n.trim() } : x))); } },
              { label: 'Sao chép link', icon: 'copy', onClick: () => copy(l.url) },
              { label: 'Xoá', icon: 'trash', danger: true, onClick: () => onSave(links.filter((_, j) => j !== i)) },
            ]} />}
          </div>
        );
      })}
      {readOnly ? !links.length && <p className="note">Chưa có link nào.</p> : <form className="ws-link-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <Icon name="plus" size={14} />
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Dán link Sheet, Docs… rồi nhấn Enter" inputMode="url" aria-label="Thêm link" />
      </form>}
    </div>
  );
}

// ---------------------------------------------------------------- viewer panel
// Videos play, images and PDFs show, audio plays; Google Docs/Sheets/Slides and other files show their thumbnail
// (or icon) with a way to open them on Drive or download them.
function Viewer({ v, list, storage, folder, onPick, onClose, onCopy, onShare, onDownload, onDelete }: {
  v: DriveFile; list: DriveFile[]; storage: Customer['storage']; folder: string;
  onPick: (key: string) => void; onClose: () => void; onCopy: (v: DriveFile) => void; onShare?: (v: DriveFile) => void; onDownload: (v: DriveFile) => void; onDelete?: (v: DriveFile) => void;
}) {
  const k = list.findIndex((x) => x.key === v.key);
  const prev = list[k - 1], next = list[k + 1];
  const [dims, setDims] = useState<{ w: number; h: number; d: number } | null>(null);
  // ← / → step through the folder, Esc closes (not while typing in a field).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (/INPUT|TEXTAREA|SELECT/.test((document.activeElement as HTMLElement)?.tagName || '') || document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && prev) onPick(prev.key);
      if (e.key === 'ArrowRight' && next) onPick(next.key);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [prev, next]); // eslint-disable-line react-hooks/exhaustive-deps
  const dur = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  const video = v.kind === 'video' && v.url;
  const picture = v.kind === 'image' ? (showable(v) && v.url) || v.thumb : !video && v.kind !== 'pdf' && v.kind !== 'audio' ? v.thumb : null;

  return (
    <div className={'ws-viewer' + (!video || (dims && dims.w > dims.h) ? ' wide' : '')}>
      <header className="ws-viewer-h">
        <span>{folder}</span>
        {list.length > 1 && <>
          <IconButton icon="left" label="File trước (←)" size={15} disabled={!prev} onClick={() => prev && onPick(prev.key)} />
          <em className="ws-viewer-n">{k + 1}/{list.length}</em>
          <IconButton icon="right" label="File sau (→)" size={15} disabled={!next} onClick={() => next && onPick(next.key)} />
        </>}
        <IconButton icon="x" label="Đóng (Esc)" size={15} onClick={onClose} />
      </header>
      {/* A video is sized to the clip's own shape (mostly 9:16 phone videos) so it fills the panel without black bars. */}
      <div className={'ws-viewer-stage' + (video ? '' : ' light')}>
        {video ? (
          <video className="ws-viewer-v" src={v.url!} poster={v.thumb || undefined} controls autoPlay playsInline
            style={{ aspectRatio: dims?.w ? `${dims.w} / ${dims.h}` : '9 / 16' }}
            onLoadedMetadata={(e) => setDims({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight, d: e.currentTarget.duration })} />
        ) : v.kind === 'pdf' && v.url ? <iframe className="ws-viewer-pdf" src={v.url} title={v.name} />
          : picture ? <img className="ws-viewer-img" src={picture} alt={v.name} />
          : (
            <div className="ws-viewer-file">
              <KindIcon kind={v.kind} size={56} />
              {v.kind === 'audio' && v.url ? <audio src={v.url} controls autoPlay /> : <span>{v.url ? 'Chưa xem trước được loại file này' : 'Mở trên Google Drive để xem'}</span>}
            </div>
          )}
      </div>
      <div className="ws-viewer-m">
        <b title={v.name}>{v.name}</b>
        <span>{[KIND_NAME[v.kind], dims && dims.w ? `${dims.w}×${dims.h}` : '', dims && isFinite(dims.d) ? dur(dims.d) : '', v.bytes ? size(v.bytes) : '', date(v.modifiedAt)].filter(Boolean).join(' · ')}</span>
        {storage === 'desktop' && !v.driveId && <span>Đang đồng bộ lên Drive…</span>}
        {storage === 'google' && v.shared && <span>Ai có link đều xem được</span>}
      </div>
      <div className="ws-viewer-a">
        {!v.url && v.driveUrl && <a className="btn btn-primary btn-sm" href={v.driveUrl} target="_blank" rel="noreferrer"><Icon name="share" size={14} />Mở trên Google Drive</a>}
        {v.driveUrl && (onShare && storage === 'google' && !v.shared && !v.shortcut
          ? <button className="btn btn-tinted btn-sm" onClick={() => onShare(v)} title="Ai có link đều xem được"><Icon name="share" size={14} />Chia sẻ link</button>
          : <button className="btn btn-tinted btn-sm" onClick={() => onCopy(v)}><Icon name="copy" size={14} />Sao chép link</button>)}
        <Menu label="Tuỳ chọn file" className="up" items={[
          { label: 'Mở trên Google Drive', icon: 'share', href: v.driveUrl || undefined, hidden: !v.driveUrl },
          { label: 'Tải về', icon: 'download', onClick: () => onDownload(v), hidden: !v.url },
          { label: 'Xoá file', icon: 'trash', onClick: () => onDelete?.(v), danger: true, hidden: !onDelete },
        ]} />
      </div>
    </div>
  );
}
