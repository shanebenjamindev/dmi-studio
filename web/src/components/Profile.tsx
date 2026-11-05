import {BrandLoading} from './BrandLoading';
import {NotificationSettings} from './NotificationSettings';
import {LangChoice} from './TopBar';
import {useEffect,useState} from 'react';
import {api} from '../api';
import {goto,setState,useStore} from '../store';
import {Avatar} from './boardkit';
import {Icon} from './ui';
import {PasswordSheet} from './Users';
import type {TaskItem,UserProfile} from '../types';

const profileId=(fallback:string)=>location.hash.match(/^#profile\/([^/?]+)/)?.[1]||fallback;
const date=(n:number)=>new Date(n).toLocaleDateString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'});
export function ProfilePage(){
 const me=useStore(s=>s.user)!;
 const[id,setId]=useState(()=>profileId(me.id));
 const[p,setP]=useState<UserProfile|null>(null),[tasks,setTasks]=useState<TaskItem[]>([]);
 const[error,setError]=useState(''),[taskError,setTaskError]=useState(''),[loading,setLoading]=useState(true);
 const[name,setName]=useState(''),[editing,setEditing]=useState(false),[saving,setSaving]=useState(false),[saveError,setSaveError]=useState(''),[pw,setPw]=useState(false);
 const[taskLoading,setTaskLoading]=useState(true);
 const[filter,setFilter]=useState('all'),[retry,setRetry]=useState(0);
 useEffect(()=>{const change=()=>setId(profileId(me.id));window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[me.id]);
 useEffect(()=>{
   let current=true;setLoading(true);setError('');setTaskError('');setEditing(false);setSaveError('');setFilter('all');setP(null);setTasks([]);setPw(false);setTaskLoading(true);
   api.profile(id).then(profile=>{if(current){setP(profile);setName(profile.name);}}).catch(e=>{if(current)setError(e.message);}).finally(()=>{if(current)setLoading(false);});
   api.tasks({scope:'all',employee:id}).then(result=>{if(current)setTasks(result.tasks.filter(t=>!t.stub&&(id===me.id||!!t.boardLink)));}).catch(e=>{if(current)setTaskError(e.message);}).finally(()=>{if(current)setTaskLoading(false);});
   return()=>{current=false;};
 },[id,retry]);
 const save=async(e:React.FormEvent)=>{
   e.preventDefault();if(saving||!name.trim()||!p?.canEdit)return;
   setSaving(true);setSaveError('');try{const user=await api.updateProfile(name.trim());setState({user});setP(old=>old?{...old,name:user.name}:old);setEditing(false);}catch(e:any){setSaveError(e.message);}finally{setSaving(false);}
 };
 const done=tasks.filter(t=>['done','done_late'].includes(t.state)).length;
 const open=tasks.filter(t=>!['done','done_late','cancelled'].includes(t.state)).length;
 const late=tasks.filter(t=>t.state==='overdue').length;
 const visible=tasks.filter(t=>filter==='all'||(filter==='done'?['done','done_late'].includes(t.state):filter==='overdue'?t.state==='overdue':!['done','done_late','cancelled'].includes(t.state)));
 if(loading)return <main className="profile-page"><BrandLoading label="Đang tải hồ sơ…"/></main>;
 if(error||!p)return <main className="profile-page"><p role="alert">{error||'Không tìm thấy hồ sơ.'}</p><button className="btn btn-gray" onClick={()=>setRetry(n=>n+1)}>Thử lại</button></main>;
 return <main className="profile-page">
   <header className="profile-cover"><span>HỒ SƠ THÀNH VIÊN</span></header>
   <section className="profile-identity"><Avatar m={p} size={88}/><div><h1>{p.name}</h1>{p.email&&<p><a href={`mailto:${p.email}`}>{p.email}</a></p>}<div className="profile-tags">{p.canEdit&&<span>{p.role==='admin'?'Quản trị':p.level==='observer'?'Chỉ xem':'Nhân viên'}</span>}{p.department&&<span>{p.department.name}</span>}</div></div>{p.canEdit&&<div className="profile-buttons"><button className="btn btn-primary" onClick={()=>{setName(p.name);setSaveError('');setEditing(true);}}>Sửa hồ sơ</button><button className="btn btn-gray" onClick={()=>setPw(true)}>Đổi mật khẩu</button></div>}</section>
   <div className="profile-layout"><aside className="profile-info"><h2>Thông tin cá nhân</h2>{editing?<form onSubmit={save}><label>Họ và tên<input className="bk-in" autoFocus required maxLength={120} value={name} disabled={saving} onChange={e=>setName(e.target.value)}/></label><p className="note">Email và phòng ban do quản trị viên quản lý.</p>{saveError&&<p className="note err" role="alert">{saveError}</p>}<div className="profile-buttons"><button className="btn btn-primary btn-sm" disabled={saving||!name.trim()}>{saving?'Đang lưu…':'Lưu'}</button><button type="button" className="btn btn-gray btn-sm" disabled={saving} onClick={()=>setEditing(false)}>Huỷ</button></div></form>:<dl>{p.email&&<><dt>Email</dt><dd><a href={`mailto:${p.email}`}>{p.email}</a></dd></>}<dt>Phòng ban</dt><dd>{p.department?.name||'Chưa có phòng ban'}</dd><dt>Vai trò trong phòng</dt><dd>{p.position||'—'}</dd>{p.createdAt&&<><dt>Tham gia từ</dt><dd>{date(p.createdAt)}</dd></>}</dl>}</aside>
   <section className="profile-work"><div className="staff-stats"><div><span>Tổng công việc</span><b>{taskError||taskLoading?'—':tasks.length}</b></div><div><span>Đang mở</span><b>{taskError||taskLoading?'—':open}</b></div><div><span>Hoàn thành</span><b>{taskError||taskLoading?'—':done}</b></div><div><span>Quá hạn</span><b>{taskError||taskLoading?'—':late}</b></div></div><header className="profile-work-heading"><h2>{p.canEdit?'Công việc được giao':'Công việc bạn có quyền xem'}</h2><select aria-label="Lọc công việc hồ sơ" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Tất cả</option><option value="open">Đang mở</option><option value="done">Hoàn thành</option><option value="overdue">Quá hạn</option></select></header>{taskLoading?<BrandLoading label="Đang tải công việc…"/>:taskError?<p role="alert">Không tải được công việc: {taskError} <button className="btn btn-gray btn-sm" onClick={()=>setRetry(n=>n+1)}>Thử lại</button></p>:visible.length?<div className="profile-tasks">{visible.map(t=><button key={t.id} onClick={()=>{history.replaceState(null,'',`#tasks/${t.id}`);goto('tasks');}}><Icon name="checklist" size={18}/><div><b>{t.title}</b><span>{t.project?.name||'Chưa có dự án'}{t.dueAt?` · Hạn ${date(t.dueAt)}`:''}</span></div><span className={'profile-task-status '+t.state}>{t.status}</span><Icon name="right" size={15}/></button>)}</div>:<p className="profile-empty">{tasks.length?'Không có công việc khớp bộ lọc.':'Chưa có công việc được giao.'}</p>}</section></div>
   {p.canEdit&&<section className="notification-settings profile-lang"><header><h2>Ngôn ngữ / Language</h2></header><p className="note">Giao diện hiển thị bằng ngôn ngữ đã chọn trên trình duyệt này.</p><LangChoice/></section>}
   {p.canEdit&&<NotificationSettings/>}
   <PasswordSheet open={pw} onClose={()=>setPw(false)}/>
 </main>;
}
