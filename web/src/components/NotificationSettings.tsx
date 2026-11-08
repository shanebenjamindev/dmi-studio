import {useEffect,useState} from 'react';
import {api} from '../api';
import {useStore,toast} from '../store';
import {BrandLoading} from './BrandLoading';
import {Icon} from './ui';
import {GoogleConnect} from './GoogleConnect';
import type {NotificationStatus} from '../types';
const stateLabel:Record<string,string>={pending:'Chờ gửi',sent:'Đã gửi',failed:'Gửi lỗi',cancelled:'Đã huỷ'};
/** Someone's own notification email (their profile), or, for admins in Quản trị (`site`), the account the website sends from. */
export function NotificationSettings({site=false}:{site?:boolean}={}){
 const user=useStore(s=>s.user)!;
 const[email,setEmail]=useState(''),[code,setCode]=useState('');
 const[configuring,setConfiguring]=useState(false);
 const[data,setData]=useState<NotificationStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const load=()=>api.notifications().then(d=>{setData(d);setError('');}).catch(e=>setError(e.message));
 useEffect(()=>{void load();},[]);
 const act=async(fn:()=>Promise<unknown>)=>{if(busy)return;setBusy(true);try{await fn();await load();}catch(e:any){toast(e.message,true);}finally{setBusy(false);}};
 const requestCode=async(to:string)=>{const r=await api.requestNotificationEmail(to);toast(r.sent?'Đã gửi mã xác minh tới email cá nhân của bạn.':'Đã lưu email. Khi quản trị viên kết nối Gmail, hãy quay lại đây để gửi mã xác minh.');};
 return <section className="notification-settings"><header><Icon name="mail" size={18}/><h2>{site?'Tài khoản gửi email thông báo':'Thông báo qua email'}</h2><button className="btn btn-gray btn-sm" disabled={busy} onClick={()=>void load()}>Làm mới</button></header>{error&&<p className="note err" role="alert">{error}</p>}{!data?!error&&<BrandLoading compact/>:<>{!site&&<>
  <p>Email đăng nhập: <b>{data.loginEmail}</b>. Địa chỉ này không được dùng để gửi thông báo.</p>
  <form className="notification-email-form" onSubmit={e=>{e.preventDefault();void act(()=>requestCode(email.trim()));}}><label>Email cá nhân nhận thông báo<input className="bk-in" type="email" required autoComplete="email" value={email} placeholder={data.email||'Nhập email đang sử dụng…'} onChange={e=>setEmail(e.target.value)} disabled={busy}/></label><button className="btn btn-primary btn-sm" disabled={busy||!email.trim()}>{data.mailReady?'Gửi mã xác minh':'Lưu email'}</button></form>
  {data.pendingEmail&&!data.codeSent&&<p>Đã lưu <b>{data.pendingEmail}</b>, chưa xác minh. {data.mailReady?<button className="bk-link" disabled={busy} onClick={()=>void act(()=>requestCode(data.pendingEmail!))}>Gửi mã xác minh</button>:'Khi quản trị viên kết nối Gmail, hãy quay lại đây để gửi mã xác minh.'}</p>}
  {data.pendingEmail&&data.codeSent&&<form className="notification-email-form" onSubmit={e=>{e.preventDefault();void act(async()=>{await api.verifyNotificationEmail(code);setCode('');setEmail('');toast('Đã xác minh email cá nhân và bật nhận thông báo.');});}}><label>Mã xác minh gửi tới {data.pendingEmail}<input className="bk-in" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6} value={code} onChange={e=>setCode(e.target.value)} disabled={busy}/></label><button className="btn btn-primary btn-sm" disabled={busy||code.length!==6}>Xác minh</button></form>}
  {data.verified&&data.email&&<p>Đã liên kết: <b>{data.email}</b> <button className="bk-link" disabled={busy} onClick={()=>void act(()=>api.removeNotificationEmail())}>Gỡ email</button></p>}
  <label className="notification-toggle"><input type="checkbox" checked={data.enabled} disabled={busy} onChange={e=>void act(()=>api.setNotifications(e.target.checked))}/><span>Nhận thông báo qua email (công việc, thẻ, board, dự án, khách hàng)</span></label>
  {data.enabled&&!data.verified&&<p className="note">Thư sẽ bắt đầu được gửi khi email cá nhân đã xác minh.</p>}
  <p className="note">{data.mailReady?'Thư được gửi tự động, thường trong vòng một phút; thông báo trên website xuất hiện ngay.':'Chưa kết nối tài khoản gửi. Quản trị viên cần kết nối Gmail để hệ thống gửi thông báo.'}</p>
  {data.enabled&&data.verified&&data.mailReady&&<button className="btn btn-gray btn-sm" disabled={busy} onClick={()=>void act(async()=>{await api.testNotification();toast('Đã gửi email kiểm tra tới email cá nhân đã xác minh.');})}>Gửi mail kiểm tra cho tôi</button>}
  </>}{site&&user.role==='admin'&&<div className="notification-sender">{data.sender&&!data.mailIssue
   ?<div className="notification-setup-actions"><span>Đang gửi từ <b>{data.sender}</b></span><a className="btn btn-gray btn-sm" href="/api/notifications/mail/connect">Đổi Gmail</a><button className="btn btn-gray btn-sm" disabled={busy} onClick={()=>void act(()=>api.disconnectNotificationMail())}>Ngắt kết nối</button></div>
   :<>{data.mailIssue&&<p className="note err" role="alert">{data.mailIssue.message}</p>}<p className="note">Cho phép DMI Workspace gửi thông báo bằng tài khoản Google bạn chọn. Quyền gửi Gmail được xác nhận trên trang Google.</p><div className="notification-setup-actions"><a className="btn btn-gray btn-sm" href={data.mailIssue?.helpUrl||data.gmailSetupUrl} target="_blank" rel="noopener noreferrer">Bật Gmail API</a><button className="btn btn-gray btn-sm" onClick={()=>setConfiguring(true)}>Cấu hình Google</button>{data.googleConfigured&&<a className="btn btn-primary btn-sm" href="/api/notifications/mail/connect">{data.sender?'Kết nối lại / đổi Gmail':'Kết nối Gmail / Google Workspace'}</a>}{data.sender&&<button className="btn btn-gray btn-sm" disabled={busy} onClick={()=>void act(()=>api.disconnectNotificationMail())}>Ngắt kết nối</button>}</div>{!data.googleConfigured&&<p className="note">Chưa có cấu hình Google cho ứng dụng. Bấm “Cấu hình Google” để thiết lập.</p>}</>}</div>}
  {!site&&!!data.recent.length&&<div className="notification-history"><h3>Email gần đây của bạn</h3>{data.recent.map(item=><div key={item.id}><b>{item.title}</b><span>{stateLabel[item.state]||item.state}</span>{item.error&&<small>{item.error}</small>}</div>)}</div>}
 </>}<GoogleConnect mode="mail" open={configuring} onClose={()=>{setConfiguring(false);void load();}} onChanged={()=>void load()}/></section>;
}
