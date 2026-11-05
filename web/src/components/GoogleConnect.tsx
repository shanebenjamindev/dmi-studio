// One-time Google OAuth setup + connecting Google accounts whose Drive stores customer videos.
// The same OAuth client also enables "Đăng nhập bằng Google" on the sign-in page.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../store';
import { Sheet } from './Dialogs';
import { Icon, IconButton } from './ui';
import type { GoogleStatus } from '../types';

export const googleLogin = () => { location.href = '/api/google/login'; };

export function GoogleConnect({ open, onClose, onChanged,mode='drive' }: { mode?:'drive'|'mail'; open: boolean; onClose: () => void; onChanged: () => void }) {
  const [st, setSt] = useState<GoogleStatus | null>(null);
  const [id, setId] = useState('');
  const [secret, setSecret] = useState('');
  const [editing, setEditing] = useState(false);
  const load = () => api.googleStatus().then((s) => { setSt(s); setId(s.clientId); setEditing(!s.configured); }).catch((e) => toast(e.message, true));
  useEffect(() => { if (open) { setSecret(''); load(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    try { await api.setGoogleConfig(id, secret); toast('Đã lưu. Giờ bấm "Kết nối tài khoản Google".'); await load(); }
    catch (e: any) { toast(e.message, true); }
  };
  const remove = async (email: string) => {
    if (!confirm(`Ngắt kết nối ${email}? Khách hàng đang lưu video trên tài khoản này sẽ tạm không xem được video cho tới khi đăng nhập lại.`)) return;
    try { await api.removeGoogleAccount(email); await load(); onChanged(); } catch (e: any) { toast(e.message, true); }
  };
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast('Đã sao chép'), () => {});

  return (
    <Sheet open={open} onClose={onClose} title={mode==='mail'?'Cấu hình Google cho Gmail':'Tài khoản Google Drive'} wide footer={<>
      <button className="btn btn-gray" onClick={onClose}>Đóng</button>
      <button className="btn btn-primary" disabled={!st?.configured} onClick={()=>mode==='mail'?location.assign('/api/notifications/mail/connect'):googleLogin()}><Icon name="plus" size={15} />Kết nối tài khoản Google</button>
    </>}>
      {mode==='drive'&&!!st?.accounts.length && (
        <div className="list">
          {st.accounts.map((a) => (
            <div key={a.email} className="list-row">
              {a.picture ? <img className="gc-pic" src={a.picture} alt="" referrerPolicy="no-referrer" /> : <span className="ws-avatar">{a.email[0].toUpperCase()}</span>}
              <div className="list-main"><b>{a.name}</b><span>{a.email}</span></div>
              <div className="list-side"><IconButton icon="trash" label="Ngắt kết nối" danger size={15} onClick={() => remove(a.email)} /></div>
            </div>
          ))}
        </div>
      )}
      {mode==='drive'&&st && !st.accounts.length && st.configured && <p className="sheet-lead">Chưa có tài khoản nào. Bấm “Kết nối tài khoản Google”, chọn tài khoản và cho phép truy cập Google Drive.</p>}

      {st && (editing ? (
        <div className="gc-setup">
          <p className="sheet-lead">Google yêu cầu mỗi ứng dụng có một <b>OAuth Client ID</b> riêng. Chỉ cần làm một lần, miễn phí:</p>
          <ol className="gc-steps">
            <li>Mở <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">Google Cloud Console</a> và tạo một project (vd. “DM Workspace”).</li>
            <li>Bật <a href={mode==='mail'?'https://console.cloud.google.com/apis/library/gmail.googleapis.com':'https://console.cloud.google.com/apis/library/drive.googleapis.com'} target="_blank" rel="noreferrer">{mode==='mail'?'Gmail API':'Google Drive API'}</a> cho project đó.</li>
            <li>Vào <a href="https://console.cloud.google.com/auth/branding" target="_blank" rel="noreferrer">OAuth consent screen</a>: chọn <b>Internal</b> nếu chỉ dùng tài khoản công ty (Google Workspace), hoặc <b>External</b> rồi thêm email của bạn vào mục <b>Test users</b>.</li>
            <li>Vào <a href="https://console.cloud.google.com/auth/clients/create" target="_blank" rel="noreferrer">Clients → Create client</a>, chọn loại <b>Web application</b>, thêm vào <b>Authorized redirect URIs</b>:
              <span className="gc-uri"><code>{st.redirectUri}</code><button className="link" onClick={() => copy(st.redirectUri)}><Icon name="copy" size={13} />Sao chép</button></span>
            </li>
            <li>Dán <b>Client ID</b> và <b>Client secret</b> vào đây:</li>
          </ol>
          <div className="gc-fields">
            <input value={id} onChange={(e) => setId(e.target.value)} placeholder="Client ID (…apps.googleusercontent.com)" autoComplete="off" />
            <input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Client secret (GOCSPX-…)" type="password" autoComplete="off" />
            <button className="btn btn-primary btn-sm" disabled={!id.trim() || !secret.trim()} onClick={save}>Lưu</button>
          </div>
          <p className="note">Khi đăng nhập, Google có thể cảnh báo “ứng dụng chưa được xác minh” vì đây là app riêng của bạn. Bấm <b>Advanced → Go to DM Workspace</b> để tiếp tục. Thông tin đăng nhập được lưu trên máy chủ DM Workspace của bạn, giống các API key khác. Sau khi lưu, trang đăng nhập cũng có nút “Đăng nhập bằng Google” cho người dùng bạn đã thêm.</p>
        </div>
      ) : (
        <p className="note">OAuth Client ID: {st.clientId.slice(0, 18)}… · <button className="link" onClick={() => setEditing(true)}>Đổi</button></p>
      ))}
    </Sheet>
  );
}
