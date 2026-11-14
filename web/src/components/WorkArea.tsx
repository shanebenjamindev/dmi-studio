import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { goto, openLink, openPages, toast, useStore, type View } from '../store';
import { Icon } from './ui';
import { openSub, sectionOf, sectionPages } from './TopBar';
import type { TaskMeta } from '../types';
import { Avatar } from './boardkit';
import { toggleMessenger } from './Messenger';

// The column beside the navigation rail for a section with pages of its own (Công việc, Báo cáo, Tools): its pages, and
// for Công việc the projects by team, found by name. It folds away (« or the section's rail item again), remembered.
// Existing board, Drive and editor addresses stay valid.
const SECTIONS: Record<string, { title: string; sub: string; pages: Partial<Record<View, [string, string]>> }> = {
  work: { title: 'Công việc', sub: 'Công việc & dịch vụ', pages: { tasks: ['Công việc của tôi', 'checklist'], projects: ['Dịch vụ', 'folder'] } },
  reports: { title: 'Báo cáo', sub: 'Báo cáo khách hàng & quảng cáo', pages: { reports: ['Tất cả báo cáo', 'file'], ads: ['Meta Ads', 'chart'] } },
  tools: { title: 'Tools', sub: 'Công cụ', pages: { tools: ['Chuyển đổi định dạng', 'wand'], editor: ['Trình dựng', 'film'] } },
};
const LS_FOLD = 'dms.sectionFolded';

export function WorkArea({ children }: { children: ReactNode }) {
  const view = useStore((s) => s.view);
  const user = useStore((s) => s.user);
  useStore((s) => s.pages);
  const section = sectionOf(view), def = SECTIONS[section], pages = def ? sectionPages(section, openPages()) : [];
  // A project open in the editor takes the whole width for HyperFrames Studio; its own bar leads back to the list.
  const inProject = useStore((s) => s.view === 'editor' && !!s.project);
  const [folded, setFolded] = useState(() => { try { return localStorage.getItem(LS_FOLD) === '1'; } catch { return false; } });
  const [searchQuery, setSearchQuery] = useState('');
  const fold = (v: boolean) => { setFolded(v); try { localStorage.setItem(LS_FOLD, v ? '1' : '0'); } catch { /* private mode */ } };
  useEffect(() => { const toggle = () => setFolded((f) => { const v = !f; try { localStorage.setItem(LS_FOLD, v ? '1' : '0'); } catch { /* private mode */ } return v; }); window.addEventListener('dms:section-fold', toggle); return () => window.removeEventListener('dms:section-fold', toggle); }, []);
  if (!def || !pages.length) return <>{children}</>;
  if (inProject) return <section className="sec-area" aria-label={def.title}><div className="sec-content">{children}</div></section>;

  const isWork = section === 'work';

  const handleSelectMyTasks = () => {
    try {
      localStorage.setItem('dms.taskScope', 'mine');
      localStorage.setItem('dms.taskRel', 'assigned');
    } catch {}
    window.dispatchEvent(new CustomEvent('dms:task-filter', { detail: { scope: 'mine', rel: 'assigned', project: '' } }));
    openSub('tasks');
  };

  const handleSelectAllTasks = () => {
    try {
      localStorage.setItem('dms.taskScope', 'all');
    } catch {}
    window.dispatchEvent(new CustomEvent('dms:task-filter', { detail: { scope: 'all', project: '' } }));
    openSub('tasks');
  };

  return (
    <section className="sec-area" aria-label={def.title}>
      {isWork ? (
        <aside className={'sec-nav wework-nav' + (folded ? ' folded' : '')} aria-label="Base Wework Navigation" aria-hidden={folded}>
          <div className="wework-nav-top">
            <label className="wework-nav-search">
              <Icon name="search" size={13} />
              <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Tìm nhanh" aria-label="Tìm nhanh" />
            </label>
            <button className="bd-icon wework-nav-fold" onClick={() => fold(true)} aria-label="Thu gọn sidebar" title="Thu gọn"><Icon name="left" size={16} /></button>
          </div>

          <div className="wework-nav-sec">
            <h4>TỔNG HỢP</h4>
            <nav>
              {pages.includes('tasks') && (
                <button
                  className={'wework-nav-btn' + (view === 'tasks' ? ' active' : '')}
                  onClick={handleSelectMyTasks}
                >
                  <Icon name="user" size={16} />
                  <span>Công việc của tôi</span>
                </button>
              )}
              {pages.includes('projects') && (
                <button
                  className={'wework-nav-btn' + (view === 'projects' ? ' active' : '')}
                  onClick={() => openSub('projects')}
                >
                  <Icon name="folder" size={16} />
                  <span>Dịch vụ & phòng ban</span>
                </button>
              )}
            </nav>
          </div>

          <ProjectList isWework={true} query={searchQuery} />

          <div className="wework-nav-sec" style={{ marginTop: 'auto', paddingBottom: 16 }}>
            <h4>TÙY CHỈNH</h4>
            <nav>
              <button className="wework-nav-btn" onClick={() => toast('Video hướng dẫn sử dụng')}>
                <Icon name="play" size={14} />
                <span>Video hướng dẫn</span>
              </button>
            </nav>
          </div>
        </aside>
      ) : (
        <aside className={'sec-nav wework-nav' + (folded ? ' folded' : '')} aria-label={`Mục ${def.title}`} aria-hidden={folded}>
          <div className="wework-nav-top">
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
            <button className="bd-icon wework-nav-fold" onClick={() => fold(true)} aria-label="Thu gọn" title="Thu gọn"><Icon name="left" size={16} /></button>
          </div>
          <div className="wework-nav-sec">
            <h4>Tổng hợp</h4>
            <nav>{pages.map((v) => { const [label, icon] = def.pages[v]!; return <button key={v} className={'wework-nav-btn' + (view === v ? ' active' : '')} aria-current={view === v ? 'page' : undefined} onClick={() => openSub(v)}><Icon name={icon} size={16} /><span>{label}</span></button>; })}</nav>
          </div>
        </aside>
      )}
      {folded && <button className="sec-unfold" onClick={() => fold(false)} aria-label={`Mở mục ${def.title}`} title={`Mở mục ${def.title}`}><Icon name="lines" size={16} /></button>}
      <div className="sec-content">{children}</div>
    </section>
  );
}

/** The projects this account may open, grouped by customer; projects without a customer go under "Chưa phân loại". */
function ProjectList({ isWework = false, query = '' }: { isWework?: boolean; query?: string }) {
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
  const effectiveQ = isWework ? query : q;
  const projects = (meta?.projects || []).filter((p) => !effectiveQ || fold(p.name).includes(fold(effectiveQ)));
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

  if (isWework) {
    return (
      <div className="wework-projects-sec">
        {groups.map((g) => {
          const isCustomer = !!g.id;
          const groupTitle = isCustomer ? (g.name.toUpperCase().includes('TEAM') ? g.name.toUpperCase() : 'ACCOUNT TEAM') : 'CHƯA PHÂN LOẠI';
          return (
            <div key={g.id || 'none'} className="wework-nav-sec">
              <h4>{groupTitle}</h4>
              <nav>
                {g.projects.map((p) => {
                  const initial = p.name.replace(/^\[.*?\]\s*/, '').charAt(0).toUpperCase() || 'P';
                  return (
                    <button
                      key={p.id}
                      className={'wework-nav-btn' + (current === p.id ? ' active' : '')}
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent('dms:task-filter', { detail: { project: p.id } }));
                        openLink(`#projects/${p.id}`);
                      }}
                      title={p.name}
                    >
                      <span className="wework-proj-badge" style={{ background: isCustomer ? '#10b981' : '#0284c7' }}>{initial}</span>
                      <span className="wework-proj-label">{p.name}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
          );
        })}
      </div>
    );
  }

  return <>
    <label className="sec-find"><Icon name="search" size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm nhanh dịch vụ" aria-label="Tìm nhanh dịch vụ" /></label>
    {groups.map((g) => (
      <div key={g.id || 'none'} className="sec-group"><h3>{g.name}</h3><nav>{g.projects.map((p) => (
        <button key={p.id} aria-current={current === p.id ? 'page' : undefined} onClick={() => openLink(`#projects/${p.id}`)} title={p.name}>
          <span className="sec-dot" style={{ background: '#3b82f6', display: 'inline-grid', placeItems: 'center', color: '#fff' }}><Icon name="folder" size={10} /></span><span className="sec-label">{p.name}</span>
        </button>
      ))}</nav></div>
    ))}
    {q && !projects.length && <p className="sec-none">Không có dịch vụ nào khớp</p>}
  </>;
}
