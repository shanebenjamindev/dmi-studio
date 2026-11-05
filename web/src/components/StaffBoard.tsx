import {BrandLoading} from './BrandLoading';
import {EntitySelect} from './QuickCreate';
import {useRef, useState, type CSSProperties, type DragEvent} from 'react';
import {api} from '../api';
import {setState, toast, openProfile} from '../store';
import {Avatar, Pop} from './boardkit';
import {createPortal} from 'react-dom';
import {Icon} from './ui';
import type {TeamRole, User} from '../types';

const normalize=(s:string)=>s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d');
const DRAG_TYPE='application/x-dmi-employee';
const lastLogin=(t:number|null)=>t?new Date(t).toLocaleDateString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'Chưa đăng nhập';

export function StaffBoard({users,roles,meId,loading,error,onRetry,onEdit,onAdd,onUserChanged,onReload,onAddDepartment}:{
  users:User[];roles:TeamRole[];meId:string;loading:boolean;error:string;
  onRetry:()=>void;onEdit:(u:User)=>void;onAdd:(team:string|null)=>void;
  onUserChanged:(u:User)=>void;onReload:()=>void;onAddDepartment:()=>void;
}) {
  const [query,setQuery]=useState('');
  const [filter,setFilter]=useState('active');
  const [dragging,setDragging]=useState<string|null>(null);
  const [over,setOver]=useState<string|null>(null);
  const [busy,setBusy]=useState<string[]>([]);
  const [announcement,setAnnouncement]=useState('');
  const pending=useRef(new Set<string>());
  const board=useRef<HTMLDivElement>(null);
  const syncRoles=()=>api.roles().then(roles=>setState({roles})).catch(()=>{});
  const patch=async(u:User,body:Parameters<typeof api.updateUser>[1],message:string)=>{
    if(pending.current.has(u.id))return;
    pending.current.add(u.id);setBusy([...pending.current]);
    try {
      const saved=await api.updateUser(u.id,body);
      onUserChanged(saved);
      if(saved.id===meId)setState({user:saved});
      if('teamRole' in body||'deptRole' in body)await syncRoles();
      setAnnouncement(message);toast(message);
    } catch(e:any){toast(e.message,true);setAnnouncement(`Không lưu được thay đổi của ${u.name}.`);}
    finally{pending.current.delete(u.id);setBusy([...pending.current]);}
  };
  const move=async(u:User,team:string|null)=>{
    if((u.teamRole||null)===team)return;
    // Preserve the department level when the destination has an equivalent role.
    let destination=roles.find(r=>r.id===team);
    if(team&&!destination){try{destination=(await api.roles()).find(r=>r.id===team);}catch(e:any){toast(e.message,true);return;}}
    const position=destination?.positions?.find(p=>p.name===u.deptRoleName&&p.level===u.level)
      || destination?.positions?.find(p=>p.level===u.level);
    return patch(u,{teamRole:team,deptRole:position?.id||null},`Đã chuyển ${u.name} sang ${destination?.name||'Chưa có phòng ban'}`);
  };
  const remove=async(u:User)=>{
    if(pending.current.has(u.id)||!confirm(`Xoá tài khoản ${u.email}? Người này sẽ không đăng nhập được nữa.`))return;
    pending.current.add(u.id);setBusy([...pending.current]);
    try{await api.deleteUser(u.id);onReload();await syncRoles();toast('Đã xoá nhân viên');}
    catch(e:any){toast(e.message,true);}
    finally{pending.current.delete(u.id);setBusy([...pending.current]);}
  };
  const resetDrag=()=>{setDragging(null);setOver(null);};
  const allowDrop=(e:DragEvent,team:string)=>{
    if(!dragging||pending.current.has(dragging)||!e.dataTransfer.types.includes(DRAG_TYPE))return;
    e.preventDefault();e.dataTransfer.dropEffect='move';setOver(team);
    const el=board.current;
    if(el){const r=el.getBoundingClientRect();if(e.clientX<r.left+60)el.scrollLeft-=18;else if(e.clientX>r.right-60)el.scrollLeft+=18;}
  };
  const drop=(e:DragEvent,team:string|null)=>{
    e.preventDefault();
    const id=e.dataTransfer.getData(DRAG_TYPE);
    const person=users.find(u=>u.id===id&&u.id===dragging);
    resetDrag();if(person)void move(person,team);
  };
  const q=normalize(query.trim());
  const filtered=users.filter(u=>(filter==='all'||(filter==='locked'?u.disabled:!u.disabled))&&normalize(`${u.name} ${u.email}`).includes(q));
  const columns=[...roles.map(r=>({id:r.id,name:r.name,color:r.color})),{id:'',name:'Chưa có phòng ban',color:'#8590a2'}];
  return <section className="staff-management" aria-label="Quản lý nhân viên theo phòng ban">
    <header className="staff-heading"><div><span className="staff-eyebrow">QUẢN TRỊ / ĐỘI NGŨ</span><h1>Nhân viên & phòng ban</h1><p>Kéo thẻ sang phòng ban khác để chuyển nhân viên.</p></div><div className="staff-actions"><button className="btn btn-gray" onClick={onAddDepartment}><Icon name="plus" size={15}/>Phòng ban</button><button className="btn btn-primary" onClick={()=>onAdd(null)}><Icon name="plus" size={15}/>Thêm nhân viên</button></div></header>
    <div className="staff-stats"><div><span>Nhân viên</span><b>{loading?'—':users.length}</b></div><div><span>Đang hoạt động</span><b>{loading?'—':users.filter(u=>!u.disabled).length}</b></div><div><span>Phòng ban</span><b>{roles.length}</b></div><div><span>Chưa phân phòng</span><b>{loading?'—':users.filter(u=>!u.teamRole||!roles.some(r=>r.id===u.teamRole)).length}</b></div></div>
    <div className="staff-toolbar"><label className="staff-search"><Icon name="search" size={17}/><input type="search" placeholder="Tìm theo tên hoặc email…" aria-label="Tìm nhân viên" value={query} onChange={e=>setQuery(e.target.value)}/></label><label className="staff-filter">Hiển thị<select aria-label="Lọc nhân viên" value={filter} onChange={e=>setFilter(e.target.value)}><option value="active">Đang hoạt động</option><option value="all">Tất cả nhân viên</option><option value="locked">Đã khoá</option></select></label><span className="staff-found">{filtered.length} nhân viên</span></div>
    <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    {error?<div className="staff-load-state" role="alert"><p>{error}</p><button className="btn btn-gray" onClick={onRetry}>Thử lại</button></div>:loading?<BrandLoading label="Đang tải nhân viên…"/>:<div ref={board} className="staff-board" tabIndex={0} aria-label="Các phòng ban; cuộn ngang để xem thêm" onKeyDown={e=>{if(e.key==='Escape')resetDrag();}}>
      {columns.map(col=>{
        const belongs=(u:User)=>col.id?u.teamRole===col.id:!u.teamRole||!roles.some(r=>r.id===u.teamRole);
        const people=filtered.filter(belongs),total=users.filter(belongs).length;
        return <section key={col.id} className={'staff-column'+(over===col.id?' drop-target':'')} style={{'--staff-color':col.color} as CSSProperties} aria-label={`Phòng ${col.name}`} onDragOver={e=>allowDrop(e,col.id)} onDragLeave={e=>{if(!(e.relatedTarget instanceof Node)||!e.currentTarget.contains(e.relatedTarget))setOver(current=>current===col.id?null:current);}} onDrop={e=>drop(e,col.id||null)}>
          <header className="staff-column-head"><i/><h2>{col.name}</h2><span title={`${people.length} hiển thị / ${total} nhân viên`}>{people.length}{people.length!==total?` / ${total}`:''}</span><button className="bd-icon" aria-label={`Thêm nhân viên vào ${col.name}`} onClick={()=>onAdd(col.id||null)}><Icon name="plus" size={16}/></button></header>
          <div className="staff-column-body">{people.map(u=>{
            const saving=busy.includes(u.id);
            return <article key={u.id} className={'staff-card'+(u.disabled?' is-locked':'')+(dragging===u.id?' is-dragging':'')} draggable={!saving} aria-label={u.name} aria-busy={saving} onDragStart={e=>{if((e.target as HTMLElement).closest('button,select,input,a')){e.preventDefault();return;}e.dataTransfer.setData(DRAG_TYPE,u.id);e.dataTransfer.effectAllowed='move';setDragging(u.id);}} onDragEnd={resetDrag}>
              <div className="staff-card-top"><Avatar m={u} size={36}/><div className="staff-person"><b>{u.name}{u.id===meId&&<em>Bạn</em>}</b><span title="Email đăng nhập">{u.email}</span>{u.notifyEmail?<small className="staff-mail" title="Email nhận thông báo">✉ {u.notifyEmail}</small>:<small className="staff-mail none" title="Thông báo chỉ hiện trên web; bấm Sửa để thêm email nhận thông báo">Chưa có email nhận thông báo</small>}</div>{!saving&&<StaffMenu name={u.name} items={[
                {label:'Xem hồ sơ',icon:'user',onClick:()=>openProfile(u.id)},
                {label:'Sửa nhân viên…',icon:'text',onClick:()=>onEdit(u)},
                {label:u.role==='admin'?'Chuyển thành nhân viên':'Cấp quyền quản trị',icon:'badge',hidden:u.id===meId,onClick:()=>void patch(u,{role:u.role==='admin'?'member':'admin'},'Đã cập nhật quyền')},
                {label:u.disabled?'Mở khoá':'Khoá tài khoản',icon:u.disabled?'check':'x',hidden:u.id===meId,onClick:()=>void patch(u,{disabled:!u.disabled},u.disabled?'Đã mở khoá tài khoản':'Đã khoá tài khoản')},
                {label:'Xoá nhân viên',icon:'trash',danger:true,hidden:u.id===meId,onClick:()=>void remove(u)}
              ]}/>}</div>
              <div className="staff-card-badges"><span className={u.role==='admin'?'staff-badge admin':'staff-badge'}>{u.role==='admin'?'Quản trị':u.level==='observer'?'Chỉ xem':'Nhân viên'}</span>{u.deptRoleName&&u.role!=='admin'&&<span className="staff-position">{u.deptRoleName}</span>}{u.disabled&&<span className="staff-badge locked">Đã khoá</span>}</div>
              <div className="staff-card-footer"><span>{saving?'Đang lưu…':lastLogin(u.lastLogin)}</span><EntitySelect kind="department" disabled={saving} value={u.teamRole||''} aria-label={`Chuyển phòng ban cho ${u.name}`} onChange={v=>void move(u,v||null)}><option value="">Chưa có phòng ban</option>{roles.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</EntitySelect></div>
            </article>;
          })}{!people.length&&<div className="staff-empty">{total?'Không có nhân viên khớp bộ lọc.':dragging?'Thả nhân viên vào đây':'Chưa có nhân viên'}{!total&&!dragging&&<button onClick={()=>onAdd(col.id||null)}>Thêm nhân viên</button>}</div>}</div>
        </section>;
      })}
    </div>}
    {!loading&&!error&&!filtered.length&&users.length>0&&<button className="staff-clear" onClick={()=>{setQuery('');setFilter('all');}}>Xoá bộ lọc để xem tất cả nhân viên</button>}
  </section>;
}

function StaffMenu({name,items}:{name:string;items:{label:string;icon:string;hidden?:boolean;danger?:boolean;onClick:()=>void}[]}) {
  const[anchor,setAnchor]=useState<HTMLElement|null>(null);
  const close=()=>{anchor?.focus();setAnchor(null);};
  return <><button className="bd-icon" type="button" aria-label={`Tuỳ chọn cho ${name}`} aria-haspopup="dialog" aria-expanded={!!anchor} onClick={e=>setAnchor(e.currentTarget)}><Icon name="more" size={17}/></button>{anchor&&createPortal(<Pop anchor={anchor} title={name} onClose={close}>{items.filter(i=>!i.hidden).map(item=><button type="button" className={'bk-opt'+(item.danger?' staff-danger':'')} key={item.label} onClick={()=>{close();item.onClick();}}><Icon name={item.icon} size={15}/><span>{item.label}</span></button>)}</Pop>,document.body)}</>;
}
