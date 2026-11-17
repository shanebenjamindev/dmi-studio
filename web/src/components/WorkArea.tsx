import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { goto, openLink, openPages, toast, useStore, type View } from '../store';
import { Icon } from './ui';
import { openSub, sectionOf, sectionPages } from './TopBar';
import type { TaskMeta } from '../types';
import { Avatar } from './boardkit';
import { toggleMessenger } from './Messenger';
import { SidebarTree, type TreeBrandNode, type TreeCustomerNode } from './kit';

// The column beside the navigation rail for a section with pages of its own (Công việc, Báo cáo, Tools): its pages, and
// for Công việc the projects by team, found by name. It folds away (« or the section's rail item again), remembered.
// Existing board, Drive and editor addresses stay valid.
const SECTIONS: Record<string, { title: string; sub: string; pages: Partial<Record<View, [string, string]>> }> = {
  work: { title: 'Công việc', sub: 'Công việc & dịch vụ', pages: { tasks: ['Công việc của tôi', 'checklist'], projects: ['Dịch vụ', 'folder'] } },
  reports: { title: 'Báo cáo', sub: 'Báo cáo khách hàng & quảng cáo', pages: { reports: ['Tất cả báo cáo', 'file'], ads: ['Meta Ads', 'chart'] } },
  tools: { title: 'Tools', sub: 'Công cụ', pages: { tools: ['Chuyển đổi định dạng', 'wand'] } },
};
const LS_FOLD = 'dms.sectionFolded';

export function WorkArea({ children }: { children: ReactNode }) {
  const view = useStore((s) => s.view);
  const user = useStore((s) => s.user);
  const adminAccess = useStore((s) => s.admin);
  useStore((s) => s.pages);
  const section = sectionOf(view), def = SECTIONS[section], pages = def ? sectionPages(section, openPages()) : [];
  const [folded, setFolded] = useState(() => { try { return localStorage.getItem(LS_FOLD) === '1'; } catch { return false; } });
  const [searchQuery, setSearchQuery] = useState('');
  const [taskNavMode, setTaskNavMode] = useState<'all' | 'mine'>(() => {
    try {
      const s = localStorage.getItem('dms.taskScope');
      const r = localStorage.getItem('dms.taskRel');
      return s === 'org' || s === 'all' || (s === 'mine' && r === 'all') ? 'all' : 'mine';
    } catch { return 'mine'; }
  });
  const fold = (v: boolean) => { setFolded(v); try { localStorage.setItem(LS_FOLD, v ? '1' : '0'); } catch { /* private mode */ } };
  useEffect(() => { const toggle = () => setFolded((f) => { const v = !f; try { localStorage.setItem(LS_FOLD, v ? '1' : '0'); } catch { /* private mode */ } return v; }); window.addEventListener('dms:section-fold', toggle); return () => window.removeEventListener('dms:section-fold', toggle); }, []);
  useEffect(() => {
    const onFilter = (e: any) => {
      const d = e.detail;
      if (d?.scope === 'org' || d?.scope === 'all' || (d?.scope === 'mine' && d?.rel === 'all')) setTaskNavMode('all');
      else if (d?.scope === 'mine' || d?.scope === 'team') setTaskNavMode('mine');
    };
    window.addEventListener('dms:task-filter', onFilter);
    window.addEventListener('dms:task-nav-sync', onFilter);
    return () => {
      window.removeEventListener('dms:task-filter', onFilter);
      window.removeEventListener('dms:task-nav-sync', onFilter);
    };
  }, []);
  if (!def || !pages.length) return <>{children}</>;

  const isWork = section === 'work';
  const hasOrgTasks = user?.role === 'admin' || !!adminAccess?.perms?.['tasks.view'];

  const handleSelectMyTasks = () => {
    setTaskNavMode('mine');
    try {
      localStorage.setItem('dms.taskScope', 'mine');
      localStorage.setItem('dms.taskRel', 'assigned');
      localStorage.setItem('dms.taskOverview', '0');
      localStorage.setItem('dms.taskView', 'list');
    } catch {}
    window.dispatchEvent(new CustomEvent('dms:task-filter', { detail: { scope: 'mine', rel: 'assigned', project: '', view: 'list', overview: false, clearOpen: true } }));
    openSub('tasks');
  };

  const handleSelectAllTasks = () => {
    const nextScope = hasOrgTasks ? 'org' : 'mine';
    const nextRel = hasOrgTasks ? '' : 'all';
    setTaskNavMode('all');
    try {
      localStorage.setItem('dms.taskScope', nextScope);
      if (nextRel) localStorage.setItem('dms.taskRel', nextRel);
      localStorage.setItem('dms.taskOverview', '0');
      localStorage.setItem('dms.taskView', 'list');
    } catch {}
    window.dispatchEvent(new CustomEvent('dms:task-filter', { detail: { scope: nextScope, rel: nextRel, project: '', view: 'list', overview: false, clearOpen: true } }));
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
            <h4>Tổng hợp</h4>
            <nav>
              {pages.includes('tasks') && (
                <button
                  className={'wework-nav-btn' + (view === 'tasks' && taskNavMode === 'all' ? ' active' : '')}
                  onClick={handleSelectAllTasks}
                >
                  <Icon name="list" size={16} />
                  <span>Tổng task</span>
                </button>
              )}
              {pages.includes('tasks') && (
                <button
                  className={'wework-nav-btn' + (view === 'tasks' && taskNavMode === 'mine' ? ' active' : '')}
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
                  <span>Dịch vụ</span>
                </button>
              )}
            </nav>
          </div>

          <ProjectList isWework={true} query={searchQuery} />

          <div className="wework-nav-sec" style={{ marginTop: 'auto', paddingBottom: 16 }}>
            <h4>Hướng dẫn</h4>
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

/** Cây 3 cấp Khách hàng ▸ Nhãn hàng ▸ Dịch vụ, kèm số task đang mở (chữ xám). */
function readTreeSelection() {
  const h = location.hash;
  const serviceId = h.match(/^#projects\/(tj_\w+)/)?.[1] || null;
  const qStr = h.includes('?') ? h.slice(h.indexOf('?') + 1) : '';
  const qp = new URLSearchParams(qStr);
  const brandId = qp.get('brand') || null;
  const customerId = qp.get('customer') || h.match(/^#customers\/(cu_\w+)/)?.[1] || null;
  return { serviceId, brandId, customerId };
}

function ProjectList({ isWework = false, query = '' }: { isWework?: boolean; query?: string }) {
  const [meta, setMeta] = useState<TaskMeta | null>(null);
  const [sel, setSel] = useState(readTreeSelection);

  useEffect(() => {
    const load = () => api.taskMeta().then(setMeta, () => {});
    void load();
    window.addEventListener('dms:entities-changed', load);
    return () => window.removeEventListener('dms:entities-changed', load);
  }, []);

  useEffect(() => {
    const onHash = () => setSel(readTreeSelection());
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onHash);
    };
  }, []);

  const services = meta?.brandServices || meta?.projects || [];
  if (!services.length && !(meta?.brands || []).length) return null;

  const custMap = new Map<string, { id: string; name: string; brands: Map<string, TreeBrandNode> }>();
  const ensureCust = (id: string, name: string) => {
    if (!custMap.has(id)) custMap.set(id, { id, name, brands: new Map() });
    return custMap.get(id)!;
  };
  const ensureBrand = (c: { brands: Map<string, TreeBrandNode> }, id: string, name: string) => {
    if (!c.brands.has(id)) c.brands.set(id, { id, name, openTasks: 0, services: [] });
    return c.brands.get(id)!;
  };

  for (const s of services) {
    const cid = s.customerId || '_none';
    const cname = s.customerName || 'Dịch vụ nội bộ';
    const cust = ensureCust(cid, cname);
    const bid = s.brandId || `_legacy_${cid}`;
    const bname = s.brandName || (s.customerName ? s.customerName : 'Mặc định');
    const brand = ensureBrand(cust, bid, bname);
    const open = Math.max(0, (s.tasks || 0) - (s.completed || 0));
    brand.services.push({ id: s.id, name: s.name, openTasks: open });
    brand.openTasks += open;
  }

  for (const b of meta?.brands || []) {
    const cust = custMap.get(b.customerId);
    if (cust && !cust.brands.has(b.id)) {
      cust.brands.set(b.id, { id: b.id, name: b.name, openTasks: 0, services: [] });
    }
  }

  const tree: TreeCustomerNode[] = [...custMap.values()]
    .map((c) => {
      const brands = [...c.brands.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      return {
        id: c.id,
        name: c.name,
        openTasks: brands.reduce((sum, b) => sum + b.openTasks, 0),
        brands,
      };
    })
    .filter((c) => c.brands.some((b) => b.services.length > 0))
    .sort((a, b) => (a.id === '_none' ? 1 : b.id === '_none' ? -1 : a.name.localeCompare(b.name, 'vi')));

  if (!tree.length) return null;

  const content = (
    <div className={isWework ? 'wework-projects-sec' : 'sec-tree-sec'}>
      {isWework && <div className="wework-nav-sec" style={{ marginBottom: 4 }}><h4>Khách hàng · Nhãn hàng</h4></div>}
      <SidebarTree
        embedded
        externalQuery={isWework ? query : undefined}
        customers={tree}
        selectedServiceId={sel.serviceId}
        selectedBrandId={sel.brandId}
        selectedCustomerId={sel.customerId}
        onSelectService={(serviceId) => openLink(`#projects/${serviceId}`)}
        onSelectBrand={(brandId) => openLink(`#projects?brand=${encodeURIComponent(brandId)}`)}
        onSelectCustomer={(customerId) =>
          openLink(customerId !== '_none' ? `#projects?customer=${encodeURIComponent(customerId)}` : '#projects')
        }
      />
    </div>
  );

  return content;
}
