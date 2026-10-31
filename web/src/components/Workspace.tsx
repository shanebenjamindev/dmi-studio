// Workspace: customers, their info, their videos (on Google Drive via Google sign-in, or a folder on this Mac) and their projects.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStore, toast } from '../store';
import { Icon, IconButton, Menu } from './ui';
import { FolderPicker } from './FolderPicker';
import { GoogleConnect, googleLogin } from './GoogleConnect';
import type { Loc, Customer, CustomerLink, CustomerVideo, VideoFolder, WorkspaceInfo, GoogleStatus } from '../types';

const LS_SEL = 'dms.customer';
const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const mb = (b: number) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : Math.max(0.1, b / 1e6).toFixed(1) + ' MB');
const date = (t: number) => new Date(t).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

export function WorkspacePage() {
  const admin = useStore((s) => s.user?.role === 'admin');
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const [list, setList] = useState<Customer[]>([]);
  const [sel, setSel] = useState<string | null>(() => ls.get(LS_SEL));
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [picking, setPicking] = useState(false);
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [connecting, setConnecting] = useState(false);

  const [syncing, setSyncing] = useState(false);
  // Listing also picks up new customer folders made directly on Drive.
  const loadList = (fresh = false) => { setSyncing(true); return api.customers(fresh).then(setList).catch((e) => toast(e.message, true)).finally(() => setSyncing(false)); };
  const loadGoogle = () => api.googleStatus().then(setGoogle).catch(() => {});
  useEffect(() => {
    api.workspace().then(setInfo).catch(() => {}); loadList(); loadGoogle();
    // Back from Google's sign-in page: /#workspace?google=<email> or ?google_error=<message>
    const qs = new URLSearchParams(location.hash.split('?')[1] || '');
    if (qs.get('google')) toast(`Đã kết nối ${qs.get('google')}. Chọn ⋯ › Chọn thư mục gốc để dùng Drive này.`);
    if (qs.get('google_error')) toast(qs.get('google_error')!, true);
    if (qs.size) history.replaceState(null, '', location.pathname);
    // Coming back to the tab picks up folders added on Drive meanwhile (at most every 30 s).
    let last = Date.now();
    const onFocus = () => { if (document.visibilityState === 'visible' && Date.now() - last > 30e3) { last = Date.now(); loadList(); } };
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, []);
  // Add a Google account (admins only): sign in directly once OAuth is set up, otherwise show the one-time setup.
  const addAccount = admin ? () => (google?.configured ? googleLogin() : setConnecting(true)) : undefined;
  useEffect(() => { if (sel) ls.set(LS_SEL, sel); }, [sel]);
  useEffect(() => { if (list.length && (!sel || !list.some((c) => c.id === sel))) setSel(list[0].id); }, [list]); // eslint-disable-line react-hooks/exhaustive-deps

  // Breadcrumb / "open inside": the chosen folder becomes the workspace root and its sub-folders become the list.
  const goRoot = async (loc: Loc) => {
    try { setInfo(await api.setWorkspace(loc)); setSel(null); setQ(''); await loadList(); }
    catch (e: any) { toast(e.message, true); }
  };
  const create = async () => {
    const name = draft.trim(); if (!name) return;
    try { const c = await api.createCustomer({ name }); setDraft(''); setAdding(false); await loadList(); setSel(c.id); }
    catch (e: any) { toast(e.message, true); }
  };
  const needle = q.trim().toLowerCase();
  const shown = list.filter((c) => !needle || [c.name, ...c.links.flatMap((l) => [l.label, l.url])].some((x) => x?.toLowerCase().includes(needle)));

  return (
    <main className="ws">
      <aside className="ws-side">
        <header className="ws-side-h">
          <h1 className="side-title ws-side-title" title={info?.label}>{info?.crumbs.at(-1)?.name || 'Khách hàng'}</h1>
          <Menu label="Tuỳ chọn" items={[
            { label: 'Tải lại từ Drive', icon: 'refresh', onClick: () => loadList(true) },
            { label: 'Chọn thư mục gốc…', icon: 'folder', onClick: () => setPicking(true), hidden: !admin },
            { label: 'Tài khoản Google Drive…', icon: 'key', onClick: () => setConnecting(true), hidden: !admin },
          ]} />
          <IconButton icon="plus" label="Khách hàng mới" className={syncing ? 'busy' : ''} onClick={() => setAdding(true)} />
        </header>
        {info && info.crumbs.length > 1 && (
          <nav className="ws-root" aria-label="Đường dẫn thư mục gốc">
            {info.crumbs.slice(0, -1).map((cr, i) => (
              <span key={i}>
                {admin ? <button className="link" onClick={() => goRoot(cr.loc)} title={`Xem các thư mục trong “${cr.name}”`}>{cr.name}</button> : <em>{cr.name}</em>}
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
          <label className="tpl-field ws-search"><Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm khách hàng" /></label>
        )}
        <nav className="ws-list">
          {!list.length && !adding && !syncing && <p className="empty-note">Thư mục gốc chưa có thư mục khách hàng nào. Bấm ＋ để tạo.</p>}
          {shown.map((c) => (
            <div key={c.id} className={'ws-item' + (c.id === sel ? ' on' : '')}>
              <button className="ws-item-b" onClick={() => setSel(c.id)}>
                <span className="ws-fico"><Icon name="folder" size={18} /></span>
                <span className="ws-item-t"><b>{c.name}</b><span>{c.videoCount == null ? 'Không đọc được thư mục' : `${c.folderCount || 0} thư mục · ${c.videoCount} video`}</span></span>
              </button>
              {admin && <IconButton icon="right" label={`Mở bên trong “${c.name}”`} size={14} className="ws-item-in" onClick={() => goRoot(c.folderLoc)} />}
            </div>
          ))}
        </nav>
        {info && (
          <footer className="ws-foot ws-foot-min" title={info.label}>
            <span className={'ws-dot' + (info.storage !== 'local' ? ' ok' : '')} />
            {info.storage === 'google' ? 'Google Drive' : info.storage === 'desktop' ? 'Google Drive (app)' : 'Trên máy'}{info.account ? ` · ${info.account}` : ''}
          </footer>
        )}
        <FolderPicker open={picking} title="Thư mục gốc của Workspace" start={info?.loc} confirmLabel="Dùng thư mục này" onClose={() => setPicking(false)} onAddAccount={addAccount}
          onPick={async (loc) => { setInfo(await api.setWorkspace(loc)); toast('Đã đổi thư mục gốc. Các thư mục bên trong hiện thành khách hàng.'); loadList(); }} />
        <GoogleConnect open={connecting} onClose={() => { setConnecting(false); loadGoogle(); }} onChanged={() => { loadGoogle(); loadList(); api.workspace().then(setInfo).catch(() => {}); }} />
      </aside>

      {sel && list.some((c) => c.id === sel)
        ? <CustomerDetail key={sel} id={sel} onAddAccount={addAccount} onChanged={loadList} onDeleted={() => { setSel(null); loadList(); }} />
        : <section className="ws-detail ws-empty"><Icon name="folder" size={36} /><p>Chọn một thư mục khách hàng để xem video.</p></section>}
    </main>
  );
}

interface Upload { id: number; name: string; folder: string; progress: number; error?: string }
const LS_TAB = (id: string) => `dms.tab.${id}`;

function CustomerDetail({ id, onAddAccount, onChanged, onDeleted }: { id: string; onAddAccount?: () => void; onChanged: () => void; onDeleted: () => void }) {
  const [c, setC] = useState<Customer | null>(null);
  const [form, setForm] = useState({ name: '', notes: '' });
  const [uploads, setUploads] = useState<Upload[]>([]);
  /** Video open in the viewer panel on the right; the panel shows links & notes when nothing is open. */
  const [viewing, setViewing] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [linking, setLinking] = useState(false);
  const [tab, setTab] = useState(() => ls.get(LS_TAB(id)) ?? '');
  /** Inline name field for a new video folder or renaming the open one. */
  const [naming, setNaming] = useState<{ mode: 'new' | 'rename'; value: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const timer = useRef<any>(null);

  const load = async (fresh = false) => {
    clearTimeout(timer.current);
    try {
      const x = await api.customer(id, fresh);
      setC(x);
      if (x.error) toast(x.error, true);
      // Drive for desktop assigns the file ID once its sync finishes: keep checking until every video has one.
      if (x.storage === 'desktop' && [...(x.videos || []), ...(x.folders || []).flatMap((f) => f.videos)].some((v) => !v.driveId)) timer.current = setTimeout(() => load(), 5000);
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
  const upload = async (files: FileList | File[] | null) => {
    const list = [...(files || [])].filter((f) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(f.name));
    if (!list.length) return toast('Hãy chọn file video (.mp4, .mov, .m4v, .webm).', true);
    const items = list.map((f) => ({ f, u: { id: Math.random(), name: f.name, folder: tab, progress: 0 } as Upload }));
    setUploads((x) => [...x, ...items.map((i) => i.u)]);
    const direct = c?.storage === 'google';
    // Up to 3 files at once: one connection rarely fills the uplink, and the grid refreshes as each one lands.
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const { f, u } = items[next++];
        try {
          await api.uploadCustomerVideo(id, f, u.folder, direct, (k) => setUploads((x) => x.map((y) => (y.id === u.id ? { ...y, progress: k } : y))));
          setUploads((x) => x.filter((y) => y.id !== u.id));
          await load(true); onChanged();
        } catch (e: any) {
          setUploads((x) => x.map((y) => (y.id === u.id ? { ...y, error: e.message } : y)));
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  };
  const remove = async (v: CustomerVideo) => {
    if (!confirm(`Xoá “${v.name}”?${c?.storage !== 'local' ? ' File sẽ vào Thùng rác của Google Drive (khôi phục được trong 30 ngày).' : ''}`)) return;
    const list = cur?.videos || [], k = list.findIndex((x) => x.key === v.key);
    try {
      await api.deleteCustomerVideo(id, v.key);
      if (viewing === v.key) setViewing((list[k + 1] || list[k - 1])?.key || null);
      await load(); onChanged();
    } catch (e: any) { toast(e.message, true); }
  };
  const copyLink = async (v: CustomerVideo) => {
    if (!v.driveUrl) return;
    try { await navigator.clipboard.writeText(v.driveUrl); toast(v.shared || c?.storage !== 'google' ? 'Đã sao chép link Google Drive' : 'Đã sao chép link (chỉ người có quyền mới xem được — bấm "Chia sẻ" để ai có link cũng xem được)'); }
    catch { toast('Trình duyệt chặn clipboard', true); }
  };
  const share = async (v: CustomerVideo) => {
    try { const r = await api.shareCustomerVideo(id, v.key); await navigator.clipboard.writeText(r.url).catch(() => {}); toast('Ai có link đều xem được. Đã sao chép link.'); await load(); }
    catch (e: any) { toast(e.message, true); }
  };
  const del = async () => {
    if (!c || !confirm(`Ẩn “${c.name}” khỏi danh sách?\nThư mục và video trên Drive vẫn giữ nguyên. Muốn hiện lại: “Đổi thư mục” của một khách bất kỳ và chọn lại thư mục này.`)) return;
    try { await api.deleteCustomer(id); onDeleted(); } catch (e: any) { toast(e.message, true); }
  };

  const saveLinks = async (links: CustomerLink[]) => {
    try { setC(await api.updateCustomer(id, { links })); onChanged(); } catch (e: any) { toast(e.message, true); }
  };

  // Tabs: one per video folder, plus "Chung" for videos lying directly in the customer folder (or when there are no folders yet).
  const tabs: VideoFolder[] = c ? [
    ...(c.videos?.length || !c.folders?.length ? [{ key: '', name: 'Chung', driveUrl: c.driveFolderUrl || null, videos: c.videos || [] }] : []),
    ...(c.folders || []),
  ] : [];
  const cur = tabs.find((t) => t.key === tab) || tabs.find((t) => t.key) || tabs[0];
  useEffect(() => { if (cur && cur.key !== tab) setTab(cur.key); }, [cur?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { ls.set(LS_TAB(id), tab); }, [id, tab]);
  const tabName = (key: string) => tabs.find((t) => t.key === key)?.name || 'Chung';

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

  // The viewer follows the open tab: switching folders closes it, deleting the video moves to a neighbour.
  const shown = cur?.videos.find((v) => v.key === viewing) || null;

  if (!c) return <section className="ws-detail" />;

  return (
    <section className={'ws-detail' + (drag ? ' drag' : '')}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}>
      <header className="ws-head">
        <div className="ws-head-t">
          <p className="ws-crumb" title={c.folderPath || c.folderLabel}>
            {c.folderLabel.split(' › ').slice(0, -1).join(' › ')}{c.account ? ` · ${c.account}` : ''}
          </p>
          <input className="ws-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} onBlur={() => save('name')}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label="Tên khách hàng" />
        </div>
        <Menu label="Tuỳ chọn khách hàng" items={[
          { label: 'Mở trên Google Drive', icon: 'share', href: c.driveFolderUrl || undefined, hidden: !c.driveFolderUrl },
          { label: 'Mở trong Finder', icon: 'folder', onClick: () => api.revealCustomer(id).catch((e) => toast(e.message, true)), hidden: c.storage === 'google' },
          { label: 'Liên kết thư mục khác…', icon: 'layers', onClick: () => setLinking(true) },
          { label: 'Ẩn khỏi danh sách', icon: 'trash', onClick: del, danger: true },
        ]} />
      </header>
      <FolderPicker open={linking} title={`Thư mục của ${c.name}`} start={c.folderLoc} confirmLabel="Liên kết thư mục này" onClose={() => setLinking(false)} onAddAccount={onAddAccount}
        onPick={async (loc) => { setC(await api.linkCustomerFolder(id, loc)); onChanged(); toast('Đã liên kết thư mục'); }} />

      <div className="ws-body">
      <div className="ws-main">
      <div className="ws-tabrow">
        <div className="ws-tabs" role="tablist" aria-label="Thư mục video" ref={tabsRef} onScroll={fadeTabs}
          onWheel={(e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY; }}>
          {tabs.map((t) => (
            <button key={t.key || '_'} role="tab" aria-selected={t.key === cur?.key} className={'ws-tab' + (t.key === cur?.key ? ' on' : '')}
              onClick={() => { setTab(t.key); setNaming(null); }}
              onDoubleClick={() => t.key && setNaming({ mode: 'rename', value: t.name })}>
              <Icon name={t.key ? 'folder' : 'film'} size={14} />{t.name}<em>{t.videos.length}</em>
            </button>
          ))}
          {naming?.mode !== 'new' && <button className="ws-tab ws-tab-add" onClick={() => setNaming({ mode: 'new', value: '' })} title="Thư mục mới" aria-label="Thư mục mới"><Icon name="plus" size={14} /></button>}
        </div>
        {cur && <Menu label="Tuỳ chọn thư mục" items={[
          { label: 'Mở trên Google Drive', icon: 'share', href: cur.driveUrl || undefined, hidden: !cur.driveUrl },
          { label: 'Đổi tên', icon: 'text', onClick: () => setNaming({ mode: 'rename', value: cur.name }), hidden: !cur.key },
          { label: 'Xoá thư mục', icon: 'trash', onClick: removeFolder, danger: true, hidden: !cur.key || !!cur.videos.length },
        ]} />}
        <button className="btn btn-primary btn-sm" onClick={() => fileRef.current?.click()}><Icon name="plus" size={14} />Tải lên</button>
        <input ref={fileRef} type="file" accept="video/*" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
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
          <span className="ws-up-t">{u.name} → {tabName(u.folder)} · {u.error || `${Math.round(u.progress * 100)}%`}</span>
          {u.error && <IconButton icon="x" label="Ẩn" size={13} onClick={() => setUploads((x) => x.filter((y) => y.id !== u.id))} />}
        </div>
      ))}
      {!cur?.videos.length && !uploads.some((u) => u.folder === cur?.key) && (
        <button className="an-drop ws-drop" onClick={() => fileRef.current?.click()}>
          <Icon name="film" size={28} /><b>Chưa có video</b>
          <span>Kéo thả video vào đây hoặc bấm để chọn file.</span>
        </button>
      )}
      <div className="ws-videos">
        {cur?.videos.map((v) => (
          <article key={v.key} className={'ws-video' + (v.key === viewing ? ' on' : '')}>
            <div className="ws-thumb">
              <button className="ws-play" onClick={() => setViewing(v.key)} aria-label={`Xem ${v.name}`} aria-pressed={v.key === viewing} style={v.thumb ? { backgroundImage: `url("${v.thumb}")` } : undefined}><Icon name="play" size={26} /></button>
              {c.storage === 'desktop' && !v.driveId && <span className="tpl-badge ws-sync">Đang đồng bộ…</span>}
            </div>
            <button className="ws-vmeta" onClick={() => setViewing(v.key)}>
              <b title={v.name}>{v.name}</b>
              <span>{mb(v.bytes)} · {date(v.modifiedAt)}</span>
            </button>
          </article>
        ))}
      </div>
      </div>

      <aside className={'ws-aside' + (shown ? ' viewing' : '')}>
        {shown && cur ? (
          <Viewer key={shown.key} v={shown} list={cur.videos} storage={c.storage} folder={cur.key ? cur.name : c.name}
            onPick={setViewing} onClose={() => setViewing(null)} onCopy={copyLink} onShare={share} onDelete={remove} />
        ) : <>
        <Links links={c.links} onSave={saveLinks} />
        <label className="ws-field ws-notes"><span>Ghi chú</span>
          <textarea rows={4} value={form.notes} placeholder="Brief, yêu cầu, deadline…" onChange={(e) => setForm({ ...form, notes: e.target.value })} onBlur={() => save('notes')} />
        </label>
        </>}
      </aside>
      </div>

      {drag && <div className="ws-dropover"><Icon name="film" size={32} />Thả để tải video vào “{cur?.name || 'Chung'}”</div>}
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

function Links({ links, onSave }: { links: CustomerLink[]; onSave: (l: CustomerLink[]) => Promise<void> }) {
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
            <Menu label="Tuỳ chọn link" size={15} items={[
              { label: 'Đổi tên…', icon: 'text', onClick: () => { const n = prompt('Tên link', l.label || k.label); if (n !== null) onSave(links.map((x, j) => (j === i ? { ...x, label: n.trim() } : x))); } },
              { label: 'Sao chép link', icon: 'copy', onClick: () => copy(l.url) },
              { label: 'Xoá', icon: 'trash', danger: true, onClick: () => onSave(links.filter((_, j) => j !== i)) },
            ]} />
          </div>
        );
      })}
      <form className="ws-link-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <Icon name="plus" size={14} />
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Dán link Sheet, Docs… rồi nhấn Enter" inputMode="url" aria-label="Thêm link" />
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- viewer panel
function Viewer({ v, list, storage, folder, onPick, onClose, onCopy, onShare, onDelete }: {
  v: CustomerVideo; list: CustomerVideo[]; storage: Customer['storage']; folder: string;
  onPick: (key: string) => void; onClose: () => void; onCopy: (v: CustomerVideo) => void; onShare: (v: CustomerVideo) => void; onDelete: (v: CustomerVideo) => void;
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

  return (
    <div className={'ws-viewer' + (dims && dims.w > dims.h ? ' wide' : '')}>
      <header className="ws-viewer-h">
        <span>{folder}</span>
        {list.length > 1 && <>
          <IconButton icon="left" label="Video trước (←)" size={15} disabled={!prev} onClick={() => prev && onPick(prev.key)} />
          <em className="ws-viewer-n">{k + 1}/{list.length}</em>
          <IconButton icon="right" label="Video sau (→)" size={15} disabled={!next} onClick={() => next && onPick(next.key)} />
        </>}
        <IconButton icon="x" label="Đóng (Esc)" size={15} onClick={onClose} />
      </header>
      {/* Sized to the clip's own shape (mostly 9:16 phone videos) so it fills the panel without black bars. */}
      <div className="ws-viewer-stage">
        <video className="ws-viewer-v" src={v.url} poster={v.thumb || undefined} controls autoPlay playsInline
          style={{ aspectRatio: dims?.w ? `${dims.w} / ${dims.h}` : '9 / 16' }}
          onLoadedMetadata={(e) => setDims({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight, d: e.currentTarget.duration })} />
      </div>
      <div className="ws-viewer-m">
        <b title={v.name}>{v.name}</b>
        <span>{[dims && dims.w ? `${dims.w}×${dims.h}` : '', dims && isFinite(dims.d) ? dur(dims.d) : '', mb(v.bytes), date(v.modifiedAt)].filter(Boolean).join(' · ')}</span>
        {storage === 'desktop' && !v.driveId && <span>Đang đồng bộ lên Drive…</span>}
        {storage === 'google' && v.shared && <span>Ai có link đều xem được</span>}
      </div>
      <div className="ws-viewer-a">
        {v.driveUrl && (storage === 'google' && !v.shared
          ? <button className="btn btn-tinted btn-sm" onClick={() => onShare(v)} title="Ai có link đều xem được"><Icon name="share" size={14} />Chia sẻ link</button>
          : <button className="btn btn-tinted btn-sm" onClick={() => onCopy(v)}><Icon name="copy" size={14} />Sao chép link</button>)}
        <Menu label="Tuỳ chọn video" className="up" items={[
          { label: 'Mở trên Google Drive', icon: 'share', href: v.driveUrl || undefined, hidden: !v.driveUrl },
          { label: 'Tải về', icon: 'download', onClick: () => { const a = document.createElement('a'); a.href = v.url; a.download = v.name; a.click(); } },
          { label: 'Xoá video', icon: 'trash', onClick: () => onDelete(v), danger: true },
        ]} />
      </div>
    </div>
  );
}
