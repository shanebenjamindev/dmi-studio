import {CustomerStages} from './CustomerStages';
import {BrandLoading} from './BrandLoading';
import {useEffect,useState} from 'react';
import {api} from '../api';
import {canDo,toast,useStore} from '../store';
import type {CustomerRecord,CustomerTag,Loc,ServiceRef} from '../types';
import {Icon} from './ui';
import {FolderPicker} from './FolderPicker';

// A customer's details: contact, tags (typed: one in the list, or a new one that joins it), where it came from (a new
// source can be added here), Nhu cầu (the services it wants, from Quản trị › Dịch vụ), its Drive folder (a pasted link or
// one picked; unlinking keeps the folder on Drive) and Khác (notes). The code an import gave it is kept, not shown.
const EMPTY={name:'',contact:'',phone:'',email:'',notes:''};
type Drive=CustomerRecord['drive'];
export function CustomerForm({id,onClose,onSaved,onChanged}:{id:string|null;onClose:()=>void;onSaved:(id:string)=>void;onChanged?:()=>void}){
 const [form,setForm]=useState({...EMPTY});const [loading,setLoading]=useState(!!id);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const [loaded,setLoaded]=useState(!id);const [serviceBusy,setServiceBusy]=useState(false);
 const [tags,setTags]=useState<(CustomerTag|{id?:undefined;name:string;color?:undefined})[]>([]);const [tagText,setTagText]=useState('');
 const [needs,setNeeds]=useState<string[]>([]);const [catalog,setCatalog]=useState<ServiceRef[]>([]);const [newService,setNewService]=useState('');
 // Linking a Drive folder is for those given Drive; others edit the rest of the record.
 const mayDrive=useStore(s=>s.pages).includes('workspace');
 const [drive,setDrive]=useState<Drive>(null);const [link,setLink]=useState('');const [picked,setPicked]=useState<Loc|null>(null);const [picking,setPicking]=useState(false);const [driveBusy,setDriveBusy]=useState(false);
 const [status,setStatus]=useState('');const [categoryId,setCategoryId]=useState('');const [categories,setCategories]=useState<{id:string;name:string;active:number}[]>([]);
 const [sourceId,setSourceId]=useState('');const [sources,setSources]=useState<{id:string;name:string;active:number}[]>([]);
 const [managerId,setManagerId]=useState('');const [managers,setManagers]=useState<{id:string;name:string;email:string}[]>([]);
 const mayAddService=canDo('services.create');
 const adopt=(r:CustomerRecord)=>{
  setForm({name:r.name,contact:r.contact,phone:r.phone,email:r.email,notes:r.notes});
  setNeeds((r.needs||[]).map(n=>n.id));
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
  setForm({...EMPTY});setTags([]);setTagText('');setNeeds([]);setCatalog([]);setDrive(null);setLink('');setPicked(null);setPicking(false);setError('');setNewService('');setLoading(!!id);setLoaded(!id);
  api.serviceCatalog().then(c=>{if(active)setCatalog(existing=>[...c,...existing.filter(n=>!c.some(x=>x.id===n.id))]);},()=>{});
  if(id)api.customerRecord(id).then(r=>{if(active){adopt(r);setCatalog(c=>[...c,...(r.needs||[]).filter(n=>!c.some(x=>x.id===n.id))]);setLoaded(true);setLoading(false);}},e=>{if(active){setError(e.message);setLoading(false);}});
  return()=>{active=false;};
 },[id]);
 const pendingUpdate=busy||driveBusy||serviceBusy;
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
  if(id){await api.saveCustomerRecord(id,{...form,needs,status:status||null,tags:tags.map(t=>t.id?{id:t.id}:{name:t.name}),sourceId:sourceId||null,managerId:managerId||null});onSaved(id);return;}
  const r=await api.createCustomer({...form,databaseOnly:true,needs,status:status||null,tags:tags.map(t=>t.id?{id:t.id}:{name:t.name}),sourceId:sourceId||null,managerId:managerId||null});
  // The folder chosen while adding is linked once the customer exists; the customer is kept if that fails.
  if(link.trim()||picked)await (picked?api.linkCustomerFolder(r.id,picked):api.linkCustomerDrive(r.id,link.trim())).catch(e=>toast(`Đã tạo khách hàng nhưng chưa liên kết được Drive: ${e.message}`,true));
  onSaved(r.id);
 }catch(e:any){setError(e.message);}finally{setBusy(false);}};
 const field=(key:keyof typeof EMPTY,label:string,type='text',maxLength=200)=><label className="tm-field">{label}<input className="bk-in" type={type} required={key==='name'} autoFocus={key==='name'} maxLength={maxLength} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>;
 // Drive changes on an existing customer apply at once (they are not part of Lưu thay đổi).
 const driveAct=async(fn:()=>Promise<unknown>,done:string)=>{if(!id)return;setDriveBusy(true);try{await fn();const r=await api.customerRecord(id);setDrive(r.drive||null);setLink('');onChanged?.();toast(done);}catch(e:any){toast(e.message,true);}finally{setDriveBusy(false);}};
 const linkByUrl=()=>{if(!link.trim())return;if(id)void driveAct(()=>api.linkCustomerDrive(id,link.trim()),'Đã liên kết thư mục Drive');};
 const unlink=()=>{if(drive&&confirm(`Gỡ liên kết thư mục “${drive.label}” khỏi khách hàng?\nThư mục và file trên Drive vẫn giữ nguyên. Tab Drive của khách hàng sẽ trống cho tới khi liên kết lại.`))void driveAct(()=>api.unlinkCustomerDrive(id!),'Đã gỡ liên kết Drive');};
 const addService=async()=>{const name=newService.trim();if(!name||pendingUpdate)return;setServiceBusy(true);try{const s=await api.createService(name);setCatalog(c=>[...c,s]);setNeeds(n=>n.includes(s.id)?n:[...n,s.id]);setNewService('');}catch(e:any){toast(e.message,true);}finally{setServiceBusy(false);}};
 const groups=[...new Set(catalog.map(s=>s.category||''))];
 const pending=picked?(picked.kind==='gdrive'?picked.label||picked.id:picked.dir):'';
 return <div className="cm-back" onMouseDown={e=>{if(e.target===e.currentTarget&&!pendingUpdate)onClose();}}><form className="crm-new crm-new-wide" onSubmit={save} role="dialog" aria-modal="true" aria-label={id?'Sửa khách hàng':'Thêm khách hàng'}><header className="crm-form-head"><h2>{id?'Sửa khách hàng':'Thêm khách hàng'}</h2><button type="button" className="bd-icon" disabled={pendingUpdate} onClick={onClose} aria-label="Đóng"><Icon name="x" size={16}/></button></header>{error&&<p className="note err" role="alert">{error}</p>}<fieldset disabled={pendingUpdate||loading||!loaded}>{loading?<BrandLoading label="Đang tải…"/>:<>
  <CustomerStages status={status} onChange={setStatus}/>
  {field('name','Tên khách hàng')}<div className="crm-form-grid">{field('contact','Người liên hệ')}<label className="tm-field">Người phụ trách<select className="bk-in" value={managerId} onChange={e=>setManagerId(e.target.value)}><option value="">Chưa chọn người phụ trách</option>{managers.map(m=><option key={m.id} value={m.id}>{m.name}{m.email?` (${m.email})`:''}</option>)}</select></label></div>
  <div className="crm-form-grid">{field('email','Email','email',320)}{field('phone','Điện thoại','tel',60)}</div>
  <div className="crm-form-grid">
   <div className="tm-field crm-tags"><span>Tag</span>
    <div className="crm-tag-box">{tags.map(t=><span key={t.id||'new:'+t.name} className="crm-tag" style={{['--c' as any]:t.color||'#64748b'}}>{t.name}<button type="button" onClick={()=>setTags(tags.filter(x=>x!==t))} aria-label={`Bỏ tag ${t.name}`}><Icon name="x" size={11}/></button></span>)}
     <input list="crm-tag-list" value={tagText} maxLength={40} onChange={e=>setTagText(e.target.value)} onBlur={()=>addTag(tagText)} onKeyDown={e=>{if(e.key==='Enter'||e.key===','){e.preventDefault();addTag(tagText);}else if(e.key==='Backspace'&&!tagText&&tags.length)setTags(tags.slice(0,-1));}} placeholder={tags.length?'Thêm tag…':'Gõ tag rồi Enter'} aria-label="Thêm tag"/>
     <datalist id="crm-tag-list">{categories.filter(c=>c.active&&!tags.some(t=>t.id===c.id)).map(c=><option key={c.id} value={c.name}/>)}</datalist></div></div>
   <label className="tm-field">Nguồn khách hàng<select className="bk-in" value={sourceId} onChange={e=>{if(e.target.value==='+new')void addSource();else setSourceId(e.target.value);}}><option value="">Chưa rõ nguồn</option>{sources.filter(s=>s.active||s.id===sourceId).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}<option value="+new">+ Thêm nguồn mới…</option></select></label>
  </div>
  <div className="tm-field crm-needs"><span>Nhu cầu</span>
   {needs.length>0&&<div className="crm-need-chips">{needs.map(n=>{const s=catalog.find(x=>x.id===n);return <span key={n} className="crm-need-chip">{s?.name||'Dịch vụ'}<button type="button" onClick={()=>setNeeds(needs.filter(x=>x!==n))} aria-label={`Bỏ ${s?.name||'dịch vụ'}`}><Icon name="x" size={12}/></button></span>;})}</div>}
   {catalog.some(s=>!needs.includes(s.id))&&<select className="bk-in" value="" aria-label="Thêm dịch vụ khách hàng muốn" onChange={e=>{if(e.target.value)setNeeds([...needs,e.target.value]);}}><option value="">{needs.length?'Thêm dịch vụ khác…':'Chọn dịch vụ khách hàng muốn…'}</option>{groups.map(g=>{const opts=catalog.filter(s=>(s.category||'')===g&&!needs.includes(s.id)).map(s=><option key={s.id} value={s.id}>{s.name}</option>);return g?<optgroup key={g} label={g}>{opts}</optgroup>:opts;})}</select>}
   {mayAddService?<div className="crm-inline-add"><input className="bk-in" maxLength={200} value={newService} onChange={e=>setNewService(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void addService();}}} placeholder="Dịch vụ chưa có trong danh mục"/><button type="button" className="btn btn-gray btn-sm" disabled={!newService.trim()} onClick={()=>void addService()}><Icon name="plus" size={13}/>Thêm vào danh mục</button></div>
    :!catalog.length&&<small className="note">Danh mục dịch vụ còn trống. Nhờ quản trị thêm trong Quản trị › Dịch vụ.</small>}
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
