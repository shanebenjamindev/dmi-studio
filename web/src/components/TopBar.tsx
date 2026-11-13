import {NotificationBell} from './NotificationBell';
import { QuickNotesButton } from './QuickNotes';
import { MessengerTopButton } from './Messenger';
import { Reminders } from './Reminders';
import { SupportButton } from './SupportDialog';
import { useEffect, useRef, useState } from 'react';
import { useStore, signOut, openPages, goto, openProfile, openLink, HASH } from '../store';
import { Icon } from './ui';
import { Avatar } from './boardkit';
import { openWhatsNew } from './WhatsNew';
import { PasswordSheet } from './PasswordSheet';
import type { View } from '../store';
import { themePref, setThemePref, onTheme, type ThemePref } from '../theme';
import { langPref, setLang, type Lang } from '../i18n';

// The app's frame, Base-like. Along the top (AppHeader): the logo, the search in the middle, and quick notes,
// notifications, the theme and the account at the right. Down the left (TopBar): one item per section with its icon
// and name; the section's own pages (Công việc, Báo cáo, Tools) open in a column beside it (WorkArea). On phones the
// sections are a bar along the bottom.
const WORK: View[] = ['tasks', 'projects', 'workspace'];
const REPORTS: View[] = ['reports', 'ads'];
const TOOLS: View[] = ['tools', 'editor'];
const NAV_ICON: Record<string, string> = { boards: 'boards', customers: 'users', work: 'checklist', reports: 'file', tools: 'wand', admin: 'gear' };
const KEY: Record<string, string> = { work: 'dms.workView', reports: 'dms.reportsView', tools: 'dms.toolsView' };
/** The section a page belongs to. */
export const sectionOf = (v: View) => (WORK.includes(v) ? 'work' : REPORTS.includes(v) ? 'reports' : TOOLS.includes(v) ? 'tools' : v);
/** A section's pages this account may open. */
export const sectionPages = (section: string, open = openPages()) => open.filter((v) => (section === 'work' ? ['tasks', 'projects'] : section === 'reports' ? REPORTS : section === 'tools' ? TOOLS : [section]).includes(v));
/** Opens a page of a section and remembers it as the one the section opens on next time. */
export function openSub(v: View) {
  const key = KEY[sectionOf(v)];
  if (key) try { localStorage.setItem(key, v); } catch { /* private mode */ }
  const h = HASH[v];
  if (h) openLink(h);
  else goto(v);
}
/** The bar along the top: the logo, the search (opens Tìm kiếm toàn bộ), and the account's own tools at the right. */
export function AppHeader() {
  const mock = useStore((s) => s.mock);
  const user = useStore((s) => s.user)!;
  const [menu, setMenu] = useState(false);
  const [pw, setPw] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [menu]);
  const roleName = useStore((s) => s.roles.find((r) => r.id === s.user?.teamRole)?.name || '');
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <header className="app-head">
      <div className="app-head-left"><img src="/brand/logo.png" alt="Detailers Movement" className="tb-logo" />{mock && <span className="tag-demo">Demo</span>}</div>
      <button className="app-search" onClick={() => window.dispatchEvent(new Event('dms:search'))} aria-label="Tìm kiếm">
        <Icon name="search" size={16} /><span>Tìm mọi thứ: khách, việc, dịch vụ…</span><kbd>{mac ? '⌘' : 'Ctrl'} K</kbd>
      </button>
      <div className="app-head-right">
        <MessengerTopButton /><QuickNotesButton /><NotificationBell /><ThemeSwitch />
        <div className="tb-user" ref={ref}>
          <button className="tb-user-btn" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-haspopup="menu" title={user.name} aria-label={`Tài khoản ${user.name}`}>
            <Avatar m={{ id: user.id, userId: user.id, name: user.name || user.email, avatarAt: user.avatarAt }} size={28} /><span className="tb-user-name">{user.name}</span><Icon name="chevron" size={13} />
          </button>
          {menu && (
            <div className="tb-menu" role="menu">
              <div className="tb-menu-h"><b>{user.name}</b><span>{user.email}</span><em>{user.role === 'admin' ? 'Quản trị' : roleName ? `${roleName}${user.deptRoleName ? ` · ${user.deptRoleName}` : ''}` : 'Chưa có phòng ban'}</em></div>
              <button role="menuitem" onClick={()=>{setMenu(false);openProfile(user.id);}}><Icon name="user" size={15}/>Hồ sơ của tôi</button>
              <button role="menuitem" onClick={() => { setMenu(false); setPw(true); }}><Icon name="key" size={15} />{user.hasPassword ? 'Đổi mật khẩu' : 'Đặt mật khẩu'}</button>
              <button role="menuitem" onClick={() => { setMenu(false); openWhatsNew(); }}><Icon name="sparkle" size={15} />Có gì mới</button>
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

/** Where each section's link goes when opened in a new tab (a click opens the page last used in it). */
const SECTION_HASH: Record<string, string> = { boards: '#boards', customers: '#customers', work: '#tasks', reports: '#reports', tools: '#tools', admin: '#admin' };
/** The sections, down the left side. */
export function TopBar() {
  const view = useStore((s) => s.view);
  useStore((s) => s.pages); useStore((s) => s.editorAvailable); useStore((s) => s.admin); // re-render when access changes
  const open = openPages();
  const items: [string, string][] = [['boards', 'Workspace'], ...(open.includes('customers') ? [['customers', 'Khách hàng'] as [string, string]] : []), ['work', 'Công việc'],
    ...(sectionPages('reports', open).length ? [['reports', 'Báo cáo'] as [string, string]] : []), ['tools', 'Tools'], ...(open.includes('admin') ? [['admin', 'Quản trị'] as [string, string]] : [])];
  const current = sectionOf(view);
  // A section opens on the page last used in it; choosing the open section again folds or unfolds its column.
  const pick = (t: string) => {
    if (t === 'work') { openSub('tasks'); return; }
    if (t === 'reports') { openSub('reports'); return; }
    if (t === 'tools') { openSub('tools'); return; }
    if (t === 'customers') { goto('customers'); openLink('#customers'); return; }
    if (t === 'boards') { goto('boards'); openLink('#boards'); return; }
    if (t === 'admin') { goto('admin'); openLink('#admin'); return; }
    const pages = sectionPages(t, open);
    let last: View | null = null;
    try { last = localStorage.getItem(KEY[t]) as View | null; } catch { /* private mode */ }
    openSub(last && pages.includes(last) ? last : pages[0]);
  };
  // On a phone the bottom bar keeps the first three sections and Nhắc việc; the rest open from "Thêm". Elsewhere they all
  // sit down the rail as before (the "Thêm" box takes no room of its own there).
  const [more, setMore] = useState(false), moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!more) return;
    const off = (e: MouseEvent) => { if (!moreRef.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest('.rail-more-btn')) setMore(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [more]);
  const primary = items.slice(0, 3), rest = items.slice(3);
  // Links, so a section also opens in a new tab (Ctrl/Cmd+click, middle click); a plain click stays in the app.
  const link = ([key, label]: [string, string]) => (
    <a key={key} href={SECTION_HASH[key]} className="rail-item" aria-current={current === key ? 'page' : undefined} title={label}
      onClick={(e) => { if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); setMore(false); pick(key); }}>
      <Icon name={NAV_ICON[key]} size={20} /><span>{label}</span>
    </a>
  );
  return (
    <nav className="rail" aria-label="Điều hướng chính">
      {primary.map(link)}
      <div className={'rail-more' + (more ? ' open' : '')} ref={moreRef} onClickCapture={(e) => { if ((e.target as HTMLElement).closest('.sp-button')) setMore(false); }}>
        {rest.map(link)}
        <span className="rail-fill" />
        <SupportButton />
      </div>
      <Reminders />
      <button type="button" className={'rail-item rail-more-btn' + (rest.some(([k]) => k === current) ? ' here' : '')} aria-expanded={more} onClick={() => setMore(!more)}>
        {/* "Thêm" here is "More" (elsewhere it is "Add", which is what the dictionary says). */}
        <Icon name="more" size={20} /><span>{langPref() === 'en' ? 'More' : 'Thêm'}</span>
      </button>
    </nav>
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
