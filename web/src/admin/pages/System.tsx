// Cấu hình hệ thống: only what the server really has. What it is and holds; how long logs are kept and the address emails
// link to; where customer folders live and the Gmail account notifications are sent from (company admins); how much is
// stored; and backups, made by the server where it has a disk, or by a command on Cloudflare.
import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { Icon } from '../../components/ui';
import { NotificationSettings } from '../../components/NotificationSettings';
import { StorageSettings } from '../../components/Users';
import { admin } from '../api';
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

const KIND: Record<string, string> = { video: 'Video', image: 'Ảnh', audio: 'Âm thanh', render: 'Video đã xuất', voice: 'Giọng đọc', music: 'Nhạc', logo: 'Logo' };
export function Storage() {
  const can = useCan();
  const editable = can('settings.update');
  const load = useLoad(() => admin.storage(), []);
  const loadCheck = useLoad(() => admin.storageCheck(), []);

  const [days, setDays] = useState(30);
  const [cleanLogs, setCleanLogs] = useState(true);
  const [cleanSessions, setCleanSessions] = useState(true);
  const [cleanNotifs, setCleanNotifs] = useState(true);
  const [cleanSheets, setCleanSheets] = useState(true);
  const [cleanCards, setCleanCards] = useState(false);
  const [optimize, setOptimize] = useState(true);
  const [busy, setBusy] = useState(false);

  const handleClean = async () => {
    if (!editable) return;
    const timeLabel = days === 0 ? 'toàn bộ thời gian' : `cũ hơn ${days} ngày`;
    if (!confirm(`Bạn có chắc chắn muốn dọn dẹp các mục dữ liệu rác ${timeLabel} và tối ưu database?`)) return;

    setBusy(true);
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
    setBusy(false);
  };

  return (
    <>
      <PageHead
        title="Quản lý tệp và dung lượng"
        sub="Dung lượng cơ sở dữ liệu, file trên ổ đĩa máy chủ và dữ liệu lưu trong database. Video khách hàng nằm trên Google Drive, không tính ở đây."
        actions={
          <button
            type="button"
            className="btn btn-gray btn-sm"
            onClick={() => { void load.reload(); void loadCheck.reload(); }}
            disabled={load.loading || loadCheck.loading}
            title="Kiểm tra & tính toán lại toàn bộ dung lượng"
          >
            <Icon name="refresh" size={14} />
            <span>Kiểm tra lại</span>
          </button>
        }
      />
      <Async load={load}>{(d) => <>
        <div className="ax-kpis">
          <Kpi icon="layers" label="Cơ sở dữ liệu" value={d.database === null ? 'Không đo được' : fmtBytes(d.database)} hint={d.cloud ? 'Cloudflare D1' : 'SQLite trên máy chủ'} />
          <Kpi icon="film" label="File trên máy chủ" value={fmtBytes(d.files.reduce((a: number, f: any) => a + f.bytes, 0))} hint={`${fmtNum(d.files.reduce((a: number, f: any) => a + f.files, 0))} file · ${fmtNum(d.renders)} bản xuất`} />
          <Kpi icon="folder" label="Google Drive" value={`${d.drive.accounts} tài khoản`} hint={d.drive.root || 'Thư mục gốc mặc định'} />
          <Kpi icon="archive" label="Rác có thể dọn" value={loadCheck.data ? `${fmtNum(loadCheck.data.totalGarbage)} mục` : 'Đang tính…'} hint={loadCheck.data ? `Toàn vẹn: ${loadCheck.data.integrity}` : 'Đang kiểm tra SQLite'} />
        </div>
        <div className="ax-two">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <Section title="File trên ổ đĩa máy chủ">
              {d.files.length ? (
                <Table
                  rows={d.files.map((f: any) => ({ ...f, id: f.kind }))}
                  cols={[
                    { key: 'kind', label: 'Loại', render: (f: any) => KIND[f.kind] || f.kind },
                    { key: 'files', label: 'Số file', align: 'right', render: (f: any) => fmtNum(f.files) },
                    { key: 'bytes', label: 'Dung lượng', align: 'right', render: (f: any) => fmtBytes(f.bytes) },
                  ]}
                />
              ) : (
                <p className="note">{d.cloud ? 'Máy chủ cloud không lưu file trên ổ đĩa.' : 'Chưa có file nào.'}</p>
              )}
            </Section>

            <Section title="Dọn dẹp rác & Tối ưu hoá database">
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
                        disabled={busy || (!cleanLogs && !cleanSessions && !cleanNotifs && !cleanSheets && !cleanCards && !optimize)}
                        onClick={handleClean}
                      >
                        <Icon name="trash" size={14} />
                        <span>{busy ? 'Đang dọn dẹp…' : 'Dọn dẹp ngay'}</span>
                      </button>
                    ) : (
                      <p className="note" style={{ margin: 0 }}>Cần quyền "Cấu hình hệ thống · Sửa" để dọn dẹp database.</p>
                    )}
                    <button
                      type="button"
                      className="btn btn-gray btn-sm"
                      disabled={loadCheck.loading || busy}
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
          <Section title="Dữ liệu lưu trong database"><Table rows={d.inDatabase.map((x: any) => ({ ...x, id: x.key }))} cols={[{ key: 'label', label: 'Loại', render: (x: any) => x.label }, { key: 'files', label: 'Số mục', align: 'right', render: (x: any) => fmtNum(x.files) }, { key: 'bytes', label: 'Ước tính', align: 'right', render: (x: any) => fmtBytes(x.bytes) }]} /></Section>
        </div>
      </>}</Async>
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
        <Section title="Phục hồi"><p className="note">Cloudflare D1 giữ lịch sử 30 ngày (Time Travel). Phục hồi về một thời điểm bằng lệnh <code>wrangler d1 time-travel restore dmi-studio-db --timestamp=…</code>, hoặc nạp file .sql bằng <code>wrangler d1 execute dmi-studio-db --remote --file=…</code>. Làm ngoài giờ làm việc vì dữ liệu hiện tại sẽ bị thay.</p></Section>
      </>}</Async>
    </>
  );
}
