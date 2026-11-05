import {NotificationBell} from './NotificationBell';
import { useEffect, useRef, useState } from 'react';
import { useStore, signOut, openPages, goto, openProfile } from '../store';
import { createPortal } from 'react-dom';
import { Icon } from './ui';
import { Pop } from './boardkit';
import { PasswordSheet } from './Users';
import type { View } from '../store';
import { themePref, setThemePref, onTheme, type ThemePref } from '../theme';
import { langPref, setLang, type Lang } from '../i18n';

// Workspace (the Trello-like boards) is a tab of its own. Công việc unifies personal tasks and projects; Drive and the
// editor stay inside the project flow.
const WORK: View[] = ['tasks', 'projects', 'workspace'];
const REPORTS: View[] = ['reports', 'ads'];
const NAV_ICON: Record<string, string> = { customers: 'users', boards: 'boards', work: 'checklist', reports: 'file', tools: 'wand', admin: 'gear' };
const LS_WORK = 'dms.workView', LS_REPORTS = 'dms.reportsView';
/** Each group's pages, as its second switch names them. */
const SUB: Partial<Record<View, string>> = { tasks: 'Công việc của tôi', projects: 'Dự án', workspace: 'Drive', editor: 'Trình dựng', tools: 'Chuyển đổi định dạng', reports: 'Tất cả báo cáo', ads: 'Meta Ads' };
const SUB_ICON: Partial<Record<View, string>> = { tasks: 'checklist', projects: 'folder', workspace: 'folder', editor: 'film', tools: 'wand', reports: 'file', ads: 'activity' };
export function TopBar() {
  const mock = useStore((s) => s.mock);
  const view = useStore((s) => s.view);
  const user = useStore((s) => s.user)!;
  const [menu, setMenu] = useState(false);
  const [pw, setPw] = useState(false);
  const [navMenu, setNavMenu] = useState<{ tab: string; anchor: HTMLElement } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [menu]);
  useStore((s) => s.pages); useStore((s) => s.editorAvailable); // re-render when access changes
  const roleName = useStore((s) => s.roles.find((r) => r.id === s.user?.teamRole)?.name || '');
  const open = openPages();
  const work = open.filter((v) => ['tasks', 'projects'].includes(v)), reports = open.filter((v) => REPORTS.includes(v));
  const tabs: [string, string][] = [['boards', 'Workspace'], ...(open.includes('customers') ? [['customers', 'Khách hàng'] as [string, string]] : []), ['work', 'Công việc'], ...(reports.length ? [['reports', 'Báo cáo'] as [string, string]] : []), ['tools', 'Tools'], ...(open.includes('admin') ? [['admin', 'Quản trị'] as [string, string]] : [])];
  const tab = view === 'editor' ? 'tools' : WORK.includes(view) ? 'work' : REPORTS.includes(view) ? 'reports' : view;
  // A group opens on the page last used in it.
  const group = (t: string) => (t === 'work' ? { pages: work, key: LS_WORK } : t === 'reports' ? { pages: reports, key: LS_REPORTS } : t === 'tools' ? { pages: open.filter((v) => v === 'tools' || v === 'editor'), key: 'dms.toolsView' } : null);
  const pick = (t: string) => {
    setNavMenu(null);
    const g = group(t);
    if(t==='customers'){goto('customers');window.location.hash='#customers';return;}
    if (!g) return goto(t as View);
    let last: View | null = null;
    try { last = localStorage.getItem(g.key) as View | null; } catch { /* private mode */ }
    goto(last && g.pages.includes(last) ? last : g.pages[0]);
  };
  const pickSub = (v: View) => { setNavMenu(null); try { localStorage.setItem(v === 'tools' || v === 'editor' ? 'dms.toolsView' : WORK.includes(v) ? LS_WORK : LS_REPORTS, v); } catch { /* private mode */ } goto(v); };
  const center = useRef<HTMLElement>(null);
  useEffect(() => {
    center.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    setNavMenu(null);
  }, [view]);
  useEffect(() => {
    if (!navMenu) return;
    const close = () => setNavMenu(null);
    window.addEventListener('resize', close);
    const nav = center.current;
    nav?.addEventListener('scroll', close);
    return () => { window.removeEventListener('resize', close); nav?.removeEventListener('scroll', close); };
  }, [navMenu]);
  const menuPages = navMenu ? group(navMenu.tab)?.pages || [] : [];

  return (
    <header className="toolbar">
      <div className="tb-left">
        <img src="/brand/logo.png" alt="Detailers Movement" className="tb-logo" />
        {mock && <span className="tag-demo">Demo</span>}
      </div>
      <nav className="tb-center tb-nav" ref={center} aria-label="Điều hướng chính">
        {tabs.map(([key, label]) => {
          const pages = group(key)?.pages || [];
          const active = tab === key;
          return (
            <div key={key} className={'tb-nav-item' + (active ? ' active' : '')}>
              <button className="tb-nav-link" aria-label={label} aria-current={active ? 'page' : undefined} title={label} onClick={() => pick(key)}>
                <Icon name={NAV_ICON[key]} size={17} />
                <span className="tb-nav-text"><span>{label}</span>{active && pages.length > 1 && <small>{view === 'workspace' ? 'Dự án' : SUB[view]}</small>}</span>
              </button>
              {key !== 'work' && pages.length > 1 && <button className="tb-nav-expand" aria-label={`Mở menu ${label}`} title={`Mở menu ${label}`}
                aria-expanded={navMenu?.tab === key} aria-haspopup="dialog" onClick={(e) => setNavMenu(navMenu?.tab === key ? null : { tab: key, anchor: e.currentTarget })}>
                <Icon name="chevron" size={12} />
              </button>}
            </div>
          );
        })}
      </nav>
      {navMenu && menuPages.length > 1 && createPortal(
        <Pop anchor={navMenu.anchor} title={tabs.find(([key]) => key === navMenu.tab)?.[1] || ''} width={248} onClose={() => setNavMenu(null)}>
          <nav className="tb-subnav" aria-label={navMenu.tab === 'work' ? 'Mục công việc' : navMenu.tab === 'tools' ? 'Công cụ' : 'Mục báo cáo'}>
            {menuPages.map((v) => <button key={v} aria-current={view === v ? 'page' : undefined} onClick={() => pickSub(v)}>
              <Icon name={SUB_ICON[v] || 'file'} size={17} />
              <span>{SUB[v]}</span>{view === v && <Icon name="check" size={15} />}
            </button>)}
          </nav>
        </Pop>, document.body
      )}
      <div className="tb-right">
        <ThemeSwitch /><NotificationBell/>
        <div className="tb-user" ref={ref}>
          <button className="tb-user-btn" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-haspopup="menu">
            <span className="ws-avatar">{(user.name || user.email).charAt(0).toUpperCase()}</span>
            <span className="tb-user-name">{user.name}</span>
            <Icon name="chevron" size={13} />
          </button>
          {menu && (
            <div className="tb-menu" role="menu">
              <div className="tb-menu-h"><b>{user.name}</b><span>{user.email}</span><em>{user.role === 'admin' ? 'Quản trị' : roleName ? `${roleName}${user.deptRoleName ? ` · ${user.deptRoleName}` : ''}` : 'Chưa có phòng ban'}</em></div>
              <button role="menuitem" onClick={()=>{setMenu(false);openProfile(user.id);}}><Icon name="user" size={15}/>Hồ sơ của tôi</button>
              <button role="menuitem" onClick={() => { setMenu(false); setPw(true); }}><Icon name="key" size={15} />{user.hasPassword ? 'Đổi mật khẩu' : 'Đặt mật khẩu'}</button>
              <LangChoice />
              <button role="menuitem" className="danger" onClick={() => { setMenu(false); signOut(); }}><Icon name="back" size={15} />Đăng xuất</button>
            </div>
          )}
        </div>
      </div>
      <PasswordSheet open={pw} onClose={() => setPw(false)} />
    </header>
  );
}

/** Tiếng Việt / English, each written in its own language. */
export function LangChoice() {
  const lang = langPref();
  return (
    <div className="tb-lang no-i18n" role="group" aria-label="Ngôn ngữ / Language">
      {([['vi', 'Tiếng Việt'], ['en', 'English']] as [Lang, string][]).map(([l, label]) => (
        <button key={l} type="button" role="menuitemradio" aria-checked={lang === l} className={lang === l ? 'on' : ''} onClick={() => { if (lang !== l) setLang(l); }}>{label}</button>
      ))}
    </div>
  );
}

const THEMES: [ThemePref, string, string][] = [['light', 'sun', 'Sáng'], ['dark', 'moon', 'Tối'], ['system', 'monitor', 'Theo thiết bị']];
/** Light / dark / follow the device: one small button showing the current choice, opening a three-item menu. */
function ThemeSwitch() {
  const [pref, setPref] = useState(themePref);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => onTheme(() => setPref(themePref())), []);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc); };
  }, [open]);
  const cur = THEMES.find(([v]) => v === pref) || THEMES[2];
  return (
    <div className="tb-theme" ref={ref}>
      <button className="tb-theme-btn" onClick={() => setOpen(!open)} title={`Giao diện: ${cur[2]}`} aria-label={`Giao diện: ${cur[2]}`} aria-haspopup="menu" aria-expanded={open}>
        <Icon name={cur[1]} size={17} />
      </button>
      {open && (
        <div className="tb-menu tb-theme-menu" role="menu">
          {THEMES.map(([v, icon, label]) => (
            <button key={v} role="menuitemradio" aria-checked={pref === v} className={pref === v ? 'on' : ''} onClick={() => { setThemePref(v); setOpen(false); }}>
              <Icon name={icon} size={15} />{label}{pref === v && <Icon name="check" size={14} className="tb-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
