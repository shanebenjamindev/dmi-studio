import { useRef, useState } from 'react';
import { api } from '../api';
import { toast } from '../store';
import { Icon } from './ui';
import { readCustomerImport } from '../../../shared/customer-import';

export function CustomerImport({onClose,onImported}:{onClose:()=>void;onImported:()=>void}) {
  const [file,setFile]=useState<File|null>(null);
  const [sheets,setSheets]=useState<string[]>([]);
  const [sheet,setSheet]=useState('');
  const [text,setText]=useState('');
  const [preview,setPreview]=useState<ReturnType<typeof readCustomerImport>|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [reading,setReading]=useState(false);
  const [link,setLink]=useState(false);
  const request=useRef(0);
  const show=(value:string)=>{setText(value);try{setPreview(readCustomerImport(value));setError('');}catch(e:any){setPreview(null);setError(e.message);}};
  const pick=async(f:File|undefined)=>{
    if(!f)return;const seq=++request.current;setReading(true);setError('');setPreview(null);setText('');setFile(f);
    try{
      if(f.size>20*1024*1024)throw new Error('Chọn file tối đa 20 MB.');
      const tables=await import('../tools/text');
      if(/\.xlsx$/i.test(f.name)){
        const names=await tables.xlsxSheetNames(f);if(seq!==request.current)return;
        const selected=names.find(n=>/customer directory|danh ba|khach hang/i.test(n))||names[0];
        if(!selected)throw new Error('Workbook chưa có sheet.');
        setSheets(names);setSheet(selected);
        const value=await tables.xlsxSheetText(f,selected);if(seq===request.current)show(value);
      }else{setSheets([]);setSheet('');const value=await tables.tableText(f);if(seq===request.current)show(value);}
    }catch(e:any){if(seq===request.current)setError(e.message);}finally{if(seq===request.current)setReading(false);}
  };
  const chooseSheet=async(name:string)=>{
    if(!file)return;const seq=++request.current;setSheet(name);setReading(true);setPreview(null);
    try{const value=await(await import('../tools/text')).xlsxSheetText(file,name);if(seq===request.current)show(value);}catch(e:any){if(seq===request.current)setError(e.message);}finally{if(seq===request.current)setReading(false);}
  };
  const apply=async()=>{if(!preview)return;setBusy(true);try{const r=await api.importCustomers(text,link);toast(`Đã thêm ${r.created} khách hàng, bỏ qua ${r.kept} tên đã có${r.projectLinks?`, liên kết ${r.projectLinks} dịch vụ`:''}.`);onImported();}catch(e:any){setError(e.message);}finally{setBusy(false);}};
  return <div className="bd-modal" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy&&!reading)onClose();}}><section className="tk-dialog tk-import-preview" role="dialog" aria-modal="true" aria-label="Import khách hàng"><header><b>Import khách hàng từ Excel</b><button className="bd-icon" disabled={busy||reading} onClick={onClose} aria-label="Đóng"><Icon name="x" size={16}/></button></header><div className="ci-body"><p className="note">Xem trước và xác nhận trước khi nhập. Chỉ thêm vào database; không tạo thư mục hoặc sửa dữ liệu Drive. Tên khách đã có sẽ được giữ nguyên.</p><div className="ci-controls"><label className="btn btn-gray">Chọn Excel / CSV<input type="file" accept=".xlsx,.csv,.tsv,.txt" hidden disabled={busy||reading} onChange={e=>{pick(e.target.files?.[0]);e.target.value='';}}/></label><span>{file?.name}</span>{sheets.length>0&&<select className="bk-in" disabled={busy||reading} aria-label="Sheet khách hàng" value={sheet} onChange={e=>chooseSheet(e.target.value)}>{sheets.map(s=><option key={s}>{s}</option>)}</select>}</div>{reading&&<p role="status">Đang đọc Excel…</p>}{error&&<p className="note err" role="alert">{error}</p>}{preview&&<><p><b>{preview.customers.length} dòng khách hàng</b> · {preview.headers.length} cột · {preview.skipped} dòng trống bỏ qua</p><div className="ci-preview"><table><thead><tr>{preview.headers.map((h,i)=><th key={i}>{h}</th>)}</tr></thead><tbody>{preview.rows.slice(0,100).map((r,i)=><tr key={i}>{preview.headers.map((_,j)=><td key={j}>{r[j]||''}</td>)}</tr>)}</tbody></table></div>{preview.rows.length>100&&<p className="note">Xem trước 100 dòng đầu; nhập đủ {preview.customers.length} dòng khách hàng.</p>}<label className="bk-check"><input type="checkbox" disabled={busy} checked={link} onChange={e=>setLink(e.target.checked)}/>Liên kết dịch vụ công việc chưa có khách theo tên hoặc alias trùng khớp</label></>}<p className="note">Cột tên bắt buộc: Customer Name / Tên khách hàng. Các cột tuỳ chọn: Customer ID, Known Alias / Project Name, Notes, Email, Phone.</p></div><footer><button className="btn btn-gray" disabled={busy||reading} onClick={onClose}>Huỷ</button><button className="btn btn-primary" disabled={busy||reading||!preview} onClick={apply}>{busy?'Đang nhập…':'Xác nhận import vào database'}</button></footer></section></div>;
}
