import {BrandLoading} from './BrandLoading';
import {NotificationSettings} from './NotificationSettings';
import {LangChoice} from './TopBar';
import {useEffect,useRef,useState} from 'react';
import {api} from '../api';
import {goto,setState,toast,useStore} from '../store';
import {Avatar,fileToAvatarDataUrl,hasUserAvatar,notifyAvatarChanged} from './boardkit';
import {Icon} from './ui';
import {openConversation} from './Messenger';
import {PasswordSheet} from './PasswordSheet';
import {ClaudeConnect} from './ClaudeConnect';
import {ProfileTasks} from './ProfileTasks';
import type {TaskItem,TeamRole,UserProfile} from '../types';
import {stepCode} from './taskkit';

const profileId=(fallback:string)=>location.hash.match(/^#profile\/([^/?]+)/)?.[1]||fallback;
const date=(n:number)=>new Date(n).toLocaleDateString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'});
export function ProfilePage(){
 const me=useStore(s=>s.user)!;
 const isAdmin=me.role==='admin';
 const[id,setId]=useState(()=>profileId(me.id));
 const[p,setP]=useState<UserProfile|null>(null),[tasks,setTasks]=useState<TaskItem[]>([]);
 const[roles,setRoles]=useState<TeamRole[]>([]);
 const[error,setError]=useState(''),[taskError,setTaskError]=useState(''),[loading,setLoading]=useState(true);
 const[name,setName]=useState(''),[phone,setPhone]=useState(''),[email,setEmail]=useState(''),[teamRole,setTeamRole]=useState(''),[deptRole,setDeptRole]=useState('');
 const[editing,setEditing]=useState(false),[saving,setSaving]=useState(false),[saveError,setSaveError]=useState(''),[pw,setPw]=useState(false);
 const[avatarBusy,setAvatarBusy]=useState(false);
 const[taskLoading,setTaskLoading]=useState(true);
 const[retry,setRetry]=useState(0);
 const fileRef=useRef<HTMLInputElement>(null);
 useEffect(()=>{const change=()=>setId(profileId(me.id));window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[me.id]);
 useEffect(()=>{
   let current=true;setLoading(true);setError('');setTaskError('');setEditing(false);setSaveError('');setP(null);setTasks([]);setPw(false);setTaskLoading(true);
   api.profile(id).then(profile=>{
     if(!current)return;
     setP(profile);setName(profile.name);setPhone(profile.phone||'');setEmail(profile.email||'');
     setTeamRole(profile.department?.id||'');
   }).catch(e=>{if(current)setError(e.message);}).finally(()=>{if(current)setLoading(false);});
   if(isAdmin){
     api.roles().then(r=>{
       if(!current)return;
       setRoles(r);
     }).catch(()=>{});
   }
   api.tasks({scope:'all',employee:id}).then(result=>{if(current)setTasks(result.tasks.filter(t=>!t.stub&&(id===me.id||isAdmin||!!t.boardLink)));}).catch(e=>{if(current)setTaskError(e.message);}).finally(()=>{if(current)setTaskLoading(false);});
   return()=>{current=false;};
 },[id,retry,isAdmin,me.id]);
 useEffect(()=>{
   if(!p||!roles.length)return;
   const dept=roles.find(r=>r.id===(p.department?.id||''));
   const pos=dept?.positions?.find(x=>x.name===p.position);
   setDeptRole(pos?.id||'');
 },[p,roles]);

 const canEditProfile=!!(p?.canEdit||isAdmin);
 const startEdit=()=>{
   if(!p)return;
   setName(p.name);setPhone(p.phone||'');setEmail(p.email||'');
   const dId=p.department?.id||'';
   setTeamRole(dId);
   const pos=roles.find(r=>r.id===dId)?.positions?.find(x=>x.name===p.position);
   setDeptRole(pos?.id||'');
   setSaveError('');setEditing(true);
 };
 const save=async(e:React.FormEvent)=>{
   e.preventDefault();if(saving||!name.trim()||!canEditProfile||!p)return;
   setSaving(true);setSaveError('');
   try{
     if(p.id===me.id){
       let user=await api.updateProfile(name.trim(),phone.trim());
       if(isAdmin){
         user=await api.updateUser(me.id,{name:name.trim(),email:email.trim()||me.email,teamRole:teamRole||null,deptRole:teamRole?deptRole||null:null});
       }
       setState({user});
     }else if(isAdmin){
       await api.updateUser(p.id,{name:name.trim(), ...(email.trim()?{email:email.trim()}:{}),teamRole:teamRole||null,deptRole:teamRole?deptRole||null:null});
     }
     const refreshed=await api.profile(p.id);
     setP(refreshed);setEditing(false);toast('Đã lưu thông tin hồ sơ');
   }catch(e:any){setSaveError(e.message);}finally{setSaving(false);}
 };
 const uploadAvatar=async(file:File|undefined)=>{
   if(!file||avatarBusy||!p||!canEditProfile)return;
   setAvatarBusy(true);setSaveError('');
   try{
     const dataUrl=await fileToAvatarDataUrl(file);
     if(p.id===me.id){
       const user=await api.setMyAvatar(dataUrl);
       notifyAvatarChanged(user.id,user.avatarAt||Date.now());
       setState({user});
       setP(old=>old?{...old,avatarAt:user.avatarAt}:old);
     }else{
       const r=await api.setStaffAvatar(p.id,dataUrl);
       notifyAvatarChanged(p.id,r.avatarAt||Date.now());
       setP(old=>old?{...old,avatarAt:r.avatarAt}:old);
     }
     toast('Đã cập nhật ảnh đại diện');
   }catch(e:any){toast(e.message,true);setSaveError(e.message);}finally{setAvatarBusy(false);}
 };
 const removeAvatar=async()=>{
   if(avatarBusy||!p||!canEditProfile)return;
   setAvatarBusy(true);setSaveError('');
   try{
     if(p.id===me.id){
       const user=await api.removeMyAvatar();
       notifyAvatarChanged(user.id,null);
       setState({user});
     }else{
       await api.removeStaffAvatar(p.id);
       notifyAvatarChanged(p.id,null);
     }
     setP(old=>old?{...old,avatarAt:null}:old);
     toast('Đã xoá ảnh đại diện');
   }catch(e:any){toast(e.message,true);setSaveError(e.message);}finally{setAvatarBusy(false);}
 };
 const selectedDept=roles.find(r=>r.id===teamRole);
 if(loading)return <main className="profile-page"><BrandLoading label="Đang tải hồ sơ…"/></main>;
 if(error||!p)return <main className="profile-page"><p role="alert">{error||'Không tìm thấy hồ sơ.'}</p><button className="btn btn-gray" onClick={()=>setRetry(n=>n+1)}>Thử lại</button></main>;
 const hasAvatar=!!(p.avatarAt||hasUserAvatar(p.id));
 return <main className="profile-page">
   <header className="profile-cover"><span>HỒ SƠ THÀNH VIÊN</span></header>
   <section className="profile-identity">
     <div className="profile-avatar-wrap">
       <Avatar m={p} size={72}/>
       {canEditProfile&&<>
         <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" style={{display:'none'}} tabIndex={-1} aria-hidden="true" onChange={e=>{void uploadAvatar(e.target.files?.[0]);e.target.value='';}}/>
         <button type="button" className="profile-avatar-btn" disabled={avatarBusy} onClick={()=>fileRef.current?.click()} title="Đổi ảnh đại diện" aria-label="Đổi ảnh đại diện"><Icon name="edit" size={13}/></button>
       </>}
     </div>
     <div className="profile-identity-main">
       <div className="profile-identity-title">
         <h1>{p.name}</h1>
         <div className="profile-tags">
           {(p.canEdit||p.role)&&<span>{p.role==='admin'?'Quản trị':p.level==='observer'?'Chỉ xem':'Nhân viên'}</span>}
           {p.department&&<span style={{borderColor:p.department.color,color:p.department.color}}>{p.department.name}</span>}
           {p.position&&<span>{p.position}</span>}
         </div>
       </div>
       <div className="profile-identity-meta">
         {p.email&&<a href={`mailto:${p.email}`} className="profile-meta-link"><Icon name="folder" size={13}/>{p.email}</a>}
         {p.phone?<a href={`tel:${p.phone.replace(/[^+\d]/g,'')}`} className="profile-meta-link"><Icon name="phone" size={13}/>{p.phone}</a>:<span className="profile-meta-muted">Chưa cập nhật SĐT</span>}
         {p.createdAt&&<span className="profile-meta-muted">Tham gia từ {date(p.createdAt)}</span>}
       </div>
     </div>
    <div className="profile-buttons">
      {p.id !== me.id && (
        <button
          type="button"
          className="btn btn-primary btn-sm profile-msg-btn"
          onClick={() => openConversation(p.id, { id: p.id, name: p.name, email: p.email || '' }, me.id)}
        >
          <Icon name="messenger" size={14} /> Gửi tin nhắn
        </button>
      )}
      {canEditProfile && <>
        <button className="btn btn-gray btn-sm" disabled={avatarBusy} onClick={()=>fileRef.current?.click()}><Icon name="user" size={14}/>{avatarBusy?'Đang tải…':'Đổi ảnh đại diện'}</button>
        <button className="btn btn-primary btn-sm" onClick={startEdit}><Icon name="edit" size={14}/>Sửa hồ sơ</button>
        {p.canEdit&&<button className="btn btn-gray btn-sm" onClick={()=>setPw(true)}>Đổi mật khẩu</button>}
      </>}
    </div>
  </section>
   <div className="profile-layout"><aside className="profile-info"><h2>Thông tin cá nhân</h2>{editing?<form onSubmit={save}>
     <div className="profile-avatar-actions">
       <button type="button" className="btn btn-gray btn-sm" disabled={avatarBusy} onClick={()=>fileRef.current?.click()}><Icon name="user" size={14}/>{hasAvatar?'Đổi ảnh đại diện':'Tải ảnh đại diện'}</button>
       {hasAvatar&&<button type="button" className="btn btn-gray btn-sm" disabled={avatarBusy} onClick={()=>void removeAvatar()}><Icon name="trash" size={14}/>Xoá ảnh</button>}
     </div>
     <label>Họ và tên<input className="bk-in" autoFocus required maxLength={120} value={name} disabled={saving} onChange={e=>setName(e.target.value)}/></label>
     {p.id===me.id&&<label>Số điện thoại<input className="bk-in" type="tel" maxLength={40} value={phone} disabled={saving} placeholder="VD: 0901 234 567" onChange={e=>setPhone(e.target.value)}/></label>}
     {isAdmin?<>
       <label>Email đăng nhập<input className="bk-in" type="email" required maxLength={200} value={email} disabled={saving} onChange={e=>setEmail(e.target.value)}/></label>
       <label>Phòng ban<select className="bk-in" value={teamRole} disabled={saving} onChange={e=>{setTeamRole(e.target.value);setDeptRole(roles.find(r=>r.id===e.target.value)?.positions?.[0]?.id||'');}}>
         <option value="">Chưa gắn phòng ban</option>
         {roles.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
       </select></label>
       {teamRole&&<label>Vai trò trong phòng<select className="bk-in" value={deptRole} disabled={saving} onChange={e=>setDeptRole(e.target.value)}>
         <option value="">Chọn vai trò…</option>
         {(selectedDept?.positions||[]).map(pos=><option key={pos.id} value={pos.id}>{pos.name}</option>)}
       </select></label>}
     </>:<p className="note">Email đăng nhập và phòng ban do quản trị viên phân quyền.</p>}
     {saveError&&<p className="note err" role="alert">{saveError}</p>}
     <div className="profile-buttons"><button className="btn btn-primary btn-sm" disabled={saving||!name.trim()}>{saving?'Đang lưu…':'Lưu'}</button><button type="button" className="btn btn-gray btn-sm" disabled={saving} onClick={()=>setEditing(false)}>Huỷ</button></div>
   </form>:<dl className="profile-dl">
     <div><dt>Họ và tên</dt><dd>{p.name}</dd></div>
     {p.email&&<div><dt>Email</dt><dd><a href={`mailto:${p.email}`}>{p.email}</a></dd></div>}
     <div><dt>Số điện thoại</dt><dd>{p.phone?<a href={`tel:${p.phone.replace(/[^+\d]/g,'')}`}>{p.phone}</a>:'Chưa cập nhật'}</dd></div>
     <div><dt>Phòng ban</dt><dd>{p.department?.name||'Chưa có phòng ban'}</dd></div>
     <div><dt>Vai trò trong phòng</dt><dd>{p.position||'—'}</dd></div>
     {p.createdAt&&<div><dt>Tham gia từ</dt><dd>{date(p.createdAt)}</dd></div>}
   </dl>}</aside>
   <section className="profile-work">{taskError?<p role="alert">Không tải được công việc: {taskError} <button className="btn btn-gray btn-sm" onClick={()=>setRetry(n=>n+1)}>Thử lại</button></p>:taskLoading?<><ProfileTasks tasks={[]} loading title={p.canEdit?'Công việc được giao':'Công việc bạn có quyền xem'}/><BrandLoading label="Đang tải công việc…"/></>:<ProfileTasks tasks={tasks} loading={false} title={p.canEdit?'Công việc được giao':'Công việc bạn có quyền xem'}/>}</section></div>
   {p.canEdit&&<section className="notification-settings profile-lang"><header><h2>Ngôn ngữ / Language</h2></header><p className="note">Giao diện hiển thị bằng ngôn ngữ đã chọn trên trình duyệt này.</p><LangChoice/></section>}
   {p.canEdit&&<ClaudeConnect/>}
   {p.canEdit&&<NotificationSettings/>}
   <PasswordSheet open={pw} onClose={()=>setPw(false)}/>
 </main>;
}
