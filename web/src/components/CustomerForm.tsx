import {BrandLoading} from './BrandLoading';
import {useEffect,useState} from 'react';
import {api} from '../api';
import type {CustomerRecord} from '../types';
import {Icon} from './ui';

const EMPTY={name:'',contact:'',phone:'',email:'',notes:''};
export function CustomerForm({id,onClose,onSaved}:{id:string|null;onClose:()=>void;onSaved:(id:string)=>void}){
 const [form,setForm]=useState({...EMPTY});const [loading,setLoading]=useState(!!id);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 useEffect(()=>{let active=true;if(id)api.customerRecord(id).then(r=>{if(active){setForm(r);setLoading(false);}},e=>{if(active){setError(e.message);setLoading(false);}});return()=>{active=false;};},[id]);
 const save=async(e:React.FormEvent)=>{e.preventDefault();if(busy||loading)return;setBusy(true);setError('');try{const r=id?await api.saveCustomerRecord(id,form):await api.createCustomer({...form,databaseOnly:true});onSaved(r.id);}catch(e:any){setError(e.message);}finally{setBusy(false);}};
 const field=(key:keyof typeof EMPTY,label:string,type='text',maxLength=200)=><label className="tm-field">{label}<input className="bk-in" type={type} required={key==='name'} autoFocus={key==='name'} maxLength={maxLength} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>;
 return <div className="cm-back" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)onClose();}}><form className="crm-new" onSubmit={save} role="dialog" aria-modal="true" aria-label={id?'Sửa khách hàng':'Thêm khách hàng'}><header className="crm-form-head"><h2>{id?'Sửa khách hàng':'Thêm khách hàng'}</h2><button type="button" className="bd-icon" disabled={busy} onClick={onClose} aria-label="Đóng"><Icon name="x" size={16}/></button></header><p className="note">Lưu thông tin vào database. Có thể liên kết Drive sau trong mục Thông tin & Drive.</p>{error&&<p className="note err" role="alert">{error}</p>}<fieldset disabled={busy||loading}>{loading?<BrandLoading label="Đang tải…"/>:<>{field('name','Tên khách hàng')}{field('contact','Người liên hệ')}<div className="crm-form-grid">{field('email','Email','email',320)}{field('phone','Điện thoại','tel',60)}</div><label className="tm-field">Ghi chú<textarea className="bk-in" rows={4} maxLength={20000} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></label></>}</fieldset><footer><button type="button" className="btn btn-gray" disabled={busy} onClick={onClose}>Huỷ</button><button className="btn btn-primary" disabled={busy||loading||!form.name.trim()}>{busy?'Đang lưu…':id?'Lưu thay đổi':'Tạo khách hàng'}</button></footer></form></div>;
}
