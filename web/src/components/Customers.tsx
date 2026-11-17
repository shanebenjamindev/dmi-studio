import { useEffect, useState, type CSSProperties } from 'react';
import { api } from '../api';
import { mayAddCustomer, toast, useStore } from '../store';
import type { Brand, CustomerRecord, Loc, ServiceRef } from '../types';
import { askConfirm } from './AskDialog';
import { BrandLoading } from './BrandLoading';
import { CustomerBrandsTab } from './CustomerBrandsTab';
import { CustomerDashboard, type CustomerView } from './CustomerDashboard';
import { CustomerForm } from './CustomerForm';
import { CustomerImport } from './CustomerImport';
import { CustomerMembers } from './CustomerMembers';
import { CustomerSpaces } from './CustomerSpaces';
import { CustomerStages } from './CustomerStages';
import { CustomerContext, CustomerHistory, CustomerMembersTab, CustomerOverview, CustomerTasks } from './CustomerTabs';
import { FolderPicker } from './FolderPicker';
import { GoogleConnect } from './GoogleConnect';
import { useEntityRefresh } from './QuickCreate';
import { ReportList } from './Reports';
import { Icon, Menu } from './ui';
import { useCustomerStatuses } from './useCustomerStatuses';
import { CustomerDetail } from './Workspace';
import { Breadcrumb, Button, EmptyState, PageShell, PageTabs, type CrumbItem } from './kit';

type CustomerRow = CustomerRecord;
type Tab = 'overview' | 'campaigns' | 'tasks' | 'drive' | 'reports' | 'workspaces' | 'members' | 'history';

const LS_VIEW = 'dms.customerView';
const readView = (): CustomerView => {
  try {
    const v = localStorage.getItem(LS_VIEW) as CustomerView;
    return ['list', 'kanban', 'overview'].includes(v) ? v : 'list';
  } catch {
    return 'list';
  }
};

function parseCustomerHash() {
  const h = window.location.hash;
  const id = h.match(/^#customers\/((?:cu|cust|c)_\w+)/)?.[1] || null;
  const qStr = h.includes('?') ? h.slice(h.indexOf('?') + 1) : '';
  const qp = new URLSearchParams(qStr);
  const brandId = qp.get('brand') || null;
  return { id, brandId };
}

export function CustomersPage() {
  const user = useStore((s) => s.user)!;
  const statuses = useCustomerStatuses();
  const canCreate = mayAddCustomer();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [sharing, setSharing] = useState(false);
  const initialHash = parseCustomerHash();
  const [selected, setSelected] = useState<string | null>(initialHash.id);
  const [activeBrandId, setActiveBrandId] = useState<string | null>(initialHash.brandId);
  const [view, setViewState] = useState<CustomerView>(readView);
  const setView = (v: CustomerView) => {
    setViewState(v);
    try {
      localStorage.setItem(LS_VIEW, v);
    } catch {
      /* private mode */
    }
  };
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>(initialHash.brandId ? 'campaigns' : 'overview');
  const [brands, setBrands] = useState<Brand[]>([]);
  const [catalog, setCatalog] = useState<ServiceRef[]>([]);
  const [createBrandOpen, setCreateBrandOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [record, setRecord] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [location, setLocation] = useState<Loc | null>(null);
  const [picker, setPicker] = useState(false);
  const [importing, setImporting] = useState(false);
  const [google, setGoogle] = useState(false);

  useEffect(() => {
    api.serviceCatalog().then(setCatalog, () => setCatalog([]));
  }, []);

  const load = () =>
    api
      .customerDirectory()
      .then((rows) => {
        setCustomers(rows);
        setError('');
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

  const loadBrands = (id: string) => {
    api.customerBrands(id).then(setBrands, () => setBrands([]));
  };

  useEntityRefresh(() => {
    void load();
    if (selected) loadBrands(selected);
  });

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const change = () => {
      if (window.location.hash.startsWith('#customers')) {
        const parsed = parseCustomerHash();
        setSelected(parsed.id);
        setActiveBrandId(parsed.brandId);
        if (parsed.brandId) setTab('campaigns');
      }
    };
    window.addEventListener('hashchange', change);
    window.addEventListener('popstate', change);
    return () => {
      window.removeEventListener('hashchange', change);
      window.removeEventListener('popstate', change);
    };
  }, []);

  useEffect(() => {
    setBrands([]);
    if (selected) loadBrands(selected);
  }, [selected]);

  const select = (id: string | null) => {
    setSelected(id);
    setActiveBrandId(null);
    setTab('overview');
    if (!id) void load();
    const hash = id ? `#customers/${id}` : '#customers';
    if (window.location.hash !== hash) history.pushState(null, '', hash);
  };

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    act(async () => {
      if (!location || !customerName.trim()) return;
      const c = await api.createCustomer(
        { name: customerName.trim(), ...(mode === 'existing' ? { existingFolder: location } : {}) },
        mode === 'new' ? location : null,
      );
      setCreating(false);
      setCustomerName('');
      setLocation(null);
      await load();
      select(c.id);
    });

  const current = customers.find((c) => c.id === selected);
  const status = statuses.find((x) => x.id === current?.status);
  const manage = selected ? !!current?.canManage : canCreate;
  const activeBrand = activeBrandId ? brands.find((b) => b.id === activeBrandId) : null;

  const crumbs: CrumbItem[] = [{ label: 'Khách hàng', onClick: () => select(null) }];
  if (current) {
    crumbs.push({
      label: current.name,
      onClick: activeBrand
        ? () => {
            setActiveBrandId(null);
            history.replaceState(null, '', `#customers/${current.id}`);
          }
        : undefined,
    });
  }
  if (activeBrand) {
    crumbs.push({ label: activeBrand.name });
  }

  return (
    <div className={selected ? 'bsv-host' : 'ad-page tk-page tk-mailbox crm-page'}>
      {!selected ? (
        <section className="tk-list-pane" aria-label="Danh sách khách hàng">
          <CustomerDashboard
            customers={customers}
            selected={null}
            loading={loading}
            error={error}
            manage={canCreate}
            view={view}
            onViewChange={setView}
            onOpen={select}
            onEdit={(id) => setRecord(id)}
            onAdd={() => setRecord('new')}
            onImport={() => setImporting(true)}
            onDrive={() => {
              setCreating(true);
              setLocation(null);
            }}
            onRefresh={load}
          />
        </section>
      ) : (
        <div className="bsv-page crm-detail-shell">
          {!current ? (
            loading ? (
              <BrandLoading label="Đang tải khách hàng…" />
            ) : (
              <EmptyState
                icon="users"
                title={error ? 'Không tải được danh sách khách hàng' : 'Không tìm thấy khách hàng'}
                description={error || 'Khách hàng không tồn tại, đã bị xoá, hoặc bạn không có quyền truy cập.'}
                action={
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="secondary" size="sm" icon="left" onClick={() => select(null)}>
                      Về danh sách khách hàng
                    </Button>
                    {error && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setLoading(true);
                          void load();
                        }}
                      >
                        Thử lại
                      </Button>
                    )}
                  </div>
                }
              />
            )
          ) : (
            <PageShell
              breadcrumb={<Breadcrumb items={crumbs} />}
              title={current.name}
              subtitle={
                <div className="bsv-sub">
                  {status && (
                    <span className="crm-side-status" style={{ '--stage-color': status.color } as CSSProperties}>
                      {status.name}
                    </span>
                  )}
                  <span className="bsv-meta-sep">·</span>
                  <span>{brands.length} nhãn hàng</span>
                  <span className="bsv-meta-sep">·</span>
                  <span>{current.projects || 0} dịch vụ</span>
                  <span className="bsv-meta-sep">·</span>
                  <span>{current.completed || 0}/{current.tasks || 0} công việc</span>
                </div>
              }
              primaryAction={
                manage ? (
                  tab === 'campaigns' ? (
                    <Button variant="primary" icon="plus" onClick={() => setCreateBrandOpen(true)}>
                      Thêm nhãn hàng
                    </Button>
                  ) : (
                    <Button variant="primary" icon="edit" onClick={() => setRecord(selected)}>
                      Chỉnh sửa
                    </Button>
                  )
                ) : undefined
              }
              secondaryActions={
                <div className="bsv-sec-actions">
                  {manage && tab === 'campaigns' && (
                    <Button variant="secondary" size="sm" icon="edit" onClick={() => setRecord(selected)}>
                      Chỉnh sửa
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" icon="users" onClick={() => setSharing(true)}>
                    Thành viên
                  </Button>
                  <Menu
                    label="Tuỳ chọn khách hàng"
                    items={[
                      { label: 'Quản lý thành viên', icon: 'users', onClick: () => setTab('members') },
                      { label: 'Lịch sử thay đổi', icon: 'clock', onClick: () => setTab('history') },
                      {
                        label: 'Xoá khách hàng',
                        icon: 'trash',
                        danger: true,
                        hidden: !manage || !current.canDelete || busy,
                        onClick: async () => {
                          if (await askConfirm('Xoá khách hàng khỏi database? Giữ nguyên dịch vụ, công việc, báo cáo và file Drive.')) {
                            void act(async () => {
                              await api.deleteCustomer(selected);
                              select(null);
                              await load();
                            });
                          }
                        },
                      },
                    ]}
                  />
                </div>
              }
              tabs={
                <PageTabs
                  label="Các mục của khách hàng"
                  value={tab}
                  onChange={(nextTab) => setTab(nextTab)}
                  items={[
                    { value: 'overview', label: 'Tổng quan', icon: 'info' },
                    { value: 'campaigns', label: 'Nhãn hàng & Dịch vụ', icon: 'layers', count: brands.length || undefined },
                    { value: 'tasks', label: 'Công việc', icon: 'checklist', count: current.tasks || undefined },
                    { value: 'drive', label: 'Drive', icon: 'folder' },
                    { value: 'reports', label: 'Báo cáo', icon: 'file' },
                    { value: 'workspaces', label: 'Workspace', icon: 'boards' },
                    { value: 'members', label: 'Thành viên', icon: 'users' },
                    { value: 'history', label: 'Lịch sử', icon: 'clock' },
                  ]}
                />
              }
            >
              {tab === 'overview' && (
                <div className="crm-unified-overview">
                  <div className="crm-detail-stages">
                    <CustomerStages
                      status={current.status || ''}
                      disabled={!manage || busy}
                      onChange={(st) =>
                        void act(async () => {
                          await api.saveCustomerRecord(current.id, { status: st || null });
                          await load();
                        })
                      }
                    />
                  </div>
                  <div className="crm-detail-layout">
                    <div className="crm-detail-body">
                      <CustomerOverview key={selected} c={current} view={view} onTab={(t) => setTab(t as Tab)} onChanged={load} />
                    </div>
                    <CustomerContext c={current} onTab={(t) => setTab(t as Tab)} onChanged={load} />
                  </div>
                </div>
              )}

              {tab === 'campaigns' && (
                <CustomerBrandsTab
                  customerId={selected}
                  catalog={catalog}
                  manage={manage}
                  activeBrandId={activeBrandId}
                  createOpen={createBrandOpen}
                  onCreateHandled={() => setCreateBrandOpen(false)}
                  onSelectBrand={(bid) => {
                    setActiveBrandId(bid);
                    history.replaceState(null, '', bid ? `#customers/${selected}?brand=${encodeURIComponent(bid)}` : `#customers/${selected}`);
                  }}
                  onChanged={() => {
                    void load();
                    loadBrands(selected);
                  }}
                />
              )}

              {tab === 'tasks' && <CustomerTasks key={selected} id={selected} view={view} />}
              {tab === 'drive' && (
                <CustomerDetail
                  key={selected}
                  id={selected}
                  admin={manage}
                  canDelete={!!current.canDelete}
                  viewOnly={current.level === 'observer' || user.level === 'observer'}
                  onChanged={load}
                  onDeleted={() => {
                    select(null);
                    void load();
                  }}
                />
              )}
              {tab === 'reports' && <ReportList key={selected} customerId={selected} projectId="" driveFolder="" />}
              {tab === 'workspaces' && (
                <CustomerSpaces
                  key={selected}
                  id={selected}
                  name={current.name}
                  manage={manage}
                  catalog={catalog}
                  onChanged={() => {
                    void load();
                    loadBrands(selected);
                  }}
                />
              )}
              {tab === 'members' && <CustomerMembersTab key={selected} id={selected} onManage={() => setSharing(true)} />}
              {tab === 'history' && <CustomerHistory key={selected} id={selected} />}
            </PageShell>
          )}
        </div>
      )}

      {sharing && selected && <CustomerMembers id={selected} onClose={() => setSharing(false)} onChanged={() => void load()} />}
      {creating && (
        <div className="cm-back">
          <section className="crm-new" role="dialog" aria-label="Thêm khách hàng">
            <h2>Thêm khách hàng</h2>
            <label>
              Tên khách hàng
              <input className="bk-in" autoFocus maxLength={200} value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            </label>
            <label>
              Liên kết tài liệu
              <select
                className="bk-in"
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as typeof mode);
                  setLocation(null);
                }}
              >
                <option value="existing">Liên kết thư mục có sẵn</option>
                <option value="new">Tạo thư mục khách hàng mới</option>
              </select>
            </label>
            <button className="btn btn-gray" onClick={() => setPicker(true)}>
              <Icon name="folder" size={16} />
              {location ? 'Đổi thư mục' : mode === 'new' ? 'Chọn thư mục cha trên Drive' : 'Chọn thư mục khách hàng'}
            </button>
            {location && (
              <p className="crm-confirm">
                {mode === 'new' ? (
                  <>
                    Khi xác nhận, tạo thư mục <b>{customerName.trim() || '(tên khách hàng)'}</b> trong{' '}
                    <b>{location.kind === 'gdrive' ? location.label || location.id : location.dir}</b>. Thao tác dùng quyền ghi của tài khoản Drive đã kết nối.
                  </>
                ) : (
                  <>
                    Liên kết thư mục <b>{location.kind === 'gdrive' ? location.label || location.id : location.dir}</b> với khách hàng.
                  </>
                )}
              </p>
            )}
            <footer>
              <button className="btn btn-gray" disabled={busy} onClick={() => setCreating(false)}>
                Huỷ
              </button>
              <button className="btn btn-primary" disabled={busy || !location || !customerName.trim()} onClick={create}>
                {busy ? 'Đang tạo…' : mode === 'new' ? 'Xác nhận tạo thư mục & khách hàng' : 'Xác nhận liên kết & tạo khách hàng'}
              </button>
            </footer>
          </section>
        </div>
      )}
      <FolderPicker
        open={picker}
        title={mode === 'new' ? 'Chọn thư mục cha' : 'Chọn thư mục khách hàng'}
        confirmLabel="Chọn thư mục này"
        onAddAccount={
          user.role === 'admin'
            ? () => {
                setPicker(false);
                setGoogle(true);
              }
            : undefined
        }
        onClose={() => setPicker(false)}
        onPick={(loc) => {
          setLocation(loc);
          setPicker(false);
        }}
      />
      {record && (
        <CustomerForm
          key={record}
          id={record === 'new' ? null : record}
          onClose={() => setRecord(null)}
          onChanged={load}
          onSaved={(id) => {
            setRecord(null);
            void load();
            select(id);
          }}
        />
      )}
      {importing && (
        <CustomerImport
          onClose={() => setImporting(false)}
          onImported={() => {
            setImporting(false);
            void load();
            if (selected) loadBrands(selected);
          }}
        />
      )}
      <GoogleConnect
        open={google}
        onClose={() => setGoogle(false)}
        onChanged={() => {
          setGoogle(false);
          setPicker(true);
        }}
      />
    </div>
  );
}
