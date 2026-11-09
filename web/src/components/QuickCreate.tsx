import {useEffect,useRef,useState,type ReactNode,type SelectHTMLAttributes} from 'react';
import {createPortal} from 'react-dom';
import {api} from '../api';
import {mayAddCustomer,setState,useStore} from '../store';
import {Icon} from './ui';
import type {ServiceRef,User} from '../types';
import {ServicePicker} from './ServicePicker';

type Kind='workspace'|'customer'|'project'|'campaign'|'employee'|'department'|'position'|'board'|'list'|'task'|'card'|'label';
export type CreatedRecord={id:string;name:string;projectId?:string;customerId?:string};
type Context={customerId?:string;projectId?:string;campaignId?:string;departmentId?:string;boardId?:string;listId?:string};
const labels:Record<Kind,string>={workspace:'workspace',customer:'khách hàng',project:'dự án',campaign:'chiến dịch',employee:'nhân viên',department:'phòng ban',position:'vai trò trong phòng',board:'board',list:'danh sách',task:'công việc',card:'thẻ',label:'nhãn'};
export function useEntityRefresh(refresh:()=>void){
 const latest=useRef(refresh);latest.current=refresh;
 useEffect(()=>{
  const run=()=>latest.current();
  window.addEventListener('dms:entity-created',run);
  window.addEventListener('dms:entities-changed',run);
  return()=>{
   window.removeEventListener('dms:entity-created',run);
   window.removeEventListener('dms:entities-changed',run);
  };
 },[]);
}
function permitted(kind:Kind,user:User|null){
 if(!user)return false;
 if(['employee','department','position'].includes(kind))return user.role==='admin';
 if(kind==='customer')return mayAddCustomer();
 if(['project','campaign'].includes(kind))return user.role==='admin'||user.level!=='observer';
 return user.role==='admin'||user.level!=='observer';
}
export function EntitySelect({kind,context,onCreated,onChange,createdValue,allowCreate=true,children,...props}:Omit<SelectHTMLAttributes<HTMLSelectElement>,'onChange'> & {kind:Kind;context?:Context;onCreated?:(r:CreatedRecord)=>void|Promise<void>;onChange:(value:string)=>void;createdValue?:(r:CreatedRecord)=>string;allowCreate?:boolean;children:ReactNode}){
 const[open,setOpen]=useState(false);const user=useStore(s=>s.user);
 return <><select {...props} onChange={e=>{if(e.target.value==='__create__'){e.target.value=String(props.value??'');setOpen(true);}else onChange(e.target.value);}}>{children}{allowCreate&&permitted(kind,user)&&<option value="__create__">＋ Tạo {labels[kind]} mới…</option>}</select>{open&&<QuickCreateDialog kind={kind} context={context} onClose={()=>setOpen(false)} onCreated={async r=>{await onCreated?.(r);onChange(createdValue?createdValue(r):r.id);setOpen(false);}}/>}</>;
}
export function QuickCreateButton({kind,context,onCreated,label}:{kind:Kind;context?:Context;onCreated:(r:CreatedRecord)=>void|Promise<void>;label?:string}){
 const[open,setOpen]=useState(false);const user=useStore(s=>s.user);
 if(!permitted(kind,user))return null;
 return <><button type="button" className="bk-opt qc-add" onClick={()=>setOpen(true)}><Icon name="plus" size={15}/><span>{label||`Tạo ${labels[kind]} mới`}</span></button>{open&&<QuickCreateDialog kind={kind} context={context} onClose={()=>setOpen(false)} onCreated={async r=>{await onCreated(r);setOpen(false);}}/>}</>;
}
export function QuickCreateDialog({kind,context={},onClose,onCreated}:{kind:Kind;context?:Context;onClose:()=>void;onCreated:(r:CreatedRecord)=>void|Promise<void>}){
 const dialog=useRef<HTMLDialogElement>(null);
 const[name,setName]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState('');
 const[customer,setCustomer]=useState(context.customerId||''),[project,setProject]=useState(context.projectId||''),[department,setDepartment]=useState(context.departmentId||'');
 const[customers,setCustomers]=useState<{id:string;name:string}[]>([]),[projects,setProjects]=useState<{id:string;name:string}[]>([]);
 // A project's services start as its customer's (those of the customer's other projects), and can be changed here.
 const[services,setServices]=useState<string[]>([]),[known,setKnown]=useState<ServiceRef[]>([]);
 useEffect(()=>{if(kind!=='project')return;if(!customer){setServices([]);return;}let on=true;api.customerRecord(customer).then(r=>{if(on){setKnown(r.needs||[]);setServices((r.needs||[]).map(n=>n.id));}},()=>{});return()=>{on=false;};},[kind,customer]);
 const roles=useStore(s=>s.roles);
 const google=useStore(s=>s.googleSignin);
 const[busy,setBusy]=useState(false),[error,setError]=useState(''),[created,setCreated]=useState<CreatedRecord|null>(null);
 const busyRef=useRef(false);
 const refresh=async()=>{if(kind==='project'||kind==='board')setCustomers(await api.customersAll());if(kind==='campaign')setProjects((await api.taskMeta()).projects);};
 useEffect(()=>{if(!dialog.current?.open)dialog.current?.showModal();void refresh().catch(e=>setError(e.message));},[]);
 const save=async(e:React.FormEvent)=>{
  e.preventDefault();e.stopPropagation();if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');
  let record=created;
  try{
   if(!record){
    if(kind==='workspace'){const r=await api.createWorkspace({name:name.trim(),visibility:'private'});record={id:r.id,name:r.name};}
    else if(kind==='customer'){const r=await api.createCustomer({name:name.trim(),databaseOnly:true});record={id:r.id,name:name.trim()};}
    else if(kind==='project'){
     if(customer){const r=await api.createCustomerProject(customer,{name:name.trim(),services});record={...r,customerId:customer};}
     else{const r=await api.createTaskProject({name:name.trim(),services});record={id:r.id,name:r.name,customerId:''};}
    }
    else if(kind==='campaign'){const r=await api.createCampaign(project,name.trim());record=r;}
    else if(kind==='employee'){const r=await api.createUser({name:name.trim(),email:email.trim(),password:password||undefined,role:'member',teamRole:department||null});record={id:r.id,name:r.name};}
    else if(kind==='department'){const r=await api.createRole({name:name.trim(),color:'#579dff',pages:['workspace']});record={id:r.id,name:r.name};}
    else if(kind==='position'){const r=await api.createPosition(context.departmentId!,{name:name.trim(),level:'normal'});record={id:r.id,name:r.name};}
    else if(kind==='board'){const r=await api.createBoard({name:name.trim(),bg:'slate',roleId:null,private:true,lists:['Chưa thực hiện','Đang thực hiện','Hoàn thành'],customerId:customer||null});record={id:r.id,name:r.name};}
    else if(kind==='list'){const r=await api.createList(context.boardId!,name.trim());record={id:r.id,name:r.name};}
    else if(kind==='card'){const r=await api.createCard(context.listId!,name.trim());record={id:r.id,name:r.title};}
    else if(kind==='label'){const r=await api.createLabel(context.boardId!,{name:name.trim(),color:'blue'});record={id:r.id,name:r.name};}
    else{const r=await api.createTask({title:name.trim(),projectId:context.projectId||null,campaignId:context.campaignId||null});record={id:r.id,name:name.trim()};}
    setCreated(record);
    window.dispatchEvent(new CustomEvent('dms:entity-created',{detail:{kind,...record}}));
   }
   if(['employee','department','position'].includes(kind))setState({roles:await api.roles()});
   await onCreated(record);
  }catch(e:any){setError(record?`Đã tạo “${record.name}”. Chưa chọn được mục này: ${e.message}. Bấm thử lại để chọn, không tạo trùng.`:e.message);}
  finally{busyRef.current=false;setBusy(false);}
 };
 const ready=!!name.trim()&&(kind!=='campaign'||!!project)&&(kind!=='employee'||(!!email.trim()&&(google||password.length>=8)));
 return createPortal(<dialog ref={dialog} className="qc-dialog" aria-label={`Tạo ${labels[kind]} mới`} onCancel={e=>{e.preventDefault();e.stopPropagation();if(!busyRef.current)onClose();}} onClick={e=>{e.stopPropagation();if(e.target===e.currentTarget&&!busyRef.current)onClose();}}><form onSubmit={save}><header><h2>Tạo {labels[kind]} mới</h2><button type="button" className="bd-icon" disabled={busy} onClick={onClose} aria-label="Đóng"><Icon name="x" size={17}/></button></header><fieldset disabled={busy||!!created}>
  <label>Tên {labels[kind]}<input className="bk-in" autoFocus required maxLength={kind==='list'?80:200} value={name} onChange={e=>setName(e.target.value)}/></label>
  {kind==='project'&&<label>Khách hàng<EntitySelect kind="customer" className="bk-in" value={customer} onChange={setCustomer} onCreated={refresh} disabled={!!context.customerId}><option value="">Dự án nội bộ (không gắn khách hàng)</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</EntitySelect></label>}
  {kind==='board'&&<label>Khách hàng<EntitySelect kind="customer" className="bk-in" value={customer} onChange={setCustomer} onCreated={refresh}><option value="">Không gắn khách hàng</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</EntitySelect></label>}
  {kind==='project'&&<div className="qc-field"><span>Dịch vụ</span><ServicePicker value={services} onChange={setServices} known={known}/></div>}
  {kind==='campaign'&&<label>Dự án<EntitySelect kind="project" className="bk-in" value={project} onChange={setProject} onCreated={refresh} required disabled={!!context.projectId}><option value="">Chọn dự án</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</EntitySelect></label>}
  {kind==='employee'&&<><label>Email đăng nhập<input className="bk-in" type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Mật khẩu<input className="bk-in" type="password" required={!google} minLength={8} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/><small>{google?'Để trống nếu chỉ đăng nhập bằng Google đã kết nối.':'Ít nhất 8 ký tự.'}</small></label><label>Phòng ban<EntitySelect kind="department" className="bk-in" value={department} onChange={setDepartment}><option value="">Chưa có phòng ban</option>{roles.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</EntitySelect></label></>}
 </fieldset><p className="note">Lưu vào hệ thống và dùng chung ở các phần liên quan.{kind==='project'?' Dự án sẽ thuộc khách hàng đã chọn.':kind==='campaign'?' Chiến dịch sẽ thuộc dự án đã chọn.':''}</p>{error&&<p className="note err" role="alert">{error}</p>}<footer><button type="button" className="btn btn-gray" disabled={busy} onClick={onClose}>Đóng</button><button className="btn btn-primary" disabled={busy||(!created&&!ready)}>{busy?'Đang lưu…':created?'Thử chọn lại':'Tạo và chọn'}</button></footer></form></dialog>,document.body);
}
