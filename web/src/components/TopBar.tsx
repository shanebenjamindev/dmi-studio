import { useEffect, useRef, useState } from 'react';
import { useStore, setState, signOut } from '../store';
import { Icon, Segmented } from './ui';
import { PasswordSheet } from './Users';
import type { View } from '../store';

// Trình dựng, Template and Phân tích are hidden for now; Khách hàng and (for admins) Quản trị remain.
export function TopBar() {
  const mock = useStore((s) => s.mock);
  const view = useStore((s) => s.view);
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
  const pages: [View, string][] = [['workspace', 'Khách hàng'], ...(user.role === 'admin' ? [['admin', 'Quản trị'] as [View, string]] : [])];

  return (
    <header className="toolbar">
      <div className="tb-left">
        <img src="/brand/logo.png" alt="Detailers Movement" className="tb-logo" />
        {mock && <span className="tag-demo">Demo</span>}
      </div>
      <div className="tb-center">
        {pages.length > 1 && <Segmented<View> small ariaLabel="Trang" value={view} onChange={(v) => setState({ view: v })} options={pages} />}
      </div>
      <div className="tb-right">
        <div className="tb-user" ref={ref}>
          <button className="tb-user-btn" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-haspopup="menu">
            <span className="ws-avatar">{(user.name || user.email).charAt(0).toUpperCase()}</span>
            <span className="tb-user-name">{user.name}</span>
            <Icon name="chevron" size={13} />
          </button>
          {menu && (
            <div className="tb-menu" role="menu">
              <div className="tb-menu-h"><b>{user.name}</b><span>{user.email}</span><em>{user.role === 'admin' ? 'Quản trị' : 'Nhân viên'}</em></div>
              <button role="menuitem" onClick={() => { setMenu(false); setPw(true); }}><Icon name="key" size={15} />{user.hasPassword ? 'Đổi mật khẩu' : 'Đặt mật khẩu'}</button>
              <button role="menuitem" className="danger" onClick={() => { setMenu(false); signOut(); }}><Icon name="back" size={15} />Đăng xuất</button>
            </div>
          )}
        </div>
      </div>
      <PasswordSheet open={pw} onClose={() => setPw(false)} />
    </header>
  );
}
