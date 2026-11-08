// The editor's tab on the cloud site. The editor runs on the studio's Mac (Claude CLI, ffmpeg and its disk); once that
// Mac is reachable from the internet, an admin enters its address here and everyone with the editor page gets a button
// to it, with whether the Mac is answering right now.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore, goto, toast } from '../store';
import { Icon } from './ui';
import type { EditorLink } from '../types';

const STATUS: Record<EditorLink['status'], [string, string]> = {
  ready: ['ok', 'Máy Mac đang bật, Trình dựng mở được'],
  'no-editor': ['warn', 'Máy Mac trả lời nhưng Trình dựng chưa sẵn sàng (thiếu Claude CLI hoặc ffmpeg)'],
  blocked: ['warn', 'Máy Mac từ chối địa chỉ này: thêm tên miền vào ALLOWED_HOSTS trong .env của máy Mac rồi chạy lại DMI Workspace'],
  offline: ['err', 'Không kết nối được: máy Mac đang tắt, DMI Workspace chưa chạy, hoặc địa chỉ đã đổi'],
  none: ['', ''],
};

export function EditorOnMac() {
  const admin = useStore((s) => s.user?.role === 'admin');
  const drive = useStore((s) => s.pages.includes('workspace'));
  const [link, setLink] = useState<EditorLink | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api.editorLink().then((l) => { setLink(l); setDraft(l.url); }, () => setLink({ url: '', status: 'none' }));
  useEffect(() => { load(); }, []);
  const save = async (url: string) => {
    setBusy(true);
    try {
      const l = await api.setEditorLink(url);
      setLink(l); setDraft(l.url);
      toast(l.url ? 'Đã lưu địa chỉ Trình dựng' : 'Đã xoá địa chỉ Trình dựng');
    } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const url = link?.url || '';
  const [tone, text] = STATUS[link?.status || 'none'];
  return (
    <main className="tpl-page away">
      <div className="away-box">
        <span className="away-ico"><Icon name="film" size={26} /></span>
        <h1 className="tpl-title">Trình dựng chạy trên máy Mac</h1>
        <p className="tpl-lead">
          Trình dựng dùng Claude CLI để viết cut, ffmpeg để làm proxy và xuất CapCut, cùng ổ đĩa của máy Mac ở studio.
          {url ? ' Mở nó qua địa chỉ của máy Mac bên dưới.' : ' Khi máy Mac có địa chỉ trên internet, nhập vào đây để mở Trình dựng từ bản web.'}
        </p>
        {link === null ? <p className="note">Đang kiểm tra…</p> : url && (
          <>
            <p className={'away-status ' + tone}><span className="away-dot" />{text}<button className="btn-plain away-recheck" onClick={() => { setLink(null); load(); }}>Kiểm tra lại</button></p>
            <div className="btn-row away-actions">
              <a className="btn btn-primary" href={`${url}/#editor`} target="_blank" rel="noreferrer"><Icon name="share" size={15} />Mở Trình dựng</a>
              {drive && <button className="btn btn-gray" onClick={() => goto('workspace')}><Icon name="folder" size={15} />Sang Drive</button>}
            </div>
          </>
        )}
        {admin ? (
          <form className="away-form" onSubmit={(e) => { e.preventDefault(); save(draft); }}>
            <label htmlFor="editor-url">Địa chỉ Trình dựng trên Mac</label>
            <div className="field-row">
              <input id="editor-url" className="field" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="https://studio.example.com" inputMode="url" autoComplete="off" spellCheck={false} />
              <button className="btn btn-primary" disabled={busy || draft.trim() === url}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
              {url && <button type="button" className="btn btn-gray" disabled={busy} onClick={() => save('')}>Xoá</button>}
            </div>
            <span className="note">Chỉ quản trị viên thấy ô này. Địa chỉ phải mở được từ internet (máy Mac đưa ra qua tunnel hoặc tên miền riêng).</span>
          </form>
        ) : link && !url && <p className="note">Quản trị viên chưa nhập địa chỉ của máy Mac.</p>}
        <ul className="away-notes">
          <li>Bản trên Mac có tài khoản và dự án riêng: đăng nhập bằng tài khoản của bản đó.</li>
          <li>Đang ở chính máy Mac? Mở <a href="http://localhost:5173/#editor" target="_blank" rel="noreferrer" className="mono">http://localhost:5173</a>.</li>
          <li>Drive, Workspace và Tools vẫn dùng bình thường trên web.</li>
        </ul>
      </div>
    </main>
  );
}
