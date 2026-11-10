// Khoá tạm website (server/site-lock.ts): the page everyone but Super Admins sees while it is on, which goes away by
// itself once the site opens again; the pill that reminds Super Admins and opens it; and the switch in Cấu hình chung.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { setState, signOut, toast, useStore } from '../store';
import { Icon } from './ui';

export function SiteLocked({ message }: { message: string }) {
  useEffect(() => {
    const t = setInterval(() => { api.me().then((m) => { if (!m.siteLock) location.reload(); }, () => {}); }, 30000);
    return () => clearInterval(t);
  }, []);
  return (
    <main className="login">
      <div className="login-card site-locked" role="alert">
        <img src="/brand/logo.png" alt="Detailers Movement" className="login-logo" />
        <span className="site-locked-icon"><Icon name="lock" size={26} /></span>
        <h1>Website đang tạm khoá</h1>
        <p>{message}</p>
        <button className="link" type="button" onClick={() => void signOut()}>Đăng xuất</button>
      </div>
    </main>
  );
}

async function save(on: boolean, message?: string) {
  const r = await api.setSiteLock({ on, ...(message !== undefined ? { message } : {}) });
  setState({ siteLock: r.on ? r.message : null });
  toast(r.on ? 'Đã khoá tạm website' : 'Đã mở khoá website');
}

export function SiteLockPill() {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    if (busy || !confirm('Mở khoá website cho mọi người?')) return;
    setBusy(true);
    try { await save(false); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  return <div className="site-lock-pill" role="status"><Icon name="lock" size={13} /><span>Đang khoá</span><button type="button" disabled={busy} onClick={() => void open()}>Mở khoá</button></div>;
}

export function SiteLockSettings() {
  const locked = useStore((s) => s.siteLock);
  const [text, setText] = useState(locked || ''), [busy, setBusy] = useState(false);
  useEffect(() => { if (locked) setText(locked); }, [locked]);
  const run = async (on: boolean) => {
    if (busy || (on && !confirm('Khoá website? Mọi người trừ Super Admin sẽ không vào được cho tới khi mở khoá.'))) return;
    setBusy(true);
    try { await save(on, on ? text.trim() : undefined); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  return (
    <section className="ax-card ax-form site-lock-card">
      <h3><Icon name="lock" size={15} />Khoá tạm website</h3>
      <p className="note">{locked !== null ? 'Website đang khoá: chỉ Super Admin vào được.' : 'Website đang mở cho mọi người.'}</p>
      <label className="qc-field"><span>Thông báo hiện cho mọi người</span><textarea className="bk-in" rows={2} maxLength={300} value={text} placeholder="Website đang tạm khoá để bảo trì. Vui lòng quay lại sau." onChange={(e) => setText(e.target.value)} /></label>
      <div><button type="button" className={'btn btn-sm ' + (locked !== null ? 'btn-primary' : 'btn-gray')} disabled={busy} onClick={() => void run(locked === null)}>{locked !== null ? 'Mở khoá website' : 'Khoá website'}</button></div>
    </section>
  );
}
