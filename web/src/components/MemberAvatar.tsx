import {useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Avatar, Pop, fileToAvatarDataUrl, hasUserAvatar, notifyAvatarChanged} from './boardkit';
import {api} from '../api';
import {setState, useStore, openProfile} from '../store';
import {Icon} from './ui';
import {openConversation} from './Messenger';

export type MemberPerson={id:string;name:string;email?:string;userId?:string|null};
/** Avatar opens the person's card; the adjacent + button remains the member picker. */
export function MemberAvatar({person,size=32,onRemove,onUpdated}:{person:MemberPerson;size?:number;onRemove?:()=>void|Promise<unknown>;onUpdated?:()=>void}) {
  const me=useStore(s=>s.user);
  const accountId=person.userId||(person.email?person.id:null);
  const member=me?.id===accountId?{...person,name:me.name,email:me.email}:person;
  const[anchor,setAnchor]=useState<HTMLElement|null>(null);
  const[editing,setEditing]=useState(false);
  const[name,setName]=useState(member.name);
  const[phone,setPhone]=useState(me?.id===accountId?me?.phone||'':'');
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState('');
  const fileRef=useRef<HTMLInputElement>(null);
  const close=()=>{anchor?.focus();setAnchor(null);setEditing(false);setError('');};
  const remove=async()=>{
    if(busy||!onRemove)return;
    setBusy(true);setError('');
    try{const result=await onRemove();if(result!==false)close();}
    catch(e:any){setError(e.message);}
    finally{setBusy(false);}
  };
  const save=async(e:React.FormEvent)=>{
    e.preventDefault();if(busy||!name.trim())return;
    setBusy(true);setError('');
    try{const user=await api.updateProfile(name.trim(),phone.trim());setState({user});setEditing(false);onUpdated?.();}
    catch(e:any){setError(e.message);}finally{setBusy(false);}
  };
  const uploadAvatar=async(file:File)=>{
    if(!accountId)return;
    setBusy(true);setError('');
    try{
      const dataUrl=await fileToAvatarDataUrl(file);
      const r=await api.setMyAvatar(dataUrl);
      const ts=r.avatarAt??Date.now();
      notifyAvatarChanged(accountId,ts);
      if(me)setState({user:{...me,avatarAt:ts}});
      onUpdated?.();
    }catch(e:any){setError(e.message);}finally{setBusy(false);}
  };
  const removeAvatar=async()=>{
    if(!accountId)return;
    setBusy(true);setError('');
    try{
      await api.removeMyAvatar();
      notifyAvatarChanged(accountId,null);
      if(me)setState({user:{...me,avatarAt:null}});
      onUpdated?.();
    }catch(e:any){setError(e.message);}finally{setBusy(false);}
  };
  return <><button type="button" className="employee-picker-avatar" title={`${member.name}${me?.id===accountId&&member.email?` (${member.email.split('@')[0]})`:''}`} aria-label={`Thông tin ${member.name}`} aria-haspopup="dialog" aria-expanded={!!anchor} onClick={e=>{setName(member.name);setPhone(me?.id===accountId?me?.phone||'':'');setError('');setAnchor(e.currentTarget);}}><Avatar m={member} size={size}/></button>
    {anchor&&createPortal(<Pop anchor={anchor} title={editing?'Sửa thông tin cá nhân':member.name} className="member-profile" onClose={close}>
      <div className="member-profile-hero">
        <div className="member-avatar-edit-wrap">
          <Avatar m={member} size={88}/>
          {me?.id===accountId&&<>
            <button type="button" className="profile-avatar-btn" disabled={busy} title="Đổi ảnh đại diện" aria-label="Đổi ảnh đại diện" onClick={()=>fileRef.current?.click()}><Icon name="edit" size={13}/></button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" style={{display:'none'}} tabIndex={-1} aria-hidden="true" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void uploadAvatar(f);}}/>
          </>}
        </div>
        <h3>{member.name}</h3>
        {me?.id===accountId&&member.email&&<span title={member.email}>@{member.email.split('@')[0]}</span>}
      </div>
      <div className="member-profile-body">
        {editing?<form onSubmit={save}>
          <label>Họ và tên<input className="bk-in" autoFocus required maxLength={120} disabled={busy} value={name} onChange={e=>setName(e.target.value)}/></label>
          <label>Số điện thoại<input className="bk-in" type="tel" maxLength={60} disabled={busy} value={phone} placeholder="Chưa cập nhật" onChange={e=>setPhone(e.target.value)}/></label>
          <div className="member-profile-actions"><button type="submit" className="btn btn-primary btn-sm" disabled={busy||!name.trim()}>{busy?'Đang lưu…':'Lưu'}</button><button type="button" className="btn btn-gray btn-sm" disabled={busy} onClick={()=>setEditing(false)}>Huỷ</button></div>
        </form>:<>
          {accountId&&<button type="button" className="member-profile-action" onClick={()=>{close();openProfile(accountId!);}}>Xem hồ sơ</button>}
          {accountId&&me?.id!==accountId&&<button type="button" className="member-profile-action member-profile-msg" onClick={()=>{close();openConversation(accountId,{id:accountId,name:member.name,email:member.email||''},me?.id);}}><Icon name="messenger" size={14}/> Gửi tin nhắn</button>}
          {me?.id===accountId&&<button type="button" className="member-profile-action" disabled={busy} onClick={()=>fileRef.current?.click()}>Đổi ảnh đại diện</button>}
          {me?.id===accountId&&(hasUserAvatar(accountId)||!!me?.avatarAt)&&<button type="button" className="member-profile-action" disabled={busy} onClick={()=>void removeAvatar()}>Gỡ ảnh đại diện</button>}
          {me?.id===accountId&&<button type="button" className="member-profile-action" disabled={busy} onClick={()=>{setName(member.name);setPhone(me?.phone||'');setEditing(true);}}>Sửa thông tin cá nhân</button>}
          {onRemove&&<button type="button" className="member-profile-action member-profile-remove" disabled={busy} onClick={()=>void remove()}>{busy?'Đang gỡ…':'Gỡ bỏ khỏi Thẻ'}</button>}
          {me?.id!==accountId&&!onRemove&&<span className="note">Thành viên của thẻ</span>}
        </>}
        {error&&<p className="note err" role="alert">{error}</p>}
      </div>
    </Pop>,document.body)}
  </>;
}
