import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { useStore } from '../store';
import { Icon } from './ui';
import { ADS_SUMMARY_COLUMNS, type AdsService, type AdsSummary as SummaryData, type AdsSummaryRow, type SummaryConversion, type SummaryKpi } from '../../../shared/ads-summary';
import { shiftDay, summaryUntil } from '../../../server/ads-summary-math';
import type { AdAccount } from '../types';
import { DayRangeField } from './DateRange';

const TYPES:SummaryConversion[]=['LeadForm','Messages','Traffic','Engagement'];
const KPIS:SummaryKpi[]=['Auto','CPL','CPA','CPMe','CPLC','CPC','CTR','Primary Results'];
const pctKeys=new Set(['spendBudgetPct','ctr30','costChange7']);
const moneyKeys=new Set(['monthlyBudget','spend30','cpc30','cpl30','cpme30','spend7','cpl7','costPrimary30','costPrimary7']);
const maxDay=summaryUntil;
function format(row:AdsSummaryRow,key:typeof ADS_SUMMARY_COLUMNS[number][0]) {
  const value=row[key];if(value===null||value===undefined||value==='')return '—';
  if(typeof value!=='number')return value;
  const digits=moneyKeys.has(key)?row.currency==='VND'?0:2:pctKeys.has(key)?2:Number.isInteger(value)?0:2;
  return `${key==='costChange7'&&value>0?'+':''}${value.toLocaleString('vi-VN',{maximumFractionDigits:digits,minimumFractionDigits:moneyKeys.has(key)?digits:0})}${pctKeys.has(key)?'%':''}`;
}
function exportCsv(rows:AdsSummaryRow[],until:string) {
  const cell=(value:unknown)=>{let s=value==null?'':String(value);if(typeof value==='string'&&/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  const csv=[ADS_SUMMARY_COLUMNS.map(([,name])=>cell(name)).join(','),...rows.map(row=>ADS_SUMMARY_COLUMNS.map(([key])=>cell(row[key])).join(','))].join('\r\n');
  const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`ads-summary-${until}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function AdsSummary({accounts,accountError}:{accounts:AdAccount[];accountError:string}) {
  const admin=useStore(s=>s.user?.role==='admin');
  const [data,setData]=useState<SummaryData|null>(null),[services,setServices]=useState<AdsService[]>([]);
  const [until,setUntil]=useState(maxDay),[query,setQuery]=useState(''),[status,setStatus]=useState(''),[type,setType]=useState('');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[editing,setEditing]=useState<AdsService|'new'|null>(null);
  const request=useRef(0);
  const read=(fresh=false)=>{const seq=++request.current;setBusy(true);setError('');Promise.all([api.adsSummary(until,fresh),api.adsServices()]).then(([r,s])=>{if(request.current===seq){setData(r);setServices(s);}},e=>{if(request.current===seq)setError(e.message);}).finally(()=>{if(request.current===seq)setBusy(false);});};
  useEffect(()=>{setData(null);read();return()=>{request.current++;};},[until]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows=(data?.rows||[]).filter(r=>(!status||r.serviceStatus===status)&&(!type||r.conversionType===type)&&(!query.trim()||`${r.clientId} ${r.client} ${r.service} ${r.campaignOwner} ${r.reportingKey}`.toLocaleLowerCase('vi').includes(query.trim().toLocaleLowerCase('vi'))));
  return <>
    <div className="as-toolbar">
      <label className="rp-search"><Icon name="search" size={15}/><input placeholder="Tìm khách, dịch vụ, người phụ trách…" aria-label="Tìm dòng báo cáo" value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <DayRangeField single from="" to={until} max={maxDay()} endLabel="Đến ngày" onChange={(_,t)=>t&&setUntil(t)}/>
      <select aria-label="Service Status" value={status} onChange={e=>setStatus(e.target.value)}><option value="">Mọi Service Status</option>{[...new Set(data?.rows.map(r=>r.serviceStatus)||[])].map(s=><option key={s}>{s}</option>)}</select>
      <select aria-label="Conversion Type" value={type} onChange={e=>setType(e.target.value)}><option value="">Mọi Conversion Type</option>{TYPES.map(t=><option key={t}>{t}</option>)}</select>
      <button className="btn btn-gray btn-sm" disabled={busy} onClick={()=>read(true)}><Icon name="refresh" size={14}/>{busy?'Đang lấy số liệu…':'Làm mới'}</button>
      <button className="btn btn-gray btn-sm" disabled={!data||busy||!!error} onClick={()=>data&&exportCsv(rows,data.until)}><Icon name="download" size={14}/>Xuất CSV</button>
      {admin&&<button className="btn btn-primary btn-sm" onClick={()=>setEditing('new')}><Icon name="plus" size={14}/>Thêm dòng báo cáo</button>}
    </div>
    {data&&<p className="note as-range">30D: {data.since30} – {data.until} · 7D: {data.since7} – {data.until} · Kỳ trước: {data.previous7.since} – {data.previous7.until} · {rows.length} dòng</p>}
    <p className="note">Spend % Budget = chi tiêu 30D / ngân sách tháng. 7D vs Prev 7D = thay đổi chi phí/kết quả chính; số âm là giảm chi phí. Ô “—” là chưa có dữ liệu hoặc không tính được tỷ lệ.</p>
    <p className="note">Leads / Conv dùng số lead Meta trả về; Primary Results theo Conversion Type: lead, tin nhắn hoặc click link. Engagement không có kết quả chính. Chọn chiến dịch riêng cho từng dịch vụ để tách số liệu.</p>
    {error&&<p className="note err" role="alert">{error}</p>}
    {!data&&busy?<p className="note" role="status">Đang tổng hợp báo cáo 30D / 7D…</p>:data&&!data.rows.length?<div className="ad-empty"><Icon name="sheet" size={24}/><h2>Chưa có dòng báo cáo</h2><p>{admin?'Thêm khách hàng, dịch vụ và tài khoản Meta để bắt đầu.':'Quản trị viên cần cấu hình dòng báo cáo trước.'}</p>{accountError&&<p className="note err">{accountError}</p>}</div>:data&&<div className={'as-table-scroll'+(busy?' busy':'')} tabIndex={0} role="region" aria-label="Bảng tổng hợp 33 cột" aria-busy={busy}>
      <table className="as-table"><thead><tr>{ADS_SUMMARY_COLUMNS.map(([key,label])=><th key={key} scope="col">{label}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.id} className={row.error?'as-row-error':''}>{ADS_SUMMARY_COLUMNS.map(([key])=><td key={key} className={(key==='kpiStatus'?(row.kpiStatus==='On target'?'good':row.kpiStatus==='Off target'||row.error?'warn':''):key==='costChange7'&&row.costChange7!==null?(row.costChange7<=0?'good':'warn'):'')}>
        {key==='client'?<div className="as-client"><span>{row.client}</span>{admin&&<button aria-label={`Sửa báo cáo ${row.client} ${row.service}`} title="Sửa dòng báo cáo" onClick={()=>{const service=services.find(s=>s.id===row.id);if(service)setEditing(service);}}><Icon name="text" size={13}/></button>}</div>:key==='kpiStatus'&&row.error?<span title={row.error}>Data error: {row.error}</span>:format(row,key)}
      </td>)}</tr>)}</tbody></table>{!rows.length&&<p className="note as-no-match">Không có dòng khớp bộ lọc.</p>}
    </div>}
    {editing&&<ServiceEditor service={editing==='new'?undefined:editing} accounts={accounts} accountError={accountError} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);read();}}/>}
  </>;
}
function ServiceEditor({service,accounts,accountError,onClose,onSaved}:{service?:AdsService;accounts:AdAccount[];accountError:string;onClose:()=>void;onSaved:()=>void}) {
  const [draft,setDraft]=useState<Omit<AdsService,'id'>>(()=>service||{clientId:'',client:'',channel:'Meta',service:'',serviceStatus:'Active',currency:accounts[0]?.currency||'USD',monthlyBudget:null,primaryKpi:'Auto',kpiTarget:null,notes:'',campaignOwner:'',conversionType:'LeadForm',reportingKey:'',accountId:accounts[0]?.id||'',campaignIds:[]});
  const [campaigns,setCampaigns]=useState<{id:string;name:string}[]>([]),[loading,setLoading]=useState(false),[campaignError,setCampaignError]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const update=<K extends keyof typeof draft>(key:K,value:typeof draft[K])=>setDraft(d=>({...d,[key]:value}));
  useEffect(()=>{let active=true;setCampaigns([]);setCampaignError('');if(!draft.accountId)return;setLoading(true);const end=maxDay(),start=shiftDay(end,-29);api.adsReport(draft.accountId,start,end).then(r=>{if(active)setCampaigns(r.campaigns.map(c=>({id:c.id,name:c.name})));},e=>{if(active)setCampaignError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[draft.accountId]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!busy){e.stopPropagation();onClose();}};document.addEventListener('keydown',key,true);return()=>document.removeEventListener('keydown',key,true);},[busy,onClose]);
  const save=async(e:FormEvent)=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{if(service)await api.saveAdsService(service.id,draft);else await api.createAdsService(draft);onSaved();}catch(e:any){setError(e.message);}finally{setBusy(false);}};
  const field=(key:'clientId'|'client'|'service'|'serviceStatus'|'campaignOwner'|'reportingKey',label:string,required=false)=><label>{label}<input required={required} value={draft[key]} maxLength={key==='reportingKey'?500:key==='clientId'?100:key==='serviceStatus'?80:200} onChange={e=>update(key,e.target.value)}/></label>;
  const choices=[...campaigns,...draft.campaignIds.filter(id=>!campaigns.some(c=>c.id===id)).map(id=>({id,name:id}))];
  return createPortal(<div className="bd-modal" onMouseDown={e=>e.target===e.currentTarget&&!busy&&onClose()}><form className="tk-dialog tk-editor" role="dialog" aria-modal="true" aria-label="Cấu hình dòng báo cáo" onSubmit={save}>
    <header><b>{service?'Sửa dòng báo cáo':'Thêm dòng báo cáo'}</b><button type="button" className="bd-icon" disabled={busy} onClick={onClose} aria-label="Đóng"><Icon name="x" size={15}/></button></header>
    <fieldset disabled={busy}><div className="tk-form-grid">{field('clientId','Client ID',true)}{field('client','Client',true)}{field('service','Service',true)}{field('serviceStatus','Service Status',true)}
      <label>Channel<input readOnly value="Meta"/></label><label>Tài khoản quảng cáo<select required value={draft.accountId} onChange={e=>setDraft(d=>({...d,accountId:e.target.value,currency:accounts.find(a=>a.id===e.target.value)?.currency||d.currency,campaignIds:[]}))}><option value="">Chọn tài khoản</option>{service&&!accounts.some(a=>a.id===service.accountId)&&<option value={service.accountId}>{service.accountId}</option>}{accounts.map(a=><option key={a.id} value={a.id}>{a.name} · {a.accountId}</option>)}</select></label>
      <label>Currency<input readOnly value={draft.currency}/></label><label>Monthly Budget<input type="number" min="0" step="any" value={draft.monthlyBudget??''} onChange={e=>update('monthlyBudget',e.target.value===''?null:Number(e.target.value))}/></label>
      <label>Conversion Type<select value={draft.conversionType} onChange={e=>update('conversionType',e.target.value as SummaryConversion)}>{TYPES.map(t=><option key={t}>{t}</option>)}</select></label>
      <label>Primary KPI<select value={draft.primaryKpi} onChange={e=>update('primaryKpi',e.target.value as SummaryKpi)}>{KPIS.map(k=><option key={k} value={k}>{k==='Auto'?'Tự theo Conversion Type':k}</option>)}</select></label>
      <label>KPI Target<small>{draft.primaryKpi==='CTR'?'Nhập phần trăm, ví dụ 2 = 2%':draft.primaryKpi==='Primary Results'?'Số kết quả tối thiểu':`Chi phí tối đa (${draft.currency})`}</small><input type="number" min="0" step="any" value={draft.kpiTarget??''} onChange={e=>update('kpiTarget',e.target.value===''?null:Number(e.target.value))}/></label>{field('campaignOwner','Campaign Owner')}
    </div>
    <div className="as-campaigns"><b>Chiến dịch của dịch vụ</b><label><input type="checkbox" checked={!draft.campaignIds.length} onChange={()=>update('campaignIds',[])}/>Toàn bộ tài khoản</label>{loading&&<p className="note">Đang tải chiến dịch có số liệu 30D…</p>}{choices.map(c=><label key={c.id}><input type="checkbox" checked={draft.campaignIds.includes(c.id)} onChange={e=>update('campaignIds',e.target.checked?[...draft.campaignIds,c.id]:draft.campaignIds.filter(id=>id!==c.id))}/>{c.name}</label>)}{campaignError&&<p className="note err">{campaignError}</p>}</div>
    {field('reportingKey','Reporting Key (để trống để tự tạo)')}<label>Notes<textarea rows={3} maxLength={5000} value={draft.notes} onChange={e=>update('notes',e.target.value)}/></label></fieldset>
    {accountError&&<p className="note err">{accountError}</p>}{error&&<p className="note err" role="alert">{error}</p>}
    <div className="tk-action-row"><button className="btn btn-primary btn-sm" disabled={busy}>{busy?'Đang lưu…':'Lưu cấu hình'}</button><button type="button" className="btn btn-gray btn-sm" disabled={busy} onClick={onClose}>Huỷ</button>{service&&<button type="button" className="btn btn-gray btn-sm" disabled={busy} onClick={async()=>{if(!confirm('Xoá dòng cấu hình báo cáo này? Dữ liệu quảng cáo trên Meta được giữ nguyên.'))return;setBusy(true);setError('');try{await api.deleteAdsService(service.id);onSaved();}catch(e:any){setError(e.message);}finally{setBusy(false);}}}><Icon name="trash" size={13}/>Xoá dòng</button>}</div>
  </form></div>,document.body);
}
