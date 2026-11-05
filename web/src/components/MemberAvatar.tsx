import {useState} from 'react';
import {createPortal} from 'react-dom';
import {Avatar, Pop} from './boardkit';
import {api} from '../api';
import {setState, useStore, openProfile} from '../store';

export type MemberPerson={id:string;name:string;email?:string;userId?:string|null};
/** Avatar opens the person's card; the adjacent + button remains the member picker. */
export function MemberAvatar({person,size=32,onRemove,onUpdated}:{person:MemberPerson;size?:number;onRemove?:()=>void|Promise<unknown>;onUpdated?:()=>void}) {
  const me=useStore(s=>s.user);
  const accountId=person.userId||(person.email?person.id:null);
  const member=me?.id===accountId?{...person,name:me.name,email:me.email}:person;
  const[anchor,setAnchor]=useState<HTMLElement|null>(null);
  const[editing,setEditing]=useState(false);
  const[name,setName]=useState(member.name);
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState('');
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
    try{const user=await api.updateProfile(name.trim());setState({user});setEditing(false);onUpdated?.();}
    catch(e:any){setError(e.message);}finally{setBusy(false);}
  };
  return <><button type="button" className="employee-picker-avatar" title={`${member.name}${me?.id===accountId&&member.email?` (${member.email.split('@')[0]})`:''}`} aria-label={`Thông tin ${member.name}`} aria-haspopup="dialog" aria-expanded={!!anchor} onClick={e=>{setName(member.name);setError('');setAnchor(e.currentTarget);}}><Avatar m={member} size={size}/></button>
    {anchor&&createPortal(<Pop anchor={anchor} title={editing?'Sửa thông tin cá nhân':member.name} className="member-profile" onClose={close}>
      <div className="member-profile-hero"><Avatar m={member} size={88}/><h3>{member.name}</h3>{me?.id===accountId&&member.email&&<span title={member.email}>@{member.email.split('@')[0]}</span>}</div>
      <div className="member-profile-body">
        {editing?<form onSubmit={save}><label>Họ và tên<input className="bk-in" autoFocus required maxLength={120} disabled={busy} value={name} onChange={e=>setName(e.target.value)}/></label><div className="member-profile-actions"><button type="submit" className="btn btn-primary btn-sm" disabled={busy||!name.trim()}>{busy?'Đang lưu…':'Lưu'}</button><button type="button" className="btn btn-gray btn-sm" disabled={busy} onClick={()=>setEditing(false)}>Huỷ</button></div></form>:<>
          {accountId&&<button type="button" className="member-profile-action" onClick={()=>{close();openProfile(accountId!);}}>Xem hồ sơ</button>}
          {me?.id===accountId&&<button type="button" className="member-profile-action" disabled={busy} onClick={()=>{setName(member.name);setEditing(true);}}>Sửa thông tin cá nhân</button>}
          {onRemove&&<button type="button" className="member-profile-action member-profile-remove" disabled={busy} onClick={()=>void remove()}>{busy?'Đang gỡ…':'Gỡ bỏ khỏi Thẻ'}</button>}
          {me?.id!==accountId&&!onRemove&&<span className="note">Thành viên của thẻ</span>}
        </>}
        {error&&<p className="note err" role="alert">{error}</p>}
      </div>
    </Pop>,document.body)}
  </>;
}
