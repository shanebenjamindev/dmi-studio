import {CustomerMembers} from './CustomerMembers';
import {EntitySelect,useEntityRefresh} from './QuickCreate';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { toast, useStore } from '../store';
import { Icon } from './ui';
import { FolderPicker } from './FolderPicker';
import { CustomerForm } from './CustomerForm';
import { CustomerImport } from './CustomerImport';
import { GoogleConnect } from './GoogleConnect';
import { CustomerDetail } from './Workspace';
import { ProjectCampaigns } from './ProjectCampaigns';
import { CustomerDashboard } from './CustomerDashboard';
import { ReportList } from './Reports';
import type { CustomerRecord, Loc, TaskMeta } from '../types';

type CustomerRow = CustomerRecord;
type Campaign = { id: string; name: string; tasks: number; campaigns?:number };
export function CustomersPage() {
  const user = useStore((s) => s.user)!;
  const pages = useStore((s) => s.pages);
  const canCreate=user.role==='admin'||user.level!=='observer';
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const[sharing,setSharing]=useState(false);
  const [selected, setSelected] = useState<string | null>(() => window.location.hash.match(/^#customers\/(c_\w+)/)?.[1] || null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'campaigns' | 'drive' | 'reports'>('campaigns');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [meta, setMeta] = useState<TaskMeta | null>(null);
  const [name, setName] = useState('');
  const [project, setProject] = useState('');
  const [busy, setBusy] = useState(false);
  const [record, setRecord] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [location, setLocation] = useState<Loc | null>(null);
  const [picker, setPicker] = useState(false);
  const [importing, setImporting] = useState(false);
  const [google, setGoogle] = useState(false);
  const load = () => api.customerDirectory().then(rows=>{setCustomers(rows);setError('');}).catch((e) => setError(e.message)).finally(()=>setLoading(false));
  const loadCampaigns = (id: string) => Promise.all([api.customerProjects(id), api.taskMeta()]).then(([list, m]) => { setCampaigns(list); setMeta(m); }).catch((e) => toast(e.message, true));
  useEntityRefresh(()=>{void load();if(selected)void loadCampaigns(selected);});
  useEffect(() => { load(); }, []);
  useEffect(()=>{const change=()=>{if(window.location.hash==='#customers')setSelected(null);};window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  useEffect(() => { setCampaign(null); setCampaigns([]); setName(''); setProject(''); if (selected) loadCampaigns(selected); }, [selected]);
  const select = (id: string | null) => { setSelected(id); setTab('campaigns'); if(!id)load(); history.replaceState(null, '', id ? `#customers/${id}` : '#customers'); };
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); } };
  const create = () => act(async () => {
    if (!location || !customerName.trim()) return;
    const c = await api.createCustomer({ name: customerName.trim(), ...(mode === 'existing' ? { existingFolder: location } : {}) }, mode === 'new' ? location : null);
    setCreating(false); setCustomerName(''); setLocation(null); await load(); select(c.id);
  });
  const current = customers.find((c) => c.id === selected);
  const manage=selected?!!current?.canManage:canCreate;
  return <div className="crm-page">
    {selected && <aside className="crm-sidebar"><header><h1>Khách hàng</h1>{manage && <button className="btn btn-primary btn-sm" onClick={() => setRecord('new')}><Icon name="plus" size={14} />Thêm</button>}</header>
      {manage && <div className="crm-side-tools"><button className="btn btn-gray btn-sm" onClick={()=>{setCreating(true);setLocation(null);}}><Icon name="folder" size={14}/>Thêm kèm Drive</button><button className="btn btn-gray btn-sm" onClick={()=>setImporting(true)}><Icon name="sheet" size={14}/>Import Excel</button></div>}
      <input className="bk-in" placeholder="Tìm khách hàng…" aria-label="Tìm khách hàng" value={query} onChange={(e) => setQuery(e.target.value)} />
      {error && <p className="note err">{error}</p>}
      <nav>{customers.filter((c) => `${c.name} ${c.contact} ${c.email} ${c.phone}`.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi'))).map((c) => <button key={c.id} className={selected === c.id ? 'on' : ''} onClick={() => select(c.id)}><Icon name="users" size={16} />{c.name}</button>)}</nav>
    </aside>}
    <main className="crm-main">{!selected ? <CustomerDashboard customers={customers} loading={loading} error={error} manage={manage} onOpen={select} onAdd={()=>setRecord('new')} onImport={()=>setImporting(true)} onDrive={()=>{setCreating(true);setLocation(null);}} onRefresh={load}/> : <>
      <header className="crm-header"><button className="btn btn-gray btn-sm" onClick={()=>select(null)}><Icon name="left" size={14}/>Dashboard</button><h2>{current?.name || 'Khách hàng'}</h2>{manage && <div className="crm-record-actions"><button className="btn btn-gray btn-sm" disabled={busy} onClick={()=>setRecord(selected)}><Icon name="text" size={14}/>Sửa</button>{current?.canDelete&&<button className="btn btn-gray btn-sm" disabled={busy} onClick={()=>{if(confirm('Xoá khách hàng khỏi database? Giữ nguyên dự án, công việc, báo cáo và file Drive.'))act(async()=>{await api.deleteCustomer(selected);select(null);await load();});}}><Icon name="trash" size={14}/>Xoá</button>}</div>}<div className="ad-presets">{([['campaigns', 'Dự án'], ['drive', 'Thông tin & Drive'], ...(pages.includes('editor') || pages.includes('ads') ? [['reports', 'Báo cáo']] : [])] as [typeof tab, string][]).map(([key, label]) => <button key={key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>{label}</button>)}</div></header>
      {current&&!(tab==='campaigns'&&campaign)&&<div className="crm-access"><Icon name="lock" size={14}/><span>Khách hàng riêng tư</span><button className="btn btn-gray btn-sm" onClick={()=>setSharing(true)}><Icon name="users" size={14}/>Thành viên khách hàng</button></div>}
      {current && (current.contact || current.email || current.phone) && <div className="crm-contact-summary">{current.contact && <span>Liên hệ: {current.contact}</span>}{current.email && <a href={'mailto:'+current.email}>{current.email}</a>}{current.phone && <a href={'tel:'+current.phone.replace(/[^+\d]/g,'')}>{current.phone}</a>}</div>}
      {tab === 'drive' ? <CustomerDetail key={selected} id={selected} admin={manage} canDelete={!!current?.canDelete} viewOnly={current?.level==='observer'||user.level==='observer'} onChanged={load} onDeleted={() => { select(null); load(); }} /> : tab === 'reports' ? <ReportList key={selected} customerId={selected} projectId="" driveFolder="" /> : campaign ? <><div className="crm-campaign-back"><button className="btn btn-gray btn-sm" onClick={() => { setCampaign(null); loadCampaigns(selected); }}><Icon name="left" size={14} />Tất cả dự án</button></div><ProjectCampaigns key={campaign.id} id={campaign.id} name={campaign.name} /></> : <section className="crm-campaigns">
        {manage && <div className="crm-create-campaign"><h3>Thêm dự án</h3><form onSubmit={(e) => { e.preventDefault(); act(async () => { const c = await api.createCustomerProject(selected, { name: name.trim() }); setName(''); await loadCampaigns(selected); setCampaign({ ...c, tasks: 0 }); }); }}><input className="bk-in" placeholder="Tên dự án" maxLength={200} required value={name} onChange={(e) => setName(e.target.value)} /><button className="btn btn-primary btn-sm" disabled={busy || !name.trim()}>Tạo dự án</button></form>
          <form onSubmit={(e) => { e.preventDefault(); act(async () => { await api.createCustomerProject(selected, { projectId: project }); setProject(''); await loadCampaigns(selected); }); }}><EntitySelect kind="project" context={{customerId:selected}} createdValue={()=>''} className="bk-in" value={project} onCreated={async r=>{const[rows,m]=await Promise.all([api.customerProjects(selected),api.taskMeta()]);setCampaigns(rows);setMeta(m);setCampaign({...r,tasks:0});}} onChange={setProject}><option value="">Gắn dự án công việc đã có…</option>{meta?.projects.filter((p) => !p.customerId).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.tasks} công việc)</option>)}</EntitySelect><button className="btn btn-gray btn-sm" disabled={busy || !project}>Liên kết</button></form>
        </div>}
        {!campaigns.length && <p className="note">Chưa có dự án. Mỗi dự án chứa nhiều chiến dịch; mỗi công việc có thể giao cho nhiều nhân viên.</p>}
        <div className="crm-campaign-grid">{campaigns.map((c) => <article key={c.id}><button className="crm-campaign-title" onClick={() => setCampaign(c)}><Icon name="folder" size={20} /><b>{c.name}</b><span>{c.campaigns || 0} chiến dịch · {c.tasks} công việc</span></button>{manage && <div className="crm-campaign-actions"><button className="bk-link" disabled={busy} onClick={() => { const next = prompt('Tên dự án', c.name); if (next?.trim()) act(async () => { await api.updateCustomerProject(selected, c.id, { name: next.trim() }); await loadCampaigns(selected); }); }}>Đổi tên</button><button className="bk-link" disabled={busy} onClick={() => { if (confirm(`Gỡ liên kết “${c.name}” khỏi khách hàng? Dự án và công việc vẫn được giữ.`)) act(async () => { await api.updateCustomerProject(selected, c.id, { unlink: true }); await loadCampaigns(selected); }); }}>Gỡ liên kết</button></div>}</article>)}</div>
      </section>}
    </>}</main>
    {sharing&&selected&&<CustomerMembers id={selected} onClose={()=>setSharing(false)} onChanged={()=>void load()}/>}
    {creating && <div className="cm-back"><section className="crm-new" role="dialog" aria-label="Thêm khách hàng"><h2>Thêm khách hàng</h2><label>Tên khách hàng<input className="bk-in" autoFocus maxLength={200} value={customerName} onChange={(e) => setCustomerName(e.target.value)} /></label><label>Liên kết tài liệu<select className="bk-in" value={mode} onChange={(e) => { setMode(e.target.value as typeof mode); setLocation(null); }}><option value="existing">Liên kết thư mục có sẵn</option><option value="new">Tạo thư mục khách hàng mới</option></select></label><button className="btn btn-gray" onClick={() => setPicker(true)}><Icon name="folder" size={16} />{location ? 'Đổi thư mục' : mode === 'new' ? 'Chọn thư mục cha trên Drive' : 'Chọn thư mục khách hàng'}</button>{location && <p className="crm-confirm">{mode === 'new' ? <>Khi xác nhận, tạo thư mục <b>{customerName.trim() || '(tên khách hàng)'}</b> trong <b>{location.kind === 'gdrive' ? location.label || location.id : location.dir}</b>. Thao tác dùng quyền ghi của tài khoản Drive đã kết nối.</> : <>Liên kết thư mục <b>{location.kind === 'gdrive' ? location.label || location.id : location.dir}</b> với khách hàng.</>}</p>}<footer><button className="btn btn-gray" disabled={busy} onClick={() => setCreating(false)}>Huỷ</button><button className="btn btn-primary" disabled={busy || !location || !customerName.trim()} onClick={create}>{busy ? 'Đang tạo…' : mode === 'new' ? 'Xác nhận tạo thư mục & khách hàng' : 'Xác nhận liên kết & tạo khách hàng'}</button></footer></section></div>}
    <FolderPicker open={picker} title={mode === 'new' ? 'Chọn thư mục cha' : 'Chọn thư mục khách hàng'} confirmLabel="Chọn thư mục này" onAddAccount={user.role === 'admin' ? () => { setPicker(false); setGoogle(true); } : undefined} onClose={() => setPicker(false)} onPick={(loc) => { setLocation(loc); setPicker(false); }} />
    {record && <CustomerForm key={record} id={record==='new'?null:record} onClose={()=>setRecord(null)} onSaved={(id)=>{setRecord(null);load();select(id);}}/>}
    {importing && <CustomerImport onClose={()=>setImporting(false)} onImported={()=>{setImporting(false);load();if(selected)loadCampaigns(selected);}}/>}
    <GoogleConnect open={google} onClose={() => setGoogle(false)} onChanged={() => { setGoogle(false); setPicker(true); }} />
  </div>;
}
