import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { goto, openPages, useStore, type View } from '../store';
import { Icon } from './ui';
import { ProjectCampaigns } from './ProjectCampaigns';
import type { TaskMeta } from '../types';

// Workspace (the boards) is a tab of its own in the top bar, outside this area.
const WORK: View[] = ['tasks', 'projects', 'workspace'];
const TABS: [View, string, string][] = [['tasks', 'Công việc của tôi', 'checklist'], ['projects', 'Dự án', 'folder']];

/** One work area; existing board, Drive and editor URLs remain valid. */
export function WorkArea({ children }: { children: ReactNode }) {
  const view = useStore((s) => s.view);
  useStore((s) => s.pages);
  if (!WORK.includes(view)) return <>{children}</>;
  const selected = view === 'workspace' ? 'projects' : view;
  const go = (v: View) => {
    try { localStorage.setItem('dms.workView', v); } catch { /* private mode */ }
    goto(v);
  };
  return (
    <section className="work-area" aria-label="Quản lý công việc và dự án">
      <div className="work-bar">
        <nav className="work-tabs" aria-label="Mục công việc">
          {TABS.map(([v, label, icon]) => <button key={v} className={selected === v ? 'on' : ''} aria-current={selected === v ? 'page' : undefined} onClick={() => go(v)}><Icon name={icon} size={16} />{label}</button>)}
        </nav>
        {selected === 'projects' && openPages().includes('workspace') && <button className={'work-drive' + (view === 'workspace' ? ' on' : '')} onClick={() => goto(view === 'workspace' ? 'projects' : 'workspace')}><Icon name={view === 'workspace' ? 'left' : 'folder'} size={15} />{view === 'workspace' ? 'Về dự án' : 'Drive'}</button>}
      </div>
      <div className="work-content">{children}</div>
    </section>
  );
}

const fromHash = () => location.hash.match(/^#projects\/(tj_\w+)/)?.[1] || null;

/** Work projects and their tasks. Video projects live in the editor under Tools. */
export function WorkProjects() {
  const [meta, setMeta] = useState<TaskMeta | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [team,setTeam]=useState('');
  const [selected, setSelected] = useState<string | null>(fromHash);
  useEffect(() => {
    let active = true;
    api.taskMeta().then((m) => { if (active) setMeta(m); }, (e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const changed = () => setSelected(fromHash());
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  useEffect(()=>{const refresh=()=>{api.taskMeta().then(setMeta,()=>{});};window.addEventListener('dms:entities-changed',refresh);return()=>window.removeEventListener('dms:entities-changed',refresh);},[]);
  const select = (id: string | null) => { setSelected(id); history.replaceState(null, '', id ? `#projects/${id}` : '#projects'); };
  const current = meta?.projects.find((p) => p.id === selected);
  const matches = (s: string) => s.toLocaleLowerCase('vi').includes(query.trim().toLocaleLowerCase('vi'));
  const tasks = meta?.projects.filter((p) => matches(p.name)&&(!team||p.teamId===team)) || [];
  if (selected && meta) return (
    <div className="work-project-detail">
      <div className="work-project-back"><button className="btn btn-gray btn-sm" onClick={() => select(null)}><Icon name="left" size={14} />Tất cả dự án</button></div>
      {current ? <ProjectCampaigns key={current.id} id={current.id} name={current.name} /> : <p className="note">Không tìm thấy dự án này.</p>}
    </div>
  );
  return (
    <main className="work-projects">
      <header className="work-project-heading"><div><h1>Dự án</h1><p>Theo dõi dự án và công việc của nhóm.</p></div><label className="rp-search"><Icon name="search" size={15} /><input aria-label="Tìm dự án" placeholder="Tìm dự án…" value={query} onChange={(e) => setQuery(e.target.value)} /></label></header>
      {error && <p className="note err" role="alert">{error}</p>}
      <section className="work-project-section">
        <header><h2>Dự án công việc <span>{tasks.length}</span></h2><select aria-label="Lọc dự án theo team" value={team} onChange={e=>setTeam(e.target.value)}><option value="">Tất cả team</option>{meta?.teams?.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></header>
        {!meta ? <p className="note">{error ? 'Không tải được danh sách dự án công việc.' : 'Đang tải…'}</p> : !tasks.length ? <p className="note">{query ? 'Không có dự án phù hợp.' : 'Chưa có dự án công việc. Dự án sẽ xuất hiện khi nhập dữ liệu công việc.'}</p> : <div className="work-project-grid">{tasks.map((p) => <button key={p.id} className="work-project-card" onClick={() => select(p.id)}><span className="work-project-icon"><Icon name="folder" size={20} /></span><span><b>{p.name}</b><small>{meta?.teams?.find(t=>t.id===p.teamId)?.name||'Chưa chọn team'} · {p.tasks} công việc</small></span><Icon name="right" size={15} /></button>)}</div>}
      </section>

    </main>
  );
}
