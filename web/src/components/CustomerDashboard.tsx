import {ReadingTabs} from './ReadingLayout';
import {TextLinks} from './TextLinks';
import {BrandLoading} from './BrandLoading';
import {useEffect,useRef,useState} from 'react';import {Icon,IconButton,Menu} from './ui';import type {CustomerRecord} from '../types';
import {api} from '../api';
import {toast} from '../store';
import {GroupedList,byKey} from './GroupedList';
import {useCustomerStatuses,type CustomerStatusOption} from './useCustomerStatuses';

// The Customers page's first screen, kept to one row of controls: add, search, filters (one button), how to group, and
// three views: a list in groups, a Kanban (drag a card to change where the customer stands) and cards.
export type CustomerView='list'|'kanban'|'grid';type View=CustomerView;type GroupBy='status'|'category'|'source'|'manager'|'none';
const LS_VIEW='dms.customerView',LS_GROUP='dms.customerGroup';
const read=<T extends string>(k:string,ok:readonly T[],d:T):T=>{try{const v=localStorage.getItem(k) as T;return ok.includes(v)?v:d;}catch{return d;}};
const keep=(k:string,v:string)=>{try{localStorage.setItem(k,v);}catch{/* private mode */}};
const fold=(s:string)=>s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/g,'d');
const EMPTY={need:'',status:'',category:'',source:'',manager:'',drive:''};

export function CustomerDashboard({customers,selected=null,loading,error,manage,view:controlledView,onViewChange,onOpen,onEdit,onAdd,onImport,onDrive,onRefresh}:{customers:CustomerRecord[];selected?:string|null;loading:boolean;error:string;manage:boolean;view?:View;onViewChange?:(v:View)=>void;onOpen:(id:string|null)=>void;onEdit?:(id:string)=>void;onAdd:()=>void;onImport:()=>void;onDrive:()=>void;onRefresh:()=>void}){
 const statuses=useCustomerStatuses();
 const STATUS_ORDER=statuses.map(s=>s.id),CUSTOMER_STATUS=Object.fromEntries(statuses.map(s=>[s.id,s.name])),STATUS_COLOR=Object.fromEntries(statuses.map(s=>[s.id,s.color]));
 const [catalog,setCatalog]=useState<{id:string;name:string;color:string;active:number}[]>([]);
 useEffect(()=>{let active=true;api.customerClassifications().then(c=>{if(active)setCatalog(c);},e=>toast(e.message,true));return()=>{active=false;};},[]);
 const[q,setQ]=useState('');
 const[selectedIds,setSelectedIds]=useState<string[]>([]);
 const[busyId,setBusyId]=useState<string|null>(null);
 const[innerView,setViewState]=useState<View>(()=>read(LS_VIEW,['list','kanban','grid'] as const,'list'));
 const view=controlledView??innerView;
 const[groupBy,setGroupByState]=useState<GroupBy>(()=>read(LS_GROUP,['status','category','source','manager','none'] as const,'status'));
 const setView=(v:View)=>{setViewState(v);keep(LS_VIEW,v);onViewChange?.(v);};const setGroupBy=(g:GroupBy)=>{setGroupByState(g);keep(LS_GROUP,g);};
 const[f,setF]=useState({...EMPTY}),[filters,setFilters]=useState(false);
 // A status changed on the Kanban shows at once, before the list comes back.
 const[moved,setMoved]=useState<Record<string,Partial<CustomerRecord>>>({});
 useEffect(()=>setMoved({}),[customers]);
 const all=customers.map(c=>c.id in moved?{...c,...moved[c.id]}:c);
 const options=<T extends {id:string;name:string}>(pick:(c:CustomerRecord)=>T[]|T|null|undefined)=>[...new Map(all.flatMap(c=>{const v=pick(c);return v?(Array.isArray(v)?v:[v]):[];}).map(v=>[v.id,v])).values()].sort((a,b)=>a.name.localeCompare(b.name,'vi'));
 const needs=options(c=>c.needs),categories=options(c=>c.tags?.length?c.tags:c.category),sources=options(c=>c.source),managers=options(c=>c.manager||c.owner);
 const words=fold(q).split(/\s+/).filter(Boolean),active=Object.values(f).filter(Boolean).length;
 const rows=all.filter(c=>{const text=fold(`${c.name} ${c.contact} ${c.email} ${c.phone} ${(c.needs||[]).map(n=>n.name).join(' ')} ${(c.manager||c.owner)?.name||''} ${(c.tags||[]).map(t=>t.name).join(' ')||c.category?.name||''} ${c.source?.name||''}`);return words.every(w=>text.includes(w));})
  .filter(c=>!f.need||(f.need==='none'?!c.needs?.length:c.needs?.some(n=>n.id===f.need)))
  .filter(c=>!f.status||(f.status==='none'?!c.status:c.status===f.status))
  .filter(c=>!f.category||(f.category==='none'?!c.category:(c.tags?.length?c.tags.some(t=>t.id===f.category):c.category?.id===f.category)))
  .filter(c=>!f.source||(f.source==='none'?!c.source:c.source?.id===f.source))
  .filter(c=>!f.manager||(f.manager==='none'?!(c.manager||c.owner):(c.manager||c.owner)?.id===f.manager))
  .filter(c=>!f.drive||(f.drive==='yes'?c.hasDrive:!c.hasDrive))
  .sort((a,b)=>a.name.localeCompare(b.name,'vi'));
 const groups=(groupBy==='status'?byKey(rows,c=>c.status?{key:c.status,label:CUSTOMER_STATUS[c.status]||c.status,color:STATUS_COLOR[c.status]}:null,'Chưa đặt trạng thái',STATUS_ORDER)
  :groupBy==='category'?byKey(rows,c=>c.category?{key:c.category.id,label:c.category.name,color:c.category.color}:null,'Chưa phân loại')
  :groupBy==='source'?byKey(rows,c=>c.source?{key:c.source.id,label:c.source.name,color:c.source.color}:null,'Chưa rõ nguồn')
  :groupBy==='manager'?byKey(rows,c=>{const m=c.manager||c.owner;return m?{key:m.id,label:m.name}:null;},'Chưa có người phụ trách')
  :[{key:'all',label:'Tất cả khách hàng',rows}]).map(g=>({...g,onAdd:manage?onAdd:undefined}));
 const saving=useRef(new Set<string>());
 const setStatus=async(c:CustomerRecord,value:string|null)=>{
  if(!c.canManage||saving.current.has(c.id))return;
  const category=groupBy==='category';
  if((category?c.category?.id||null:c.status||null)===value)return;
  saving.current.add(c.id);
  // By tag: the column's tag takes the place of the one it was under; its other tags stay.
  const tags=[...(value?[{id:value}]:[]),...(c.tags||[]).filter(t=>t.id!==value&&t.id!==c.category?.id).map(t=>({id:t.id}))];
  setMoved(m=>({...m,[c.id]:category?{category:catalog.find(x=>x.id===value)||null}:{status:value}}));
  try{await api.saveCustomerRecord(c.id,category?{tags}:{status:value});onRefresh();}catch(e:any){setMoved(m=>{const{[c.id]:_,...rest}=m;return rest;});toast(e.message,true);}finally{saving.current.delete(c.id);}
 };
 const sel=(k:keyof typeof EMPTY,label:string,none:string,list:{id:string;name:string}[])=><label className="cd-filter"><span>{label}</span><select className="bk-in" value={f[k]} onChange={e=>setF({...f,[k]:e.target.value})}><option value="">Tất cả</option><option value="none">{none}</option>{list.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>;
 const totals=`${customers.length} khách hàng · ${customers.reduce((n,c)=>n+(c.projects||0),0)} dự án · ${customers.reduce((n,c)=>n+(c.completed||0),0)}/${customers.reduce((n,c)=>n+(c.tasks||0),0)} công việc xong (từ trước tới nay)`;
 const ordered=groups.flatMap(g=>g.rows);
 const deletableRows=rows.filter(c=>!!c.canDelete);
 const allChecked=deletableRows.length>0&&deletableRows.every(c=>selectedIds.includes(c.id));
 const toggleAll=(checked:boolean)=>setSelectedIds(checked?Array.from(new Set([...selectedIds,...deletableRows.map(c=>c.id)])):selectedIds.filter(id=>!deletableRows.some(c=>c.id===id)));
 const toggleOne=(c:CustomerRecord)=>setSelectedIds(ids=>ids.includes(c.id)?ids.filter(x=>x!==c.id):[...ids,c.id]);
 const removeCustomer=async(c:CustomerRecord)=>{
  if(!confirm(`Xoá khách hàng “${c.name}”? Giữ nguyên dự án, công việc, báo cáo và file Drive.`))return;
  setBusyId(c.id);
  try{await api.deleteCustomer(c.id);if(selected===c.id)onOpen(null);setSelectedIds(ids=>ids.filter(x=>x!==c.id));onRefresh();toast(`Đã xoá khách hàng “${c.name}”.`);}catch(e:any){toast(e.message,true);}finally{setBusyId(null);}
 };
 const bulkDelete=async()=>{
  if(!selectedIds.length)return;
  if(!confirm(`Xoá ${selectedIds.length} khách hàng đã chọn? Giữ nguyên dự án, công việc, báo cáo và file Drive.`))return;
  setBusyId('bulk');
  try{const r=await api.bulkDeleteCustomers(selectedIds);if(selected&&selectedIds.includes(selected))onOpen(null);setSelectedIds([]);onRefresh();toast(`Đã xoá ${r.deleted} khách hàng.`);}catch(e:any){toast(e.message,true);}finally{setBusyId(null);}
 };
 return <section className="cd-dashboard cd-min">
  <header className="tk-head"><span className="tk-head-ico"><Icon name="users" size={20}/></span><div className="tk-head-main"><h1>Khách hàng</h1>
   <ReadingTabs label="Cách xem khách hàng" value={view} items={[{value:'list' as View,label:'Danh sách',icon:'list'},{value:'kanban' as View,label:'Kanban',icon:'boards'},{value:'grid' as View,label:'Thẻ',icon:'grid'}]} onChange={v=>setView(v)}/></div>
   {!selected&&<span className="cd-totals">{loading?'…':totals}</span>}
   <Menu label="Thêm thao tác" items={[{label:'Làm mới',icon:'refresh',onClick:onRefresh},{label:'Import Excel',icon:'sheet',onClick:onImport,hidden:!manage},{label:'Thêm khách kèm thư mục Drive',icon:'folder',onClick:onDrive,hidden:!manage}]}/>
  </header>
  <div className="tk-toolbar">
   {manage&&<button className="tk-new" onClick={onAdd}><Icon name="plus" size={15}/>Thêm mới</button>}
   {selectedIds.length>0&&<><button className="btn btn-sm cm-danger" disabled={busyId==='bulk'} onClick={()=>void bulkDelete()}><Icon name="trash" size={14}/>Xoá đã chọn ({selectedIds.length})</button><button className="btn btn-gray btn-sm" onClick={()=>setSelectedIds([])}>Bỏ chọn</button></>}
   <label className="tk-find"><Icon name="search" size={14}/><input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'&&q){e.stopPropagation();setQ('');}}} placeholder="Tìm tên, liên hệ, email, điện thoại, dịch vụ…" aria-label="Tìm khách hàng"/>{q&&<button type="button" className="tk-find-x" onClick={()=>setQ('')} aria-label="Xoá tìm kiếm" title="Xoá tìm kiếm"><Icon name="x" size={12}/></button>}</label>
   <button className={'tk-pick cd-filter-btn'+(active?' on':'')} onClick={()=>setFilters(!filters)} aria-expanded={filters}><Icon name="filter" size={14}/><span>Lọc</span>{active?` (${active})`:''}</button>
   {view!=='grid'&&<label className="tk-pick"><Icon name="layers" size={14}/><span>Nhóm theo:</span><select aria-label="Nhóm theo" value={groupBy} onChange={e=>setGroupBy(e.target.value as GroupBy)}><option value="status">Trạng thái</option><option value="category">Tag</option><option value="source">Nguồn</option><option value="manager">Người phụ trách</option>{view==='list'&&<option value="none">Không nhóm</option>}</select></label>}
   {!selected&&<span className="cd-count">{active||q?`${rows.length}/${customers.length}`:''}</span>}
  </div>
  {filters&&<div className="cd-filters">
   {sel('need','Dịch vụ','Chưa có dịch vụ',needs)}
   <label className="cd-filter"><span>Trạng thái</span><select className="bk-in" value={f.status} onChange={e=>setF({...f,status:e.target.value})}><option value="">Tất cả</option><option value="none">Chưa đặt</option>{STATUS_ORDER.map(s=><option key={s} value={s}>{CUSTOMER_STATUS[s]}</option>)}</select></label>
   {sel('category','Tag','Chưa gắn tag',categories)}{sel('source','Nguồn','Chưa rõ nguồn',sources)}{sel('manager','Phụ trách','Chưa có người phụ trách',managers)}
   <label className="cd-filter"><span>Drive</span><select className="bk-in" value={f.drive} onChange={e=>setF({...f,drive:e.target.value})}><option value="">Tất cả</option><option value="yes">Đã liên kết</option><option value="no">Chưa liên kết</option></select></label>
   {active>0&&<button className="btn btn-plain btn-sm" onClick={()=>setF({...EMPTY})}>Bỏ lọc</button>}
  </div>}
  {error?<p className="note err" role="alert">{error}</p>:loading?<BrandLoading label="Đang tải dữ liệu backend…"/>:!rows.length?<div className="crm-empty"><Icon name="users" size={36}/><h3>{q||active?'Không có khách phù hợp':'Chưa có khách hàng'}</h3><p>{q||active?'Thử từ khoá hoặc bộ lọc khác.':'Thêm khách hàng hoặc import Excel để bắt đầu.'}</p>{manage&&!q&&!active&&<button className="btn btn-primary" onClick={onAdd}>Thêm khách hàng</button>}</div>
  :selected?<div className="tk-reading-list">{groups.filter(g=>g.rows.length).map(g=><section key={g.key}><h3>{g.label}<span>{g.rows.length}</span></h3>{g.rows.map(c=><button key={c.id} id={'customer-row-'+c.id} className={'reading-list-row tk-reading-row crm-customer-row'+(selected===c.id?' selected':'')} aria-current={selected===c.id?'true':undefined} onClick={()=>onOpen(c.id)} onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const i=ordered.findIndex(x=>x.id===c.id),next=ordered[i+(e.key==='ArrowDown'?1:-1)];if(next){onOpen(next.id);document.getElementById('customer-row-'+next.id)?.focus();}}}}><span className="tk-reading-title">{c.name}</span><span className="tk-reading-project">{c.contact||c.email||(c.manager||c.owner)?.name||'Chưa có liên hệ'}</span><span className="tk-reading-meta"><span>{CUSTOMER_STATUS[c.status||'']||c.status||'Chưa đặt trạng thái'}</span><span>{c.projects||0} dự án · {c.tasks||0} việc</span></span></button>)}</section>)}</div>
  :view==='list'?<GroupedList foldKey={`dms.customerFold.${groupBy}`} groups={groups} nameLabel="Khách hàng" addLabel="Thêm khách hàng" onOpen={c=>onOpen(c.id)} selected={selected}
    check={deletableRows.length>0?{done:c=>selectedIds.includes(c.id),toggle:toggleOne,label:c=>`Chọn khách hàng “${c.name}”`,all:allChecked,toggleAll,canCheck:c=>!!c.canDelete}:undefined}
    name={c=><><b className="cd-name">{c.name}</b>{c.contact&&<small className="cd-contact">{c.contact}</small>}</>}
    columns={[
     {key:'phone',label:'Liên hệ',width:170,render:c=><span className="crm-sub-lines" onClick={e=>e.stopPropagation()}>{c.phone&&<a href={'tel:'+c.phone.replace(/[^+\d]/g,'')}>{c.phone}</a>}{c.email&&<TextLinks text={c.email}/>}{!c.phone&&!c.email&&'—'}</span>},
     {key:'tags',label:'Tag',width:150,render:c=><Tags c={c}/>},
     {key:'needs',label:'Dịch vụ',width:180,wide:true,render:c=>c.needs?.length?<span className="crm-need-chips">{c.needs.map(n=><span key={n.id} className="crm-need-chip plain">{n.name}</span>)}</span>:'—'},
     ...(groupBy==='status'?[]:[{key:'status',label:'Trạng thái',width:140,render:(c:CustomerRecord)=>c.status?<span className="crm-pill" style={{['--c' as any]:STATUS_COLOR[c.status]}}>{CUSTOMER_STATUS[c.status]||c.status}</span>:'—'}]),
     ...(groupBy==='manager'?[]:[{key:'manager',label:'Phụ trách',width:130,render:(c:CustomerRecord)=>(c.manager||c.owner)?.name||'—'}]),
     {key:'tasks',label:'Công việc',width:130,render:c=><span className="cd-progress compact"><progress max={c.tasks||1} value={c.completed||0}/><small>{c.completed||0}/{c.tasks||0} · {c.projects||0} dự án</small></span>},
     {key:'drive',label:'Drive',width:90,render:c=>c.hasDrive?<span className="crm-pill ok">Đã liên kết</span>:<span className="crm-pill">Chưa</span>},
     // Kept at the right edge, so editing and deleting stay in reach however wide the other columns are.
     {key:'actions',label:'Thao tác',width:84,end:true,render:c=>(c.canManage||c.canDelete)?<span className="crm-row-actions" onClick={e=>e.stopPropagation()}>{c.canManage&&onEdit&&<IconButton icon="edit" label={`Sửa ${c.name}`} size={16} disabled={busyId===c.id} onClick={()=>onEdit(c.id)}/>}{c.canDelete&&<IconButton icon="trash" label={`Xoá ${c.name}`} size={16} danger disabled={busyId===c.id} onClick={()=>void removeCustomer(c)}/>}</span>:null},
    ]}/>
  :view==='kanban'?<Kanban groups={groupBy==='category'?[...catalog.filter(c=>c.active||groups.some(g=>g.key===c.id)).map(c=>groups.find(g=>g.key===c.id)||{key:c.id,label:c.name,color:c.color,rows:[]}),...groups.filter(g=>g.key!=='_none'&&!catalog.some(c=>c.id===g.key)),groups.find(g=>g.key==='_none')||{key:'_none',label:'Chưa phân loại',rows:[]}]:groups} statuses={statuses} byStatus={groupBy==='status'} movable={groupBy==='status'||groupBy==='category'} onOpen={onOpen} onMove={setStatus}/>
  :<div className="cd-cards">{rows.map(c=><div key={c.id} className="cd-customer" role="button" tabIndex={0} onClick={()=>onOpen(c.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onOpen(c.id);}}}><header><span className="cd-monogram">{c.name.split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase()}</span>{c.canDelete?<span onClick={e=>e.stopPropagation()}><input type="checkbox" checked={selectedIds.includes(c.id)} onChange={()=>toggleOne(c)} aria-label={`Chọn ${c.name}`}/></span>:<Icon name="right" size={16}/>}</header><h3>{c.name}</h3><p>{c.contact||c.email||(c.manager||c.owner)?.name||'Chưa có thông tin liên hệ'}</p><div className="cd-card-stats"><span><b>{c.projects||0}</b>Dự án</span><span><b>{c.tasks||0}</b>Công việc</span></div><div className="cd-progress"><progress max={c.tasks||1} value={c.completed||0}/><small>{c.completed||0}/{c.tasks||0} hoàn thành</small></div><footer><span><Icon name="folder" size={12}/>{c.hasDrive?'Đã liên kết Drive':'Chưa liên kết Drive'}</span>{(c.canManage||c.canDelete)?<span className="crm-campaign-actions" onClick={e=>e.stopPropagation()}>{c.canManage&&onEdit&&<button type="button" className="btn btn-gray btn-sm" disabled={busyId===c.id} onClick={()=>onEdit(c.id)}>Sửa</button>}{c.canDelete&&<button type="button" className="btn btn-sm cm-danger" disabled={busyId===c.id} onClick={()=>void removeCustomer(c)}>Xoá</button>}</span>:<span>Xem chi tiết</span>}</footer></div>)}</div>}
 </section>;
}

/** The column of customers with no status (or tag) comes first while it holds any, so they are not off to the right
 *  past empty columns; empty, it stays last as a place to drop a card. */
const noneFirst=<T extends {key:string;rows:unknown[]}>(cols:T[])=>{const none=cols.find(c=>c.key==='_none');return none?.rows.length?[none,...cols.filter(c=>c!==none)]:cols;};
/** Columns of customers. Grouped by status, a card dragged to another column changes the customer's status (for the
 *  customers the person manages; the server checks it too). Every status shows, even an empty one, so cards can go there. */
function Kanban({groups,statuses,byStatus,movable,onOpen,onMove}:{groups:{key:string;label:string;color?:string;rows:CustomerRecord[]}[];statuses:CustomerStatusOption[];byStatus:boolean;movable:boolean;onOpen:(id:string)=>void;onMove:(c:CustomerRecord,status:string|null)=>void}){
 const dragging=useRef<CustomerRecord|null>(null),[over,setOver]=useState<string|null>(null);
 const cols=noneFirst(byStatus?[...statuses.filter(s=>s.active||groups.some(g=>g.key===s.id)).map(s=>groups.find(g=>g.key===s.id)||{key:s.id,label:s.name,color:s.color,rows:[]}),...groups.filter(g=>g.key!=='_none'&&!statuses.some(s=>s.id===g.key)),groups.find(g=>g.key==='_none')||{key:'_none',label:'Chưa đặt trạng thái',rows:[]}]:groups);
 const droppable=(key:string)=>movable&&(!byStatus||key==='_none'||!!statuses.find(s=>s.id===key)?.active);
 return <div className="cd-kanban">{cols.map(col=><section key={col.key} className={'cd-col'+(over===col.key?' over':'')}
   onDragOver={e=>{if(droppable(col.key)&&dragging.current){e.preventDefault();setOver(col.key);}}} onDragLeave={()=>setOver(null)}
   onDrop={e=>{e.preventDefault();setOver(null);const c=dragging.current;dragging.current=null;if(c&&droppable(col.key))onMove(c,col.key==='_none'?null:col.key);}}>
  <header>{col.color&&<i style={{background:col.color}}/>}<b>{col.label}</b><span>{col.rows.length}</span></header>
  <div className="cd-col-cards">{col.rows.map(c=><button key={c.id} className="cd-kcard" draggable={movable&&!!c.canManage} onDragStart={()=>{dragging.current=c;}} onDragEnd={()=>{dragging.current=null;setOver(null);}} onClick={()=>onOpen(c.id)} title={movable&&c.canManage?'Kéo sang cột khác để cập nhật nhóm':undefined}>
   <b>{c.name}</b><Tags c={c}/>{c.contact&&<small>{c.contact}</small>}
   {!!c.needs?.length&&<span className="crm-need-chips">{c.needs.slice(0,3).map(n=><span key={n.id} className="crm-need-chip plain">{n.name}</span>)}{c.needs.length>3&&<span className="crm-need-chip plain">+{c.needs.length-3}</span>}</span>}
   <footer><span>{(c.manager||c.owner)?.name||'Chưa có phụ trách'}</span><span>{c.completed||0}/{c.tasks||0} việc</span></footer>
  </button>)}{!col.rows.length&&<p className="cd-col-empty">{byStatus?'Kéo khách hàng vào đây':'Trống'}</p>}</div>
 </section>)}</div>;
}

/** A customer's tags as small coloured pills ('—' when it has none). */
function Tags({c}:{c:CustomerRecord}){
 const tags=c.tags?.length?c.tags:c.category?[c.category]:[];
 return tags.length?<span className="crm-tag-list">{tags.map(t=><span key={t.id} className="crm-pill" style={{['--c' as any]:t.color}}>{t.name}</span>)}</span>:<>—</>;
}
