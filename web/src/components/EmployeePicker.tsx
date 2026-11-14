import {QuickCreateButton,useEntityRefresh} from './QuickCreate';
import {api} from '../api';
import {useEffect,useState} from 'react';
import {Avatar, Pop} from './boardkit';
import {createPortal} from 'react-dom';
import {Icon} from './ui';
import {MemberAvatar} from './MemberAvatar';
import {AvatarStack} from './AvatarStack';
import { tr } from '../i18n';

type Member = {id:string;name:string;email?:string};
export function EmployeeAvatars({people}:{people:Member[]}){return <span className="employee-avatars">{people.length?<AvatarStack people={people} max={4} render={p=><MemberAvatar key={p.id} person={p} size={28}/>}/>:<span>—</span>}</span>;}

/** Shared with the Workspace card: assigned members first, then people available to add (`others`: everyone else
 *  in the company, for a card: they join its board when picked). */
/** `exclude`: people not offered (whoever gives a task out is not one to do it); `chosenLabel`: the heading of those chosen. */
export function MemberChoices({people:all,selected,onToggle,others:allOthers=[],exclude=[],chosenLabel='Thành viên của thẻ'}:{people:Member[];selected:string[];onToggle:(id:string)=>void;others?:Member[];exclude?:string[];chosenLabel?:string}) {
 const people=all.filter(p=>!exclude.includes(p.id)),others=allOthers.filter(p=>!exclude.includes(p.id));
 const[q,setQ]=useState('');
 const normalize=(s:string)=>s.toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d');
 const visible=people.filter(p=>normalize(`${p.name} ${p.email||''}`).includes(normalize(q.trim())));
 const assigned=visible.filter(p=>selected.includes(p.id)),available=visible.filter(p=>!selected.includes(p.id));
 const outside=others.filter(p=>!selected.includes(p.id)&&!people.some(m=>m.id===p.id)&&normalize(`${p.name} ${p.email||''}`).includes(normalize(q.trim())));
 return <div className="employee-member-menu">
   <input className="bk-in" autoFocus aria-label="Tìm kiếm các thành viên" placeholder="Tìm kiếm các thành viên" value={q} onChange={e=>setQ(e.target.value)}/>
   <h5>{chosenLabel}</h5>
   {assigned.map(p=><button type="button" key={p.id} className="bk-opt employee-member-selected" aria-label={`Gỡ ${p.name}`} onClick={()=>onToggle(p.id)}><Avatar m={p} size={32}/><span>{p.name}</span><Icon name="x" size={18}/></button>)}
   {!assigned.length&&visible.length>0&&<p className="note">{selected.length?'Không có thành viên đã chọn khớp tìm kiếm.':'Chưa có thành viên.'}</p>}
   {available.length>0&&<><h5>{others.length?'Thành viên board':'Thành viên khác'}</h5>{available.map(p=><button type="button" key={p.id} className="bk-opt" aria-label={`Thêm ${p.name}`} onClick={()=>onToggle(p.id)}><Avatar m={p} size={32}/><span>{p.name}</span><Icon name="plus" size={16}/></button>)}</>}
   {outside.length>0&&<><h5>Nhân viên khác <small>· được thêm vào board khi chọn</small></h5>{outside.map(p=><button type="button" key={p.id} className="bk-opt" aria-label={`Thêm ${p.name}`} onClick={()=>onToggle(p.id)}><Avatar m={p} size={32}/><span>{p.name}</span><Icon name="plus" size={16}/></button>)}</>}
   {!visible.length&&!outside.length&&<p className="note">Không tìm thấy thành viên.</p>}
 </div>;
}

/** `single`: one person at most (picking another replaces them); `exclude`: people not offered. */
export function EmployeePicker({users:initialUsers,selected,onChange,legacy=[],onLegacyChange,label='Thành viên',single=false,exclude=[]}:{users:{id:string;name:string;email:string}[];selected:string[];onChange:(ids:string[])=>void;legacy?:{id:string;name:string}[];onLegacyChange?:(ids:string[])=>void;label?:string;single?:boolean;exclude?:string[]}){
 const[users,setUsers]=useState(initialUsers);
 useEffect(()=>setUsers(initialUsers),[initialUsers]);
 const reloadUsers=async()=>setUsers((await api.taskMeta()).users);
 useEntityRefresh(()=>{void reloadUsers().catch(()=>{});});
 const[anchor,setAnchor]=useState<HTMLElement|null>(null);
 const chosen=users.filter(u=>selected.includes(u.id));
 const members=[...new Map([...users,...legacy].map(p=>[p.id,p])).values()];
 const close=()=>{anchor?.focus();setAnchor(null);};
 const toggle=(id:string)=>{
   if(legacy.some(p=>p.id===id))onLegacyChange?.(legacy.filter(p=>p.id!==id).map(p=>p.id));
   else if(single){if(!selected.includes(id)&&legacy.length)onLegacyChange?.([]);onChange(selected.includes(id)?[]:[id]);if(!selected.includes(id))close();}
   else onChange(selected.includes(id)?selected.filter(x=>x!==id):[...selected,id]);
 };
 return <div className="employee-picker">
   <span className="employee-picker-label">{label}</span>
   <div className="employee-picker-summary">{[...chosen,...legacy].map(p=><MemberAvatar key={p.id} person={p} onRemove={()=>toggle(p.id)}/>)}<button type="button" className="employee-picker-add" aria-label={`${tr('Thêm')} ${tr(label).toLocaleLowerCase()}`} aria-haspopup="dialog" aria-expanded={!!anchor} onClick={e=>setAnchor(anchor?null:e.currentTarget)}><Icon name="plus" size={22}/></button></div>
   {anchor&&createPortal(<Pop anchor={anchor} title={label} onClose={close}><MemberChoices people={members} exclude={exclude} chosenLabel={label} selected={[...selected,...legacy.map(p=>p.id)]} onToggle={toggle}/><QuickCreateButton kind="employee" onCreated={async r=>{await reloadUsers();onChange([...selected,r.id]);}}/></Pop>,document.body)}
 </div>;
}
