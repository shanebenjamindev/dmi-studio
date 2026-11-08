import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { openLink, openPages, useStore, type View } from '../store';
import { Icon } from './ui';
import { openSub, sectionOf, sectionPages } from './TopBar';
import type { TaskMeta } from '../types';

// The column beside the navigation rail for a section with pages of its own (Công việc, Báo cáo, Tools): its pages, and
// for Công việc the projects by team, found by name. It folds away (« or the section's rail item again), remembered.
// Existing board, Drive and editor addresses stay valid.
const SECTIONS: Record<string, { title: string; sub: string; pages: Partial<Record<View, [string, string]>> }> = {
  work: { title: 'Công việc', sub: 'Công việc & dự án', pages: { tasks: ['Công việc của tôi', 'checklist'], projects: ['Dự án', 'folder'] } },
  reports: { title: 'Báo cáo', sub: 'Báo cáo khách hàng & quảng cáo', pages: { reports: ['Tất cả báo cáo', 'file'], ads: ['Meta Ads', 'activity'] } },
  tools: { title: 'Tools', sub: 'Công cụ', pages: { tools: ['Chuyển đổi định dạng', 'wand'], editor: ['Trình dựng', 'film'] } },
};
const LS_FOLD = 'dms.sectionFolded';

export function WorkArea({ children }: { children: ReactNode }) {
  const view = useStore((s) => s.view);
  useStore((s) => s.pages);
  const section = sectionOf(view), def = SECTIONS[section], pages = def ? sectionPages(section, openPages()) : [];
  const [folded, setFolded] = useState(() => { try { return localStorage.getItem(LS_FOLD) === '1'; } catch { return false; } });
  const fold = (v: boolean) => { setFolded(v); try { localStorage.setItem(LS_FOLD, v ? '1' : '0'); } catch { /* private mode */ } };
  useEffect(() => { const toggle = () => setFolded((f) => { const v = !f; try { localStorage.setItem(LS_FOLD, v ? '1' : '0'); } catch { /* private mode */ } return v; }); window.addEventListener('dms:section-fold', toggle); return () => window.removeEventListener('dms:section-fold', toggle); }, []);
  if (!def || !pages.length) return <>{children}</>;
  return (
    <section className="sec-area" aria-label={def.title}>
      <aside className={'sec-nav' + (folded ? ' folded' : '')} aria-label={`Mục ${def.title}`} aria-hidden={folded}>
        <header>
          <div
            className="sec-nav-title"
            role="button"
            tabIndex={0}
            onClick={() => openSub(pages[0])}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSub(pages[0]); } }}
            title={`Về ${def.title}`}
          >
            <h2>{def.title}</h2>
            <p>{def.sub}</p>
          </div>
          <button className="bd-icon" onClick={() => fold(true)} aria-label="Thu gọn" title="Thu gọn"><Icon name="left" size={16} /></button>
        </header>
        <h3>Tổng hợp</h3>
        <nav>{pages.map((v) => { const [label, icon] = def.pages[v]!; return <button key={v} aria-current={view === v ? 'page' : undefined} onClick={() => openSub(v)}><Icon name={icon} size={16} />{label}</button>; })}</nav>
        {section === 'work' && <ProjectList />}
      </aside>
      {folded && <button className="sec-unfold" onClick={() => fold(false)} aria-label={`Mở mục ${def.title}`} title={`Mở mục ${def.title}`}><Icon name="lines" size={16} /></button>}
      <div className="sec-content">{children}</div>
    </section>
  );
}

/** The projects this account may open, grouped by customer; projects without a customer go under "Chưa phân loại". */
function ProjectList() {
  const [meta, setMeta] = useState<TaskMeta | null>(null), [q, setQ] = useState('');
  useEffect(() => {
    const load = () => api.taskMeta().then(setMeta, () => {});
    void load();
    window.addEventListener('dms:entities-changed', load);
    return () => window.removeEventListener('dms:entities-changed', load);
  }, []);
  const readProject=()=>location.hash.match(/^#projects\/(tj_\w+)/)?.[1];
  const [current,setCurrent]=useState(readProject);
  useEffect(()=>{const changed=()=>setCurrent(readProject());window.addEventListener('hashchange',changed);return()=>window.removeEventListener('hashchange',changed);},[]);
  const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  const projects = (meta?.projects || []).filter((p) => !q || fold(p.name).includes(fold(q)));
  if (!meta?.projects.length) return null;

  const custMap = new Map<string, { id: string; name: string; projects: typeof projects }>();
  const unclassified: typeof projects = [];
  for (const p of projects) {
    if (p.customerId && p.customerName) {
      if (!custMap.has(p.customerId)) custMap.set(p.customerId, { id: p.customerId, name: p.customerName, projects: [] });
      custMap.get(p.customerId)!.projects.push(p);
    } else {
      unclassified.push(p);
    }
  }
  const groups = [...custMap.values()];
  if (unclassified.length) groups.push({ id: '', name: 'Chưa phân loại', projects: unclassified });

  return <>
    <label className="sec-find"><Icon name="search" size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm nhanh dự án" aria-label="Tìm nhanh dự án" /></label>
    {groups.map((g) => (
      <div key={g.id || 'none'} className="sec-group"><h3>{g.name}</h3><nav>{g.projects.map((p) => (
        <button key={p.id} aria-current={current === p.id ? 'page' : undefined} onClick={() => openLink(`#projects/${p.id}`)} title={p.name}>
          <span className="sec-dot" style={{ background: '#3b82f6', display: 'inline-grid', placeItems: 'center', color: '#fff' }}><Icon name="folder" size={10} /></span><span className="sec-label">{p.name}</span>
        </button>
      ))}</nav></div>
    ))}
    {q && !projects.length && <p className="sec-none">Không có dự án nào khớp</p>}
  </>;
}
