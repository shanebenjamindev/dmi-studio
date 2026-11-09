import {ReadingTabs,ReadingHeader} from './ReadingLayout';
import { ResizeHandle } from './ResizeHandle';
import {useCustomerStatuses} from './useCustomerStatuses';
import {CustomerMembers} from './CustomerMembers';
import {EntitySelect,useEntityRefresh} from './QuickCreate';
import { useEffect, useState, type CSSProperties } from 'react';
import { api } from '../api';
import { mayAddCustomer, toast, useStore } from '../store';
import {BrandLoading} from './BrandLoading';
import {CustomerStages} from './CustomerStages';
import { Icon, Menu } from './ui';
import { FolderPicker } from './FolderPicker';
import { CustomerForm } from './CustomerForm';
import { CustomerImport } from './CustomerImport';
import { GoogleConnect } from './GoogleConnect';
import { CustomerDetail } from './Workspace';
import { ProjectCampaigns } from './ProjectCampaigns';
import { ProjectEditDialog } from './ProjectEditDialog';
import { CustomerDashboard, type CustomerView } from './CustomerDashboard';
import { CustomerOverview, CustomerContext, CustomerTasks, CustomerMembersTab, CustomerHistory } from './CustomerTabs';
import { ReportList } from './Reports';
import type { CustomerRecord, Loc, ServiceRef, TaskMeta } from '../types';

type CustomerRow = CustomerRecord;
type Campaign = { id: string; name: string; tasks: number; campaigns?:number; services?: ServiceRef[] };
const LS_VIEW = 'dms.customerView';
const readView = (): CustomerView => { try { const v = localStorage.getItem(LS_VIEW) as CustomerView; return ['list', 'kanban', 'grid'].includes(v) ? v : 'list'; } catch { return 'list'; } };
export function CustomersPage() {
  const statuses=useCustomerStatuses();
  const user = useStore((s) => s.user)!;
  // Everyone sees the customers they work on here. Adding them is for those given Drive (not view-only) or given
  // "Tạo khách hàng" in Phân quyền (mayAddCustomer); their Drive folders stay with Drive.
  const drive = useStore((s) => s.pages).includes('workspace');
  useStore((s) => s.admin); // drawn again when the account's rights arrive
  const canCreate = mayAddCustomer();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const[sharing,setSharing]=useState(false);
  const [selected, setSelected] = useState<string | null>(() => window.location.hash.match(/^#customers\/(c_\w+)/)?.[1] || null);
  const [view, setViewState] = useState<CustomerView>(readView);
  const setView = (v: CustomerView) => { setViewState(v); try { localStorage.setItem(LS_VIEW, v); } catch { /* private mode */ } };
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Each customer opens on its overview; one tab for each kind of thing about it.
  type Tab = 'overview' | 'campaigns' | 'tasks' | 'drive' | 'reports' | 'members' | 'history';
  const [tab, setTab] = useState<Tab>('overview');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [meta, setMeta] = useState<TaskMeta | null>(null);
  const [editingProject, setEditingProject] = useState<TaskMeta['projects'][number] | null>(null);
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
  const select = (id: string | null) => { setSelected(id); setTab('overview'); if(!id)load(); history.replaceState(null, '', id ? `#customers/${id}` : '#customers'); };
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); } };
  const create = () => act(async () => {
    if (!location || !customerName.trim()) return;
    const c = await api.createCustomer({ name: customerName.trim(), ...(mode === 'existing' ? { existingFolder: location } : {}) }, mode === 'new' ? location : null);
    setCreating(false); setCustomerName(''); setLocation(null); await load(); select(c.id);
  });
  const current = customers.find((c) => c.id === selected), status = statuses.find((x) => x.id === current?.status);
  const manage=selected?!!current?.canManage:canCreate;
  return <div className={'ad-page tk-page tk-mailbox crm-page'+(selected?' has-selection':'')}>
    <section className="tk-list-pane" aria-label="Danh sách khách hàng">
      <CustomerDashboard customers={customers} selected={selected} loading={loading} error={error} manage={canCreate}view={view} onViewChange={setView} onOpen={select} onEdit={(id)=>setRecord(id)} onAdd={()=>setRecord('new')} onImport={()=>setImporting(true)} onDrive={()=>{setCreating(true);setLocation(null);}} onRefresh={load}/>
    </section>
    {selected && <ResizeHandle cssVar="--rd-list-w" storage="customers" min={220} max={640} label="Đổi độ rộng danh sách khách hàng" />}
    {selected && <article className="tk-reading-pane crm-reading-pane" aria-label="Chi tiết khách hàng">
      <ReadingHeader label="Chi tiết khách hàng" onClose={()=>select(null)} actions={<div className="crm-record-actions">{manage&&<button className="btn btn-primary btn-sm" disabled={busy} onClick={()=>setRecord(selected)}><Icon name="edit" size={14}/>Chỉnh sửa</button>}<Menu label="Tuỳ chọn khách hàng" items={[{label:'Thành viên',icon:'users',onClick:()=>setTab('members')},{label:'Lịch sử thay đổi',icon:'clock',onClick:()=>setTab('history')},{label:'Xoá khách hàng',icon:'trash',danger:true,hidden:!manage||!current?.canDelete||busy,onClick:()=>{if(confirm('Xoá khách hàng khỏi database? Giữ nguyên dự án, công việc, báo cáo và file Drive.'))void act(async()=>{await api.deleteCustomer(selected);select(null);await load();});}}]}/></div>}/>
      {/* Like Outlook: the customer's parts in a column, and only the chosen one beside it. */}
      <div className="crm-split">
      <aside className="crm-side" aria-label="Mục của khách hàng">
        <div className="crm-side-title"><span>Khách hàng</span><h2>{current?.name || 'Khách hàng'}</h2>{status&&<em className="crm-side-status" style={{'--stage-color':status.color} as CSSProperties}>{status.name}</em>}</div>
        <ReadingTabs vertical className="crm-vtabs" label="Thông tin khách hàng" value={tab} items={[
          {value:'overview' as Tab,label:'Tổng quan',icon:'info'},
          {value:'campaigns' as Tab,label:`Dự án (${current?.projects ?? campaigns.length})`,icon:'folder'},
          {value:'tasks' as Tab,label:`Công việc (${current?.tasks ?? 0})`,icon:'checklist'},
          ...(drive?[{value:'drive' as Tab,label:'Drive',icon:'folder'}]:[]),
          {value:'reports' as Tab,label:'Báo cáo',icon:'file'},
          {value:'members' as Tab,label:'Thành viên',icon:'users'},
          {value:'history' as Tab,label:'Lịch sử',icon:'clock'},
        ]} onChange={value=>{setTab(value);setCampaign(null);}}/>
      </aside>
      <ResizeHandle cssVar="--crm-side-w" storage="customer-side" min={150} max={360} label="Đổi độ rộng menu khách hàng" />
      <div className={'tk-reading-content crm-split-main' + (campaign ? ' has-campaign' : '')}>
      {!current ? (error?<p className="note err" role="alert">{error}</p>:loading?<BrandLoading label="Đang tải khách hàng…"/>:<p className="note">Không tìm thấy khách hàng hoặc bạn không có quyền truy cập.</p>)
      : tab === 'overview' ? <><div className="crm-detail-stages"><CustomerStages status={current.status||''} disabled={!manage||busy} onChange={status=>void act(async()=>{await api.saveCustomerRecord(current.id,{status:status||null});await load();})}/></div><div className="tk-reading-grid crm-detail-layout"><div className="crm-detail-body"><CustomerOverview key={selected} c={current} view={view} onTab={(t) => setTab(t as Tab)} onChanged={load} /></div><CustomerContext c={current} onTab={t=>{setTab(t as Tab);setCampaign(null);}} onChanged={load}/></div></>
      : campaign ? <ProjectCampaigns key={campaign.id} id={campaign.id} name={campaign.name} displayView={view === 'grid' ? 'grid' : 'list'} onBack={() => { setCampaign(null); loadCampaigns(selected); }} onEdited={() => { void loadCampaigns(selected); void load(); }} onDeleted={() => { setCampaign(null); void loadCampaigns(selected); void load(); }} />
      : <div className="crm-detail-body crm-tab-surface">{
        tab === 'tasks' ? <CustomerTasks key={selected} id={selected} view={view} />
        : tab === 'members' ? <CustomerMembersTab key={selected} id={selected} onManage={() => setSharing(true)} />
        : tab === 'history' ? <CustomerHistory key={selected} id={selected} />
        : tab === 'drive' ? <CustomerDetail key={selected} id={selected} admin={manage} canDelete={!!current?.canDelete} viewOnly={current?.level==='observer'||user.level==='observer'} onChanged={load} onDeleted={() => { select(null); load(); }} />
        : tab === 'reports' ? <ReportList key={selected} customerId={selected} projectId="" driveFolder="" />
        : <section className="crm-campaigns">
          {manage && <div className="tk-toolbar crm-project-toolbar">
            <form className="crm-inline-form" onSubmit={(e) => { e.preventDefault(); act(async () => { const c = await api.createCustomerProject(selected, { name: name.trim(), services: (current?.needs || []).map((n) => n.id) }); setName(''); await loadCampaigns(selected); setCampaign({ ...c, tasks: 0 }); }); }}><input className="bk-in" placeholder="Tên dự án mới…" maxLength={200} required value={name} onChange={(e) => setName(e.target.value)} /><button className="btn btn-primary btn-sm" disabled={busy || !name.trim()}><Icon name="plus" size={14}/>Tạo dự án</button></form>
            <form className="crm-inline-form" onSubmit={(e) => { e.preventDefault(); act(async () => { await api.createCustomerProject(selected, { projectId: project }); setProject(''); await loadCampaigns(selected); }); }}><EntitySelect kind="project" context={{customerId:selected}} createdValue={()=>''} className="bk-in" value={project} onCreated={async r=>{const[rows,m]=await Promise.all([api.customerProjects(selected),api.taskMeta()]);setCampaigns(rows);setMeta(m);setCampaign({...r,tasks:0});}} onChange={setProject}><option value="">Gắn dự án công việc đã có…</option>{meta?.projects.filter((p) => !p.customerId).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.tasks} công việc)</option>)}</EntitySelect><button className="btn btn-gray btn-sm" disabled={busy || !project}>Liên kết</button></form>
          </div>}
          {!campaigns.length && <p className="note">Chưa có dự án. Mỗi công việc trong dự án có thể giao cho nhiều nhân viên.</p>}
          <div className={view === 'grid' ? 'cd-cards' : 'crm-campaign-grid crm-project-list'}>{campaigns.map((c) => <article key={c.id} className={view === 'grid' ? 'cd-customer' : undefined}><button className="crm-campaign-title" onClick={() => setCampaign(c)}><Icon name="folder" size={20} /><b>{c.name}</b><span>{c.tasks} công việc</span></button>{!!c.services?.length && <span className="crm-need-chips" title="Dịch vụ của dự án">{c.services.map((sv) => <span key={sv.id} className="crm-need-chip plain">{sv.name}</span>)}</span>}{manage && <div className="crm-campaign-actions"><button className="btn btn-gray btn-sm" disabled={busy} onClick={() => { const row = meta?.projects.find((p) => p.id === c.id); if (row) setEditingProject(row); else toast('Không tìm thấy dự án này', true); }}><Icon name="edit" size={13} />Sửa</button><button className="btn btn-gray btn-sm" disabled={busy} onClick={() => { if (confirm(`Gỡ liên kết “${c.name}” khỏi khách hàng? Dự án và công việc vẫn được giữ.`)) act(async () => { await api.updateCustomerProject(selected, c.id, { unlink: true }); await loadCampaigns(selected); }); }}>Gỡ liên kết</button><button className="btn btn-sm cm-danger" disabled={busy} onClick={() => { if (confirm(`Xoá hẳn dự án “${c.name}”? Các công việc được giữ lại và gỡ khỏi dự án.`)) act(async () => { await api.deleteTaskProject(c.id); await loadCampaigns(selected); await load(); }); }}>Xoá</button></div>}</article>)}</div>
        </section>
      }</div>}
      </div>
      </div>
    </article>}
    {editingProject&&selected&&<ProjectEditDialog project={editingProject} onClose={()=>setEditingProject(null)} onSaved={()=>{setEditingProject(null);void loadCampaigns(selected);void load();}}/>}
    {sharing&&selected&&<CustomerMembers id={selected} onClose={()=>setSharing(false)} onChanged={()=>void load()}/>}
    {creating && <div className="cm-back"><section className="crm-new" role="dialog" aria-label="Thêm khách hàng"><h2>Thêm khách hàng</h2><label>Tên khách hàng<input className="bk-in" autoFocus maxLength={200} value={customerName} onChange={(e) => setCustomerName(e.target.value)} /></label><label>Liên kết tài liệu<select className="bk-in" value={mode} onChange={(e) => { setMode(e.target.value as typeof mode); setLocation(null); }}><option value="existing">Liên kết thư mục có sẵn</option><option value="new">Tạo thư mục khách hàng mới</option></select></label><button className="btn btn-gray" onClick={() => setPicker(true)}><Icon name="folder" size={16} />{location ? 'Đổi thư mục' : mode === 'new' ? 'Chọn thư mục cha trên Drive' : 'Chọn thư mục khách hàng'}</button>{location && <p className="crm-confirm">{mode === 'new' ? <>Khi xác nhận, tạo thư mục <b>{customerName.trim() || '(tên khách hàng)'}</b> trong <b>{location.kind === 'gdrive' ? location.label || location.id : location.dir}</b>. Thao tác dùng quyền ghi của tài khoản Drive đã kết nối.</> : <>Liên kết thư mục <b>{location.kind === 'gdrive' ? location.label || location.id : location.dir}</b> với khách hàng.</>}</p>}<footer><button className="btn btn-gray" disabled={busy} onClick={() => setCreating(false)}>Huỷ</button><button className="btn btn-primary" disabled={busy || !location || !customerName.trim()} onClick={create}>{busy ? 'Đang tạo…' : mode === 'new' ? 'Xác nhận tạo thư mục & khách hàng' : 'Xác nhận liên kết & tạo khách hàng'}</button></footer></section></div>}
    <FolderPicker open={picker} title={mode === 'new' ? 'Chọn thư mục cha' : 'Chọn thư mục khách hàng'} confirmLabel="Chọn thư mục này" onAddAccount={user.role === 'admin' ? () => { setPicker(false); setGoogle(true); } : undefined} onClose={() => setPicker(false)} onPick={(loc) => { setLocation(loc); setPicker(false); }} />
    {record && <CustomerForm key={record} id={record==='new'?null:record} onClose={()=>setRecord(null)} onChanged={load} onSaved={(id)=>{setRecord(null);load();select(id);}}/>}
    {importing && <CustomerImport onClose={()=>setImporting(false)} onImported={()=>{setImporting(false);load();if(selected)loadCampaigns(selected);}}/>}
    <GoogleConnect open={google} onClose={() => setGoogle(false)} onChanged={() => { setGoogle(false); setPicker(true); }} />
  </div>;
}
