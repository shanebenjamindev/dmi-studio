// Cấu hình hệ thống: only what the server really has. What it is and holds; how long logs are kept and the address emails
// link to; where customer folders live and the Gmail account notifications are sent from (company admins); how much is
// stored; and backups, made by the server where it has a disk, or by a command on Cloudflare.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store';
import { Icon } from '../../components/ui';
import { NotificationSettings } from '../../components/NotificationSettings';
import { StorageSettings } from '../../components/Users';
import { SiteLockSettings } from '../../components/SiteLock';
import { admin } from '../api';
import { goAdmin } from '../nav';
import { PageHead, Section, Field, Kpi, Async, Empty, Badge, Table, useLoad, useCan, act, fmtNum, fmtBytes, fmtTime, fmtDate } from '../kit';

export function Info() {
  const load = useLoad(() => admin.system(), []);
  const COUNT: [string, string][] = [['users', 'Tài khoản hoạt động'], ['locked', 'Tài khoản đã khoá'], ['departments', 'Phòng ban'], ['teams', 'Nhóm'], ['roles', 'Vai trò'], ['sessions', 'Phiên đăng nhập đang mở'], ['tasks', 'Công việc'], ['projects', 'Dự án'], ['customers', 'Khách hàng'], ['boards', 'Board'], ['cards', 'Thẻ'], ['services', 'Dịch vụ']];
  return (
    <>
      <PageHead title="Thông tin hệ thống" sub="Phiên bản, nền tảng đang chạy, dữ liệu đang có và các kết nối." />
      <Async load={load}>{(d) => <>
        <div className="ax-kpis">{COUNT.map(([k, l]) => <Kpi key={k} label={l} value={fmtNum(d.counts[k])} />)}</div>
        <div className="ax-two">
          <Section title="Máy chủ"><dl className="ax-facts">
            <dt>Ứng dụng</dt><dd>{d.app.name} {d.app.version}</dd><dt>Nền tảng</dt><dd>{d.app.runtime}</dd><dt>Cơ sở dữ liệu</dt><dd>{d.app.database}</dd><dt>Lưu file</dt><dd>{d.app.storage}</dd>
            <dt>Trình dựng video</dt><dd>{d.app.editor ? <Badge tone="ok">Chạy được ở máy chủ này</Badge> : <Badge tone="muted">Chỉ chạy trên máy Mac</Badge>}</dd><dt>Giờ máy chủ</dt><dd>{fmtTime(d.app.serverTime)}</dd>
            {d.app.demo && <><dt>Chế độ</dt><dd><Badge tone="warn">Demo</Badge></dd></>}
          </dl></Section>
          <Section title="Kết nối"><dl className="ax-facts">
            <dt>Google Drive</dt><dd>{d.integrations.googleAccounts.length ? d.integrations.googleAccounts.join(', ') : 'Chưa kết nối'}</dd><dt>Thư mục gốc</dt><dd>{d.integrations.workspaceRoot || 'Mặc định'}</dd>
            <dt>Gmail gửi thông báo</dt><dd>{d.integrations.mailSender || 'Chưa kết nối'}</dd><dt>Meta Ads</dt><dd>{d.integrations.metaAds ? 'Đã cấu hình' : 'Chưa cấu hình'}</dd>
            <dt>Nhật ký</dt><dd>{fmtNum(d.logs.audit)} thao tác · {fmtNum(d.logs.logins)} đăng nhập{d.logs.since ? ` · từ ${fmtDate(d.logs.since)}` : ''} · lưu {d.logs.retentionDays} ngày</dd>
          </dl></Section>
        </div>
      </>}</Async>
    </>
  );
}

export function General() {
  const can = useCan(), user = useStore((s) => s.user)!, editable = can('settings.update');
  const load = useLoad(() => admin.settings(), []);
  const [f, setF] = useState({ logRetentionDays: 365, siteUrl: '', taskWorkspaceAuto: true }), [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (load.data) setF({ logRetentionDays: load.data.logRetentionDays, siteUrl: load.data.siteUrl, taskWorkspaceAuto: load.data.taskWorkspaceAuto }); }, [load.data]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const x: Record<string, string> = {}, min = load.data?.retentionMin || 90;
    if (!(f.logRetentionDays >= min && f.logRetentionDays <= 3650)) x.logRetentionDays = `Từ ${min} đến 3650 ngày`;
    if (f.siteUrl && !/^https?:\/\/[^\s/]+(\/\S*)?$/.test(f.siteUrl)) x.siteUrl = 'Địa chỉ phải bắt đầu bằng https://';
    setErrors(x); if (Object.keys(x).length) return;
    await act(() => admin.saveSettings(f), 'Đã lưu cấu hình', load.reload);
  };
  return (
    <>
      <PageHead title="Cấu hình chung" sub="Những cấu hình máy chủ đang dùng. Quyền vào trang theo phòng ban đặt ở Nhân viên › Phòng ban." />
      <Async load={load}>{() => (
        <form className="ax-card ax-form" onSubmit={save}>
          <fieldset disabled={!editable} className="ax-form">
            <Field label="Thời gian lưu nhật ký (ngày)" error={errors.logRetentionDays} hint="Nhật ký thao tác và đăng nhập cũ hơn sẽ tự xoá. Tối thiểu 90 ngày."><input className="bk-in" type="number" min={90} max={3650} value={f.logRetentionDays} onChange={(e) => setF({ ...f, logRetentionDays: Number(e.target.value) })} /></Field>
            <Field label="Địa chỉ trang dùng trong email" error={errors.siteUrl} hint="Các liên kết trong email thông báo mở địa chỉ này. Tự đặt khi kết nối Gmail; sửa nếu đổi tên miền."><input className="bk-in" type="url" value={f.siteUrl} onChange={(e) => setF({ ...f, siteUrl: e.target.value })} placeholder="https://…" /></Field>
            <label className="bk-check"><input type="checkbox" checked={f.taskWorkspaceAuto} onChange={(e) => setF({ ...f, taskWorkspaceAuto: e.target.checked })} />Tự đưa công việc mới lên Workspace (mỗi công việc là một thẻ trên board)</label>
          </fieldset>
          {editable ? <button className="btn btn-primary btn-sm">Lưu cấu hình</button> : <p className="note">Bạn chỉ xem được; đổi cấu hình cần quyền “Cấu hình hệ thống · Sửa”.</p>}
        </form>
      )}</Async>
      {user.role === 'admin' && <SiteLockSettings />}
      {user.role === 'admin' ? <StorageSettings /> : <p className="note">Thư mục gốc và tài khoản Google Drive do Super Admin cấu hình.</p>}
    </>
  );
}

export function NotificationConfig() {
  const user = useStore((s) => s.user)!;
  return (
    <>
      <PageHead title="Cấu hình thông báo" sub="Tài khoản Gmail gửi thông báo cho mọi người. Mỗi người tự bật nhận email trong Hồ sơ của tôi; nội dung thông báo gửi ở Thông báo › Tạo thông báo." />
      {user.role === 'admin' ? <div className="ax-card"><NotificationSettings site /></div> : <Empty icon="mail" title="Chỉ Super Admin kết nối tài khoản gửi" text="Tài khoản Gmail gửi thông báo dùng chung cho cả hệ thống nên chỉ Super Admin đổi được." />}
    </>
  );
}

export function Storage() {
  const can = useCan();
  const editable = can('settings.update');
  const [refreshing, setRefreshing] = useState(false);
  const [currentTab, setCurrentTab] = useState<'sources' | 'database' | 'files' | 'cleanup'>('sources');

  // Database table view state
  const [tableQuery, setTableQuery] = useState('');
  const [tableGroup, setTableGroup] = useState('all');
  const [tableSort, setTableSort] = useState<'bytes' | 'count' | 'name' | 'lastUpdated'>('bytes');
  const [tableReverse, setTableReverse] = useState(false);

  // Maintenance state
  const [days, setDays] = useState(30);
  const [cleanLogs, setCleanLogs] = useState(true);
  const [cleanSessions, setCleanSessions] = useState(true);
  const [cleanNotifs, setCleanNotifs] = useState(true);
  const [cleanSheets, setCleanSheets] = useState(true);
  const [cleanCards, setCleanCards] = useState(false);
  const [optimize, setOptimize] = useState(true);
  const [cleanBusy, setCleanBusy] = useState(false);

  const load = useLoad(() => admin.storage(), []);
  const loadCheck = useLoad(() => admin.storageCheck(), []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const freshData = await admin.storage(true);
      load.setData(freshData);
      await loadCheck.reload();
    } catch {}
    setRefreshing(false);
  };

  const handleClean = async () => {
    if (!editable) return;
    const timeLabel = days === 0 ? 'toàn bộ thời gian' : `cũ hơn ${days} ngày`;
    if (!confirm(`Bạn có chắc chắn muốn dọn dẹp các mục dữ liệu rác ${timeLabel} và tối ưu database?`)) return;

    setCleanBusy(true);
    await act(async () => {
      const res = await admin.storageClean({
        days,
        cleanLogs,
        cleanSessions,
        cleanNotifications: cleanNotifs,
        cleanSheetParts: cleanSheets,
        cleanArchivedCards: cleanCards,
        optimize,
      });
      return res;
    }, 'Đã dọn dẹp và tối ưu database thành công', async () => {
      await Promise.all([load.reload(), loadCheck.reload()]);
    });
    setCleanBusy(false);
  };

  return (
    <>
      <PageHead
        title="Quản lý tệp và dung lượng"
        sub="Audit và giám sát toàn bộ tài nguyên lưu trữ: Database Cloudflare D1, Google Drive, Tệp nội bộ và Static Assets."
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {load.data?.overview?.lastUpdated && (
              <span style={{ fontSize: 12, color: 'var(--sub)' }}>
                Đồng bộ: {fmtTime(load.data.overview.lastUpdated)}
              </span>
            )}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleRefresh}
              disabled={refreshing || load.loading}
              title="Quét và kiểm tra lại toàn bộ tài nguyên lưu trữ"
            >
              <Icon name="refresh" size={14} className={refreshing ? 'spin' : ''} />
              <span>{refreshing ? 'Đang quét…' : 'Làm mới & Quét lại'}</span>
            </button>
          </div>
        }
      />
      <Async load={load}>{(d) => {
        const ov = d.overview || {
          totalUsedBytes: d.database || 0,
          databaseBytes: d.database || 0,
          databaseRecords: 0,
          databaseTableCount: 0,
          fileStorageBytes: 0,
          fileCount: 0,
          driveBytes: 0,
          workersAssetsBytes: 909600,
          workersAssetsFiles: 139,
          lastUpdated: Date.now(),
        };

        const totalBytes = Math.max(1, ov.totalUsedBytes);
        const drivePct = Number(((ov.driveBytes / totalBytes) * 100).toFixed(1));
        const dbPct = Number(((ov.databaseBytes / totalBytes) * 100).toFixed(1));
        const filePct = Number(((ov.fileStorageBytes / totalBytes) * 100).toFixed(1));
        const assetsPct = Number(((ov.workersAssetsBytes / totalBytes) * 100).toFixed(1));

        const allTables: any[] = d.tables || [];
        const tableGroups = ['all', 'Board & Thẻ', 'Công việc & Dự án', 'Khách hàng (CRM)', 'Không gian làm việc', 'Tài khoản & Quyền', 'Tin nhắn Messenger', 'Nhật ký & Bảo mật', 'Bảng tính đã nhập', 'Thông báo & Email', 'Báo cáo & Ads', 'Hệ thống & Khác'];

        const q = tableQuery.trim().toLowerCase();
        const filteredTables = allTables.filter((t: any) => {
          if (tableGroup !== 'all' && t.group !== tableGroup) return false;
          if (q && !t.name.toLowerCase().includes(q) && !(t.group || '').toLowerCase().includes(q)) return false;
          return true;
        }).sort((a: any, b: any) => {
          let diff = 0;
          if (tableSort === 'bytes') diff = b.bytes - a.bytes;
          else if (tableSort === 'count') diff = b.count - a.count;
          else if (tableSort === 'name') diff = a.name.localeCompare(b.name);
          else if (tableSort === 'lastUpdated') diff = (b.lastUpdated || 0) - (a.lastUpdated || 0);
          return tableReverse ? -diff : diff;
        });

        const filesData = d.filesBreakdown || { totalFiles: 0, totalBytes: 0, byType: [], duplicates: [] };
        const driveData = d.driveDetails || { connected: false, accounts: [], rootFolder: null };

        return (
          <div className="storage-dashboard">
            {/* Top Overview Card */}
            <div className="storage-overview-card">
              <div className="ax-kpis" style={{ marginBottom: 16 }}>
                <Kpi
                  icon="layers"
                  label="Tổng dung lượng sử dụng"
                  value={fmtBytes(ov.totalUsedBytes)}
                  hint={`Drive: ${fmtBytes(ov.driveBytes)} · DB: ${fmtBytes(ov.databaseBytes)}`}
                />
                <Kpi
                  icon="layers"
                  label="Cơ sở dữ liệu (D1)"
                  value={fmtBytes(ov.databaseBytes)}
                  hint={`${fmtNum(ov.databaseRecords)} bản ghi · ${ov.databaseTableCount} bảng`}
                />
                <Kpi
                  icon="folder"
                  label="Google Drive"
                  value={fmtBytes(ov.driveBytes)}
                  hint={`${ov.driveAccountCount} TK · Quota ${ov.driveLimit ? fmtBytes(ov.driveLimit) : 'Không giới hạn'}`}
                />
                <Kpi
                  icon="film"
                  label="Tệp & Assets hệ thống"
                  value={fmtBytes(ov.fileStorageBytes + ov.workersAssetsBytes)}
                  hint={`${fmtNum(ov.fileCount + ov.workersAssetsFiles)} tệp (In-DB & Assets)`}
                />
              </div>

              {/* Visual Storage Distribution Bar */}
              <div className="storage-dist-wrap">
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600 }}>
                  <span>Phân bổ lưu trữ hệ thống</span>
                  <span style={{ color: 'var(--sub)' }}>Tổng: {fmtBytes(ov.totalUsedBytes)}</span>
                </div>
                <div className="storage-dist-bar">
                  {drivePct > 0 && <div className="storage-dist-seg" style={{ width: `${Math.max(drivePct, 2)}%`, background: '#16a34a' }} title={`Google Drive: ${fmtBytes(ov.driveBytes)} (${drivePct}%)`} />}
                  {dbPct > 0 && <div className="storage-dist-seg" style={{ width: `${Math.max(dbPct, 1)}%`, background: '#0c66e4' }} title={`Cloudflare D1: ${fmtBytes(ov.databaseBytes)} (${dbPct}%)`} />}
                  {filePct > 0 && <div className="storage-dist-seg" style={{ width: `${Math.max(filePct, 1)}%`, background: '#9333ea' }} title={`In-DB Blobs: ${fmtBytes(ov.fileStorageBytes)} (${filePct}%)`} />}
                  {assetsPct > 0 && <div className="storage-dist-seg" style={{ width: `${Math.max(assetsPct, 1)}%`, background: '#f59e0b' }} title={`App Assets: ${fmtBytes(ov.workersAssetsBytes)} (${assetsPct}%)`} />}
                </div>
                <div className="storage-dist-legend">
                  <span className="storage-legend-item"><i className="storage-legend-dot" style={{ background: '#16a34a' }} />Google Drive: <b>{fmtBytes(ov.driveBytes)}</b> ({drivePct}%)</span>
                  <span className="storage-legend-item"><i className="storage-legend-dot" style={{ background: '#0c66e4' }} />Cloudflare D1: <b>{fmtBytes(ov.databaseBytes)}</b> ({dbPct}%)</span>
                  <span className="storage-legend-item"><i className="storage-legend-dot" style={{ background: '#9333ea' }} />Tệp trong DB: <b>{fmtBytes(ov.fileStorageBytes)}</b> ({filePct}%)</span>
                  <span className="storage-legend-item"><i className="storage-legend-dot" style={{ background: '#f59e0b' }} />Workers Assets: <b>{fmtBytes(ov.workersAssetsBytes)}</b> ({assetsPct}%)</span>
                </div>
              </div>
            </div>

            {/* Sub Tabs Navigation */}
            <div className="storage-tabs-bar">
              <div className="storage-nav">
                <button
                  type="button"
                  className={`storage-nav-btn ${currentTab === 'sources' ? 'active' : ''}`}
                  onClick={() => setCurrentTab('sources')}
                >
                  <Icon name="layers" size={15} />
                  <span>Nguồn lưu trữ ({d.sources?.length || 7})</span>
                </button>
                <button
                  type="button"
                  className={`storage-nav-btn ${currentTab === 'database' ? 'active' : ''}`}
                  onClick={() => setCurrentTab('database')}
                >
                  <Icon name="lines" size={15} />
                  <span>Chi tiết Database ({allTables.length} bảng)</span>
                </button>
                <button
                  type="button"
                  className={`storage-nav-btn ${currentTab === 'files' ? 'active' : ''}`}
                  onClick={() => setCurrentTab('files')}
                >
                  <Icon name="film" size={15} />
                  <span>Tệp & Google Drive</span>
                </button>
                <button
                  type="button"
                  className={`storage-nav-btn ${currentTab === 'cleanup' ? 'active' : ''}`}
                  onClick={() => setCurrentTab('cleanup')}
                >
                  <Icon name="trash" size={15} />
                  <span>Dọn dẹp & Tối ưu ({fmtNum(d.cleanable?.totalGarbage || loadCheck.data?.totalGarbage || 0)} mục rác)</span>
                </button>
              </div>
            </div>

            {/* TAB 1: Nguồn lưu trữ (Storage by Source) */}
            {currentTab === 'sources' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <Section title="Thống kê theo nguồn lưu trữ (Storage by Source)">
                  <div className="ax-card flush">
                    <Table
                      rows={d.sources.map((s: any) => ({ ...s, id: s.source }))}
                      cols={[
                        {
                          key: 'source',
                          label: 'Nguồn lưu trữ (Storage Source)',
                          render: (s: any) => (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <b style={{ fontSize: 13.5 }}>{s.source}</b>
                              <small style={{ color: 'var(--sub)', fontSize: 11.5 }}>{s.note}</small>
                            </div>
                          ),
                        },
                        {
                          key: 'items',
                          label: 'Số mục / Chi tiết (Items)',
                          render: (s: any) => <span>{s.items}</span>,
                        },
                        {
                          key: 'usedBytes',
                          label: 'Dung lượng sử dụng (Used Storage)',
                          align: 'right',
                          render: (s: any) => (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                              <b>{fmtBytes(s.usedBytes)}</b>
                              {s.isActual ? (
                                <span className="storage-tag-actual">Thực tế</span>
                              ) : (
                                <span className="storage-tag-est">Ước tính</span>
                              )}
                            </div>
                          ),
                        },
                        {
                          key: 'status',
                          label: 'Trạng thái (Status)',
                          align: 'center',
                          render: (s: any) => (
                            <Badge tone={s.status === 'Active' || s.status === 'Connected' ? 'ok' : 'muted'}>
                              {s.status}
                            </Badge>
                          ),
                        },
                      ]}
                    />
                  </div>
                </Section>

                <div className="ax-two">
                  <Section title="Sức khoẻ & Kết nối lưu trữ">
                    <dl className="ax-facts">
                      <dt>Cơ sở dữ liệu</dt>
                      <dd><Badge tone="ok">Cloudflare D1 Active</Badge> ({d.overview?.databaseTableCount} bảng, {fmtNum(d.overview?.databaseRecords)} bản ghi)</dd>
                      <dt>Tính toàn vẹn</dt>
                      <dd><Badge tone={d.health?.integrity === 'OK' || d.health?.integrity === 'D1 Active' ? 'ok' : 'warn'}>{d.health?.integrity}</Badge></dd>
                      <dt>Google Drive API</dt>
                      <dd><Badge tone={driveData.connected ? 'ok' : 'warn'}>{driveData.connected ? 'OAuth2 v3 Đã kết nối' : 'Cần kiểm tra quyền'}</Badge></dd>
                      <dt>Môi trường máy chủ</dt>
                      <dd>{d.cloud ? 'Cloudflare Workers (Edge Serverless)' : 'Node.js Local Server'}</dd>
                      <dt>Dung lượng D1</dt>
                      <dd>Đã dùng {fmtBytes(ov.databaseBytes)} · còn lại {fmtBytes(Math.max(0, 500e6 - ov.databaseBytes))} · <button type="button" className="ax-kpi-link" onClick={() => goAdmin('system', 'hosting')}>Xem hosting và giới hạn</button></dd>
                    </dl>
                  </Section>

                  <Section title="Dữ liệu lưu trong Database (Nhóm chính)">
                    <Table
                      rows={d.inDatabase.map((x: any) => ({ ...x, id: x.key }))}
                      cols={[
                        { key: 'label', label: 'Loại dữ liệu', render: (x: any) => x.label },
                        { key: 'files', label: 'Số lượng', align: 'right', render: (x: any) => fmtNum(x.files) },
                        { key: 'bytes', label: 'Dung lượng ước tính', align: 'right', render: (x: any) => fmtBytes(x.bytes) },
                      ]}
                    />
                  </Section>
                </div>
              </div>
            )}

            {/* TAB 2: Chi tiết Database (Database Breakdown - 84 bảng) */}
            {currentTab === 'database' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                  <div className="storage-table-search">
                    <Icon name="search" size={14} />
                    <input
                      type="text"
                      placeholder="Tìm tên bảng hoặc nhóm…"
                      value={tableQuery}
                      onChange={(e) => setTableQuery(e.target.value)}
                    />
                    {tableQuery && (
                      <button type="button" onClick={() => setTableQuery('')} style={{ border: 0, background: 'none', cursor: 'pointer', padding: 2 }}>
                        <Icon name="x" size={12} />
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <span style={{ color: 'var(--sub)' }}>Sắp xếp theo:</span>
                    <select
                      className="bk-in"
                      style={{ height: 32, padding: '0 8px', fontSize: 12.5 }}
                      value={tableSort}
                      onChange={(e) => setTableSort(e.target.value as any)}
                    >
                      <option value="bytes">Dung lượng giảm dần</option>
                      <option value="count">Số bản ghi giảm dần</option>
                      <option value="name">Tên bảng A-Z</option>
                      <option value="lastUpdated">Mới cập nhật nhất</option>
                    </select>
                    <button
                      type="button"
                      className="btn btn-gray btn-sm"
                      onClick={() => setTableReverse(!tableReverse)}
                      title="Đảo ngược thứ tự sắp xếp"
                    >
                      <Icon name={tableReverse ? 'up' : 'down'} size={12} />
                    </button>
                  </div>
                </div>

                {/* Group Filter Chips */}
                <div className="storage-group-filters">
                  {tableGroups.map((g) => {
                    const countInGroup = g === 'all' ? allTables.length : allTables.filter((t: any) => t.group === g).length;
                    return (
                      <button
                        key={g}
                        type="button"
                        className={`storage-group-btn ${tableGroup === g ? 'active' : ''}`}
                        onClick={() => setTableGroup(g)}
                      >
                        {g === 'all' ? `Tất cả (${allTables.length})` : `${g} (${countInGroup})`}
                      </button>
                    );
                  })}
                </div>

                <div className="ax-card flush">
                  <Table
                    rows={filteredTables.map((t: any) => ({ ...t, id: t.name }))}
                    empty={<Empty icon="layers" title="Không tìm thấy bảng phù hợp" text="Thử tìm kiếm với từ khoá khác hoặc xoá bộ lọc nhóm." />}
                    cols={[
                      {
                        key: 'name',
                        label: 'Tên bảng (Table Name)',
                        render: (t: any) => (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <code style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</code>
                            <span style={{ fontSize: 11, color: 'var(--sub)' }}>({t.cols} cột)</span>
                          </div>
                        ),
                      },
                      {
                        key: 'group',
                        label: 'Phân nhóm (Group)',
                        render: (t: any) => (
                          <span style={{ fontSize: 11.5, background: 'var(--fill-2)', padding: '2px 8px', borderRadius: 4, color: 'var(--text)' }}>
                            {t.group}
                          </span>
                        ),
                      },
                      {
                        key: 'count',
                        label: 'Số bản ghi (Records)',
                        align: 'right',
                        render: (t: any) => <b>{fmtNum(t.count)}</b>,
                      },
                      {
                        key: 'bytes',
                        label: 'Dung lượng (Size)',
                        align: 'right',
                        render: (t: any) => (
                          <span style={{ fontWeight: 600, color: t.bytes > 50000 ? 'var(--primary)' : 'inherit' }}>
                            {fmtBytes(t.bytes)}
                          </span>
                        ),
                      },
                      {
                        key: 'pct',
                        label: '% Database',
                        align: 'right',
                        render: (t: any) => (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', width: 90 }}>
                            <div style={{ flex: 1, height: 6, background: 'var(--fill-2)', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ width: `${Math.min(100, Math.max(t.pct, t.bytes > 0 ? 3 : 0))}%`, height: '100%', background: 'var(--primary)' }} />
                            </div>
                            <span style={{ fontSize: 11, color: 'var(--sub)', width: 34, textAlign: 'right' }}>{t.pct}%</span>
                          </div>
                        ),
                      },
                      {
                        key: 'lastUpdated',
                        label: 'Cập nhật gần nhất',
                        align: 'right',
                        render: (t: any) => (
                          <small style={{ color: 'var(--sub)' }}>
                            {t.lastUpdated ? fmtDate(t.lastUpdated) : '—'}
                          </small>
                        ),
                      },
                    ]}
                  />
                </div>
                <p className="note" style={{ margin: '4px 0 0', fontSize: 12 }}>
                  * Toàn bộ <b>{allTables.length} bảng</b> được phát hiện động từ schema <code>sqlite_master</code>. Dung lượng ước tính dựa trên độ dài payload thực tế của từng cột cộng với chi phí hàng và B-tree index.
                </p>
              </div>
            )}

            {/* TAB 3: Tệp & Google Drive */}
            {currentTab === 'files' && (
              <div className="ax-two">
                {/* Left: File Manager Statistics */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  <Section title="Phân loại tệp lưu trữ (File Formats)">
                    <Table
                      rows={filesData.byType.map((f: any, idx: number) => ({ ...f, id: `${f.type}-${idx}` }))}
                      cols={[
                        { key: 'label', label: 'Định dạng / Mục đích', render: (f: any) => <b>{f.label}</b> },
                        { key: 'location', label: 'Vị trí lưu trữ', render: (f: any) => <span style={{ fontSize: 11.5, color: 'var(--sub)' }}>{f.location}</span> },
                        { key: 'files', label: 'Số file', align: 'right', render: (f: any) => fmtNum(f.files) },
                        { key: 'bytes', label: 'Dung lượng', align: 'right', render: (f: any) => fmtBytes(f.bytes) },
                      ]}
                    />
                  </Section>

                  {filesData.duplicates?.length > 0 && (
                    <Section title="Cảnh báo tệp trùng lặp (Duplicate Detection)">
                      <div className="ax-card" style={{ borderLeft: '3px solid #f59e0b', gap: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: '#b45309' }}>
                          <Icon name="info" size={16} />
                          <span>Phát hiện {filesData.duplicates.length} mục có dữ liệu trùng lặp dung lượng</span>
                        </div>
                        <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--text)' }}>
                          {filesData.duplicates.map((dup: any, i: number) => (
                            <li key={i}>
                              <b>{dup.name}</b> ({fmtBytes(dup.bytes)}) — xuất hiện <b>{dup.copies} lần</b> ({dup.source})
                            </li>
                          ))}
                        </ul>
                        <small style={{ color: 'var(--sub)', marginTop: 4 }}>
                          Bạn có thể dùng công cụ Dọn dẹp rác để xoá các phần file tạm bảng tính mồ côi.
                        </small>
                      </div>
                    </Section>
                  )}
                </div>

                {/* Right: Google Drive Details */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  <Section title="Tài khoản Google Drive kết nối">
                    {driveData.accounts?.length ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {driveData.accounts.map((acc: any) => {
                          const driveUsed = acc.usageInDrive || 0;
                          const totalQuota = acc.limit || 0;
                          const accUsed = acc.usage || 0;
                          const usedPct = totalQuota > 0 ? Number(((accUsed / totalQuota) * 100).toFixed(1)) : 0;

                          return (
                            <div key={acc.email} className="storage-account-card">
                              <div className="storage-account-header">
                                {acc.picture ? (
                                  <img src={acc.picture} alt="" style={{ width: 44, height: 44, borderRadius: '50%' }} />
                                ) : (
                                  <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--fill-2)', display: 'grid', placeItems: 'center' }}>
                                    <Icon name="users" size={20} />
                                  </div>
                                )}
                                <div className="storage-account-info">
                                  <div className="storage-account-name">{acc.name}</div>
                                  <div className="storage-account-email">{acc.email}</div>
                                </div>
                                <Badge tone={acc.status === 'connected' ? 'ok' : 'warn'}>
                                  {acc.status === 'connected' ? 'Đã kết nối' : 'Lỗi'}
                                </Badge>
                              </div>

                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                                  <span>Dung lượng Google Drive của DMI</span>
                                  <b>{fmtBytes(driveUsed)}</b>
                                </div>
                                <div className="storage-progress-track">
                                  <div className="storage-progress-fill" style={{ width: `${Math.min(100, Math.max(usedPct, 1))}%`, background: '#16a34a' }} />
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--sub)' }}>
                                  <span>Toàn tài khoản Google: {fmtBytes(accUsed)} / {totalQuota ? fmtBytes(totalQuota) : 'Không giới hạn'}</span>
                                  <span>{usedPct}% Quota</span>
                                </div>
                              </div>

                              <dl className="ax-facts" style={{ margin: 0, fontSize: 12.5 }}>
                                <dt>Tệp trong thùng rác Drive</dt>
                                <dd><b>{fmtBytes(acc.usageInDriveTrash || 0)}</b></dd>
                                <dt>Quyền truy cập</dt>
                                <dd><Badge tone="ok">https://www.googleapis.com/auth/drive</Badge></dd>
                              </dl>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="note">Chưa có tài khoản Google Drive nào được kết nối.</p>
                    )}
                  </Section>

                  <Section title="Thư mục gốc quản trị dự án">
                    {driveData.rootFolder ? (
                      <div className="ax-card" style={{ gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ color: '#0c66e4', display: 'inline-flex' }}><Icon name="folder" size={20} /></span>
                          <b style={{ fontSize: 14 }}>{driveData.rootFolder.name}</b>
                        </div>
                        <dl className="ax-facts" style={{ margin: '4px 0 0' }}>
                          <dt>Mã thư mục (ID)</dt>
                          <dd><code style={{ fontSize: 12 }}>{driveData.rootFolder.id}</code></dd>
                          <dt>Tài khoản sở hữu</dt>
                          <dd>{driveData.rootFolder.account}</dd>
                          <dt>Số thư mục khách hàng</dt>
                          <dd><b>{fmtNum(driveData.rootFolder.subfolderCount)}</b> thư mục khách hàng trực tiếp</dd>
                        </dl>
                      </div>
                    ) : (
                      <p className="note">Chưa cấu hình thư mục gốc Google Drive.</p>
                    )}
                  </Section>
                </div>
              </div>
            )}

            {/* TAB 4: Dọn dẹp rác & Tối ưu hoá */}
            {currentTab === 'cleanup' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <Section title="Kiểm tra & Dọn dẹp rác Database">
                  {loadCheck.data ? (
                    <div className="ax-card ax-form" style={{ gap: 14 }}>
                      <dl className="ax-facts" style={{ marginBottom: 4 }}>
                        <dt>Tính toàn vẹn</dt>
                        <dd><Badge tone={loadCheck.data.integrity === 'OK' || loadCheck.data.integrity === 'D1 Active' ? 'ok' : 'warn'}>{loadCheck.data.integrity}</Badge></dd>
                        <dt>Phiên hết hạn</dt>
                        <dd><b>{fmtNum(loadCheck.data.expiredSessions)}</b> phiên</dd>
                        <dt>Nhật ký hệ thống cũ</dt>
                        <dd><b>{fmtNum(loadCheck.data.oldAuditLogs + loadCheck.data.oldLoginLogs)}</b> mục ({fmtNum(loadCheck.data.oldAuditLogs)} thao tác, {fmtNum(loadCheck.data.oldLoginLogs)} đăng nhập)</dd>
                        <dt>Thông báo đã đọc</dt>
                        <dd><b>{fmtNum(loadCheck.data.oldNotifications)}</b> thông báo</dd>
                        <dt>Bảng tính mồ côi</dt>
                        <dd><b>{fmtNum(loadCheck.data.orphanedSheetParts)}</b> phần file tạm</dd>
                        <dt>Thẻ đã lưu trữ</dt>
                        <dd><b>{fmtNum(loadCheck.data.archivedCards)}</b> thẻ</dd>
                      </dl>

                      <Field label="Khoảng thời gian dọn dẹp" hint="Áp dụng cho nhật ký hệ thống, phiên đăng nhập, thông báo và thẻ lưu trữ.">
                        <select className="bk-in" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                          <option value={7}>Cũ hơn 7 ngày</option>
                          <option value={30}>Cũ hơn 30 ngày (Khuyến nghị)</option>
                          <option value={90}>Cũ hơn 90 ngày</option>
                          <option value={0}>Xoá tất cả log & rác</option>
                        </select>
                      </Field>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <label className="bk-check">
                          <input type="checkbox" checked={cleanLogs} onChange={(e) => setCleanLogs(e.target.checked)} />
                          Xoá nhật ký thao tác & lịch sử đăng nhập cũ
                        </label>
                        <label className="bk-check">
                          <input type="checkbox" checked={cleanSessions} onChange={(e) => setCleanSessions(e.target.checked)} />
                          Dọn dẹp phiên đăng nhập đã hết hạn
                        </label>
                        <label className="bk-check">
                          <input type="checkbox" checked={cleanNotifs} onChange={(e) => setCleanNotifs(e.target.checked)} />
                          Dọn thông báo hệ thống cũ đã đọc
                        </label>
                        <label className="bk-check">
                          <input type="checkbox" checked={cleanSheets} onChange={(e) => setCleanSheets(e.target.checked)} />
                          Dọn các phần file tạm bảng tính mồ côi
                        </label>
                        <label className="bk-check">
                          <input type="checkbox" checked={cleanCards} onChange={(e) => setCleanCards(e.target.checked)} />
                          Xoá vĩnh viễn thẻ công việc đã lưu trữ (Archived cards)
                        </label>
                        <label className="bk-check">
                          <input type="checkbox" checked={optimize} onChange={(e) => setOptimize(e.target.checked)} />
                          Tối ưu hoá & giải phóng dung lượng (VACUUM / PRAGMA optimize)
                        </label>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                        {editable ? (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={cleanBusy || (!cleanLogs && !cleanSessions && !cleanNotifs && !cleanSheets && !cleanCards && !optimize)}
                            onClick={handleClean}
                          >
                            <Icon name="trash" size={14} />
                            <span>{cleanBusy ? 'Đang dọn dẹp…' : 'Dọn dẹp ngay'}</span>
                          </button>
                        ) : (
                          <p className="note" style={{ margin: 0 }}>Cần quyền "Cấu hình hệ thống · Sửa" để dọn dẹp database.</p>
                        )}
                        <button
                          type="button"
                          className="btn btn-gray btn-sm"
                          disabled={loadCheck.loading || cleanBusy}
                          onClick={() => void loadCheck.reload()}
                        >
                          <Icon name="refresh" size={13} />
                          <span>Kiểm tra rác</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="note">Đang kiểm tra rác hệ thống…</p>
                  )}
                </Section>
              </div>
            )}
          </div>
        );
      }}</Async>
    </>
  );
}

export function Backup() {
  const can = useCan();
  const load = useLoad(() => admin.backups(), []);
  const [busy, setBusy] = useState(false);
  const make = async () => { setBusy(true); await act(() => admin.backup(), 'Đã tạo bản sao lưu', load.reload); setBusy(false); };
  return (
    <>
      <PageHead title="Sao lưu và phục hồi dữ liệu" sub="Bản sao lưu là bản sao toàn bộ cơ sở dữ liệu (tài khoản, công việc, khách hàng, board, nhật ký…). File trên Google Drive không nằm trong bản sao lưu."
        actions={load.data?.supported && can('settings.update') && <button className="btn btn-primary btn-sm" disabled={busy} onClick={make}><Icon name="download" size={14} />{busy ? 'Đang sao lưu…' : 'Tạo bản sao lưu'}</button>} />
      <Async load={load}>{(d) => d.supported ? <>
        <div className="ax-card flush"><Table rows={d.items.map((b) => ({ ...b, id: b.name }))} empty={<Empty icon="archive" title="Chưa có bản sao lưu" text="Bản sao lưu được lưu trong thư mục data/backups của máy chủ." />} cols={[
          { key: 'name', label: 'Bản sao lưu', render: (b) => <span className="mono">{b.name}</span> },
          { key: 'at', label: 'Thời gian', render: (b) => fmtTime(b.at) },
          { key: 'bytes', label: 'Dung lượng', align: 'right', render: (b) => fmtBytes(b.bytes) },
          { key: 'x', label: '', align: 'right', render: (b) => can('settings.update') ? <a className="btn btn-gray btn-sm" href={`/api/admin/backups/${encodeURIComponent(b.name)}`} download><Icon name="download" size={13} />Tải về</a> : null },
        ]} /></div>
        <Section title="Phục hồi"><p className="note">Phục hồi thay toàn bộ dữ liệu hiện tại của mọi người nên không làm từ giao diện. Cách làm: dừng máy chủ, sao lưu file <code>data/studio.db</code> hiện tại, chép bản sao lưu đè lên <code>data/studio.db</code> (xoá <code>studio.db-wal</code> và <code>studio.db-shm</code> nếu có), rồi chạy lại máy chủ.</p></Section>
      </> : <>
        <Section title="Sao lưu trên Cloudflare D1"><p className="note">Máy chủ cloud không có ổ đĩa để tạo file sao lưu. Trên máy đã đăng nhập Cloudflare, chạy lệnh dưới đây trong thư mục dự án để xuất toàn bộ database ra <code>data/backups/d1-latest.sql</code>:</p><pre className="ax-code">{d.command}</pre></Section>
        <Section title="Phục hồi"><p className="note">Cloudflare D1 giữ lịch sử 7 ngày (Time Travel). Phục hồi về một thời điểm bằng lệnh <code>wrangler d1 time-travel restore dmi-studio-db --timestamp=…</code>, hoặc nạp file .sql bằng <code>wrangler d1 execute dmi-studio-db --remote --file=…</code>. Làm ngoài giờ làm việc vì dữ liệu hiện tại sẽ bị thay.</p></Section>
      </>}</Async>
    </>
  );
}
