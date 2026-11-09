import {CustomerStages} from './CustomerStages';
import {useCustomerStatuses} from './useCustomerStatuses';
import {BrandLoading} from './BrandLoading';
import {useEffect,useState} from 'react';
import {api} from '../api';
import {toast,useStore} from '../store';
import type {CustomerRecord,CustomerTag,Loc} from '../types';
import {Icon} from './ui';
import {FolderPicker} from './FolderPicker';

// A customer's details: contact, tags (typed: one in the list, or a new one that joins it), where it came from (a new
// source can be added here), its Drive folder (a pasted link or one picked; unlinking keeps the folder on Drive) and Khác
// (notes). Its services are those of its projects, chosen there. The code an import gave it is kept, not shown.
const EMPTY={name:'',contact:'',phone:'',email:'',notes:''};
type Drive=CustomerRecord['drive'];
export function CustomerForm({id,onClose,onSaved,onChanged}:{id:string|null;onClose:()=>void;onSaved:(id:string)=>void;onChanged?:()=>void}){
 const [form,setForm]=useState({...EMPTY});const [loading,setLoading]=useState(!!id);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const [loaded,setLoaded]=useState(!id);
 const [tags,setTags]=useState<(CustomerTag|{id?:undefined;name:string;color?:undefined})[]>([]);const [tagText,setTagText]=useState('');
 // Linking a Drive folder is for those given Drive; others edit the rest of the record.
 const mayDrive=useStore(s=>s.pages).includes('workspace');
 const [drive,setDrive]=useState<Drive>(null);const [link,setLink]=useState('');const [picked,setPicked]=useState<Loc|null>(null);const [picking,setPicking]=useState(false);const [driveBusy,setDriveBusy]=useState(false);
 const [status,setStatus]=useState('');const [categoryId,setCategoryId]=useState('');const [categories,setCategories]=useState<{id:string;name:string;active:number}[]>([]);
 // A new customer starts at the first status in use (changeable here), as the server does when none is sent.
 const statuses=useCustomerStatuses();
 const [sourceId,setSourceId]=useState('');const [sources,setSources]=useState<{id:string;name:string;active:number}[]>([]);
 const [managerId,setManagerId]=useState('');const [managers,setManagers]=useState<{id:string;name:string;email:string}[]>([]);
 const adopt=(r:CustomerRecord)=>{
  setForm({name:r.name,contact:r.contact,phone:r.phone,email:r.email,notes:r.notes});
  setDrive(r.drive||null);
  setStatus(r.status||'');
  setCategoryId(r.category?.id||'');setTags(r.tags?.length?r.tags:r.category?[r.category]:[]);
  setSourceId(r.source?.id||'');
  const mgr=r.manager||r.owner;
  setManagerId(mgr?.id||'');
  if(r.category){const category=r.category;setCategories(c=>c.some(x=>x.id===category.id)?c:[...c,{...category,active:0}]);}
  if(r.source){const source=r.source;setSources(s=>s.some(x=>x.id===source.id)?s:[...s,{...source,active:0}]);}
  if(mgr){setManagers(m=>m.some(x=>x.id===mgr.id)?m:[...m,{...mgr,email:''}]);}
 };
 useEffect(()=>{
  let active=true;
  setStatus('');setCategoryId('');setCategories([]);setSourceId('');setSources([]);setManagerId('');setManagers([]);
  api.customerClassifications().then(c=>{if(active)setCategories(existing=>[...c,...existing.filter(x=>!c.some(n=>n.id===x.id))]);},e=>{if(active)setError(e.message);});
  api.customerSources().then(s=>{if(active)setSources(existing=>[...s,...existing.filter(x=>!s.some(n=>n.id===x.id))]);},()=>{});
  api.customerManagers().then(m=>{if(active)setManagers(existing=>[...m,...existing.filter(x=>!m.some(n=>n.id===x.id))]);},()=>{});
  setForm({...EMPTY});setTags([]);setTagText('');setDrive(null);setLink('');setPicked(null);setPicking(false);setError('');setLoading(!!id);setLoaded(!id);
  if(id)api.customerRecord(id).then(r=>{if(active){adopt(r);setLoaded(true);setLoading(false);}},e=>{if(active){setError(e.message);setLoading(false);}});
  return()=>{active=false;};
 },[id]);
 // A new customer whose name looks like one already there (marks, case and spaces aside, or one inside the other:
 // "TurboTint" and "Turbo Tint Marietta") is pointed out before it is made; it can still be made.
 const [known,setKnown]=useState<{id:string;name:string}[]>([]);
 useEffect(()=>{if(!id)api.customersAll().then(setKnown,()=>{});},[id]);
 const twins=(()=>{
  const key=(x:string)=>x.toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/[^a-z0-9]/g,'');
  const k=key(form.name);
  return id||k.length<4?[]:known.filter(c=>{const o=key(c.name);return o===k||(o.length>=4&&(o.includes(k)||k.includes(o)));}).slice(0,3);
 })();
 // After the reset above, so it is not cleared by it.
 useEffect(()=>{if(!id&&!status&&statuses.length)setStatus(statuses.find(s=>s.active)?.id||'');},[id,statuses]); // eslint-disable-line react-hooks/exhaustive-deps
 const pendingUpdate=busy||driveBusy;
 /** A typed tag: the one of that name in the list (any case), else a new one made when the customer is saved. */
 const addTag=(text:string)=>{
  const name=text.trim().replace(/\s+/g,' ');setTagText('');
  if(!name||tags.some(t=>t.name.toLocaleLowerCase('vi')===name.toLocaleLowerCase('vi')))return;
  if(tags.length>=20)return void toast('Tối đa 20 tag',true);
  const known=categories.find(c=>c.name.toLocaleLowerCase('vi')===name.toLocaleLowerCase('vi'));
  setTags([...tags,known?{id:known.id,name:known.name,color:(known as any).color||'#64748b'}:{name}]);
 };
 const addSource=async()=>{
  const name=prompt('Tên nguồn khách hàng mới (vd. TikTok, Hội chợ…)')?.trim();
  if(!name)return;
  try{const s=await api.addCustomerSource(name);setSources(list=>[...list.filter(x=>x.id!==s.id),s]);setSourceId(s.id);}catch(e:any){toast(e.message,true);}
 };
 const save=async(e:React.FormEvent)=>{e.preventDefault();if(pendingUpdate||loading||!loaded)return;setBusy(true);setError('');try{
  if(id){await api.saveCustomerRecord(id,{...form,status:status||null,tags:tags.map(t=>t.id?{id:t.id}:{name:t.name}),sourceId:sourceId||null,managerId:managerId||null});onSaved(id);return;}
  const r=await api.createCustomer({...form,databaseOnly:true,status:status||null,tags:tags.map(t=>t.id?{id:t.id}:{name:t.name}),sourceId:sourceId||null,managerId:managerId||null});
  // The folder chosen while adding is linked once the customer exists; the customer is kept if that fails.
  if(link.trim()||picked)await (picked?api.linkCustomerFolder(r.id,picked):api.linkCustomerDrive(r.id,link.trim())).catch(e=>toast(`Đã tạo khách hàng nhưng chưa liên kết được Drive: ${e.message}`,true));
  onSaved(r.id);
 }catch(e:any){setError(e.message);}finally{setBusy(false);}};
 const field=(key:keyof typeof EMPTY,label:string,type='text',maxLength=200)=><label className="tm-field">{label}<input className="bk-in" type={type} required={key==='name'} autoFocus={key==='name'} maxLength={maxLength} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>;
 // Drive changes on an existing customer apply at once (they are not part of Lưu thay đổi).
 const driveAct=async(fn:()=>Promise<unknown>,done:string)=>{if(!id)return;setDriveBusy(true);try{await fn();const r=await api.customerRecord(id);setDrive(r.drive||null);setLink('');onChanged?.();toast(done);}catch(e:any){toast(e.message,true);}finally{setDriveBusy(false);}};
 const linkByUrl=()=>{if(!link.trim())return;if(id)void driveAct(()=>api.linkCustomerDrive(id,link.trim()),'Đã liên kết thư mục Drive');};
 const unlink=()=>{if(drive&&confirm(`Gỡ liên kết thư mục “${drive.label}” khỏi khách hàng?\nThư mục và file trên Drive vẫn giữ nguyên. Tab Drive của khách hàng sẽ trống cho tới khi liên kết lại.`))void driveAct(()=>api.unlinkCustomerDrive(id!),'Đã gỡ liên kết Drive');};
 const pending=picked?(picked.kind==='gdrive'?picked.label||picked.id:picked.dir):'';
 return <div className="cm-back" onMouseDown={e=>{if(e.target===e.currentTarget&&!pendingUpdate)onClose();}}><form className="crm-new crm-new-wide" onSubmit={save} role="dialog" aria-modal="true" aria-label={id?'Sửa khách hàng':'Thêm khách hàng'}><header className="crm-form-head"><h2>{id?'Sửa khách hàng':'Thêm khách hàng'}</h2><button type="button" className="bd-icon" disabled={pendingUpdate} onClick={onClose} aria-label="Đóng"><Icon name="x" size={16}/></button></header>{error&&<p className="note err" role="alert">{error}</p>}<fieldset disabled={pendingUpdate||loading||!loaded}>{loading?<BrandLoading label="Đang tải…"/>:<>
  <CustomerStages status={status} onChange={setStatus}/>
  {field('name','Tên khách hàng')}{twins.length>0&&<p className="note warn" role="status">Có thể trùng với: {twins.map(c=>c.name).join(', ')}. Kiểm tra trước khi tạo.</p>}<div className="crm-form-grid">{field('contact','Người liên hệ')}<label className="tm-field">Người phụ trách<select className="bk-in" value={managerId} onChange={e=>setManagerId(e.target.value)}><option value="">Chưa chọn người phụ trách</option>{managers.map(m=><option key={m.id} value={m.id}>{m.name}{m.email?` (${m.email})`:''}</option>)}</select></label></div>
  <div className="crm-form-grid">{field('email','Email','email',320)}{field('phone','Điện thoại','tel',60)}</div>
  <div className="crm-form-grid">
   <div className="tm-field crm-tags"><span>Tag</span>
    <div className="crm-tag-box">{tags.map(t=><span key={t.id||'new:'+t.name} className="crm-tag" style={{['--c' as any]:t.color||'#64748b'}}>{t.name}<button type="button" onClick={()=>setTags(tags.filter(x=>x!==t))} aria-label={`Bỏ tag ${t.name}`}><Icon name="x" size={11}/></button></span>)}
     <input list="crm-tag-list" value={tagText} maxLength={40} onChange={e=>setTagText(e.target.value)} onBlur={()=>addTag(tagText)} onKeyDown={e=>{if(e.key==='Enter'||e.key===','){e.preventDefault();addTag(tagText);}else if(e.key==='Backspace'&&!tagText&&tags.length)setTags(tags.slice(0,-1));}} placeholder={tags.length?'Thêm tag…':'Gõ tag rồi Enter'} aria-label="Thêm tag"/>
     <datalist id="crm-tag-list">{categories.filter(c=>c.active&&!tags.some(t=>t.id===c.id)).map(c=><option key={c.id} value={c.name}/>)}</datalist></div></div>
   <label className="tm-field">Nguồn khách hàng<select className="bk-in" value={sourceId} onChange={e=>{if(e.target.value==='+new')void addSource();else setSourceId(e.target.value);}}><option value="">Chưa rõ nguồn</option>{sources.filter(s=>s.active||s.id===sourceId).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}<option value="+new">+ Thêm nguồn mới…</option></select></label>
  </div>
  {mayDrive&&<div className="tm-field crm-drive"><span>Drive</span>
   {id&&drive?<div className="crm-drive-on"><Icon name="folder" size={18}/><div><b>{drive.label}</b>{drive.url&&<a href={drive.url} target="_blank" rel="noreferrer">Mở trên Drive</a>}</div><button type="button" className="btn btn-gray btn-sm" disabled={driveBusy} onClick={unlink}><Icon name="x" size={13}/>Gỡ liên kết</button></div>
    :pending?<div className="crm-drive-on"><Icon name="folder" size={18}/><div><b>{pending}</b><small>Liên kết khi tạo khách hàng</small></div><button type="button" className="btn btn-gray btn-sm" onClick={()=>setPicked(null)}><Icon name="x" size={13}/>Bỏ chọn</button></div>
    :<small className="note">{id?'Chưa liên kết thư mục Drive.':'Có thể để trống và liên kết sau.'}</small>}
   {!pending&&<div className="crm-inline-add"><input className="bk-in" type="url" disabled={driveBusy} value={link} onChange={e=>setLink(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();linkByUrl();}}} placeholder={drive?'Dán link thư mục khác để đổi':'Dán link thư mục Google Drive'} aria-label="Link thư mục Google Drive"/>{id&&<button type="button" className="btn btn-gray btn-sm" disabled={driveBusy||!link.trim()} onClick={linkByUrl}>{drive?'Đổi':'Liên kết'}</button>}<button type="button" className="btn btn-gray btn-sm" disabled={driveBusy} onClick={()=>setPicking(true)}><Icon name="folder" size={13}/>Chọn thư mục</button></div>}
  </div>}
  <label className="tm-field">Khác<textarea className="bk-in" rows={4} maxLength={20000} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="Ghi chú, tên khác, thông tin thêm về khách hàng"/></label>
 </>}</fieldset><footer><button type="button" className="btn btn-gray" disabled={pendingUpdate} onClick={onClose}>Huỷ</button><button className="btn btn-primary" disabled={pendingUpdate||loading||!loaded||!form.name.trim()}>{busy?'Đang lưu…':id?'Lưu thay đổi':'Tạo khách hàng'}</button></footer></form>
 <FolderPicker open={picking} title="Chọn thư mục khách hàng" confirmLabel="Liên kết thư mục này" onClose={()=>setPicking(false)} onPick={loc=>{setPicking(false);if(id)void driveAct(()=>api.linkCustomerFolder(id,loc),'Đã liên kết thư mục Drive');else{setPicked(loc);setLink('');}}}/>
 </div>;
}
