// Quản trị: a side menu of sections (each opens and closes; only the pages this account may use are listed) and the
// open page, with where it sits above it. It uses the app's own blue, like every other page.
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { Icon } from '../components/ui';
import { tr } from '../i18n';
import { useStore } from '../store';
import { NAV, parseRoute, goAdmin, type NavGroup } from './nav';
import { Empty, fold } from './kit';
import * as Stats from './pages/Stats';
import * as Staff from './pages/Staff';
import * as Rbac from './pages/Rbac';
import * as Work from './pages/Work';
import * as Customers from './pages/Customers';
import * as Services from './pages/Services';
import * as Notify from './pages/Notify';
import * as Logs from './pages/Logs';
import * as System from './pages/System';
import * as Hosting from './pages/Hosting';
import * as Support from './pages/Support';

const PAGES: Record<string, ComponentType> = {
  'stats/overview': Stats.Overview, 'stats/activity': Stats.Activity, 'stats/customers': Stats.CustomerStats, 'stats/tasks': Stats.TaskStats, 'stats/staff': Stats.StaffStats, 'stats/performance': Stats.Performance,
  'staff/list': Staff.StaffList, 'staff/admins': Staff.AdminAccounts, 'staff/activity': Logs.StaffActivity, 'staff/departments': Staff.Departments, 'staff/positions': Staff.Positions, 'staff/teams': Staff.Teams,
  'rbac/roles': Rbac.Roles, 'rbac/groups': Rbac.PermissionGroups, 'rbac/permissions': Rbac.PermissionMatrix, 'rbac/assign': Rbac.Assign,
  'tasks/list': Work.AllTasks, 'tasks/statuses': Work.Statuses, 'tasks/categories': Work.Categories, 'tasks/priorities': Work.Priorities, 'tasks/workflow': Work.Workflow, 'tasks/templates': Work.Templates, 'tasks/overdue': Work.Overdue,
  'customers/list': Customers.CustomerList, 'customers/categories': Customers.Categories, 'customers/statuses': Customers.Statuses, 'customers/sources': Customers.Sources,
  'services/list': Services.ServiceList, 'services/categories': Services.Categories, 'services/packages': Services.Packages,
  'notify/list': Notify.Sent, 'notify/create': Notify.Compose, 'notify/templates': Notify.Templates, 'notify/history': Notify.MailLog,
  'logs/logins': Logs.Logins, 'logs/actions': Logs.Actions, 'logs/data': Logs.DataChanges, 'logs/permissions': Logs.PermissionChanges, 'logs/errors': Logs.Errors,
  'system/info': System.Info, 'system/general': System.General, 'system/statuses': Work.Statuses, 'system/notifications': System.NotificationConfig, 'system/storage': System.Storage, 'system/hosting': Hosting.Hosting, 'system/sql': Hosting.Sql, 'system/backup': System.Backup,
  'support/list': Support.SupportList,
};
const LS_OPEN = 'dms.adminOpen';

export function AdminApp() {
  const access = useStore((s) => s.admin), user = useStore((s) => s.user)!;
  const has = (perm: string) => user.role === 'admin' || !!access?.perms[perm];
  const groups: NavGroup[] = useMemo(() => NAV.map((g) => ({ ...g, pages: g.pages.filter((p) => has(p.perm)) })).filter((g) => g.pages.length), [access, user.role]); // eslint-disable-line react-hooks/exhaustive-deps
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  const [find, setFind] = useState('');
  const [menu, setMenu] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem(LS_OPEN) || '{}'); } catch { return {}; } });
  useEffect(() => { const on = () => setRoute(parseRoute(location.hash)); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  useEffect(() => { try { localStorage.setItem(LS_OPEN, JSON.stringify(open)); } catch { /* private mode */ } }, [open]);

  // The page asked for when this account may use it; else the first one it may.
  const group = groups.find((g) => g.key === route.group && g.pages.some((p) => p.key === route.page)) || groups[0];
  const page = group?.pages.find((p) => p.key === route.page) || group?.pages[0];
  useEffect(() => { if (group && page && (route.group !== group.key || route.page !== page.key)) history.replaceState(null, '', `#admin/${group.key}/${page.key}`); }, [group?.key, page?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!group || !page) return <main className="ax"><div className="ax-main"><Empty icon="lock" title="Bạn chưa có quyền quản trị nào" text="Nhờ Super Admin gán vai trò có quyền quản trị cho bạn trong Phân quyền." /></div></main>;
  const Page = PAGES[`${group.key}/${page.key}`];
  // Every word typed, in any order and without marks ("trang thai cong viec" finds Công việc › Trạng thái).
  const words = fold(find).split(/\s+/).filter(Boolean);
  const shown = groups.map((g) => ({ ...g, pages: g.pages.filter((p) => { const text = fold(`${g.label} ${p.label} ${tr(g.label)} ${tr(p.label)}`); return words.every((w) => text.includes(w)); }) })).filter((g) => g.pages.length);
  const go = (g: string, p: string) => { setMenu(false); setFind(''); goAdmin(g, p); };

  return (
    <main className="ax">
      <aside className={'ax-side' + (menu ? ' open' : '')} aria-label="Menu quản trị">
        <div className="ax-side-head"><h2>Quản trị</h2><button className="bd-icon ax-side-close" onClick={() => setMenu(false)} aria-label="Đóng menu"><Icon name="x" size={16} /></button></div>
        <label className="ax-search ax-side-search"><Icon name="search" size={14} /><input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Tìm trang quản trị…" aria-label="Tìm trang quản trị" /></label>
        <nav>{shown.map((g) => {
          const expanded = words.length > 0 || g.key === group.key || !!open[g.key];
          return (
            <div key={g.key} className={'ax-group' + (g.key === group.key ? ' current' : '')}>
              <button className="ax-group-h" aria-expanded={expanded} onClick={() => setOpen({ ...open, [g.key]: !expanded })}>
                <Icon name={g.icon} size={16} /><span>{g.label}</span><Icon name="chevron" size={12} className={expanded ? 'up' : ''} />
              </button>
              {expanded && <ul>{g.pages.map((p) => (
                <li key={p.key}><button aria-current={g.key === group.key && p.key === page.key ? 'page' : undefined} onClick={() => go(g.key, p.key)}>{p.label}</button></li>
              ))}</ul>}
            </div>
          );
        })}{!shown.length && <p className="ax-side-none">Không có trang nào khớp</p>}</nav>
      </aside>
      {menu && <div className="ax-side-back" onClick={() => setMenu(false)} />}
      <div className="ax-main">
        <div className="ax-crumbs">
          <button className="bd-icon ax-menu-btn" onClick={() => setMenu(true)} aria-label="Mở menu quản trị"><Icon name="lines" size={16} /></button>
          <nav aria-label="Vị trí"><span>Quản trị</span><i>›</i><button onClick={() => go(group.key, group.pages[0].key)}>{group.label}</button><i>›</i><b>{page.label}</b></nav>
        </div>
        <Page key={`${group.key}/${page.key}`} />
      </div>
    </main>
  );
}
