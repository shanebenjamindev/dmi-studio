// Cấu hình hệ thống: what the server is and holds, the settings the backend has (how long logs are kept, the address
// emails link to), how much is stored where, and backups. A backup is made by the server only where it has a disk (the
// Mac or a Node server: a copy of the SQLite database); on Cloudflare D1 the page shows the command that exports it.
// Restoring is not offered here: it replaces everyone's data and is done by hand (DEPLOY.md).
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, now, getSetting, setSetting, cloudDatabase } from '../db';
import { HttpError, json, readJson, sendFile, type Router } from '../http';
import { DATA_DIR, IS_CLOUDFLARE, CLOUD_STORAGE_ONLY, FFMPEG } from '../config';
import { RETENTION_DEFAULT, RETENTION_MIN } from '../audit';
import * as G from '../google';
import { need, changed, logAction } from './common';
import { LOCK_MESSAGE, setSiteLock, siteLock } from '../site-lock';

const BACKUPS = path.join(DATA_DIR, 'backups');
const BACKUP_NAME = /^studio-\d{8}-\d{6}\.db$/;
const n = async (sql: string, ...args: (string | number)[]) => Number((await get<any>(sql, ...args))?.n || 0);
const canBackUp = !IS_CLOUDFLARE && !cloudDatabase;

export function registerSystem(api: Router) {
  api.get('/api/admin/system', async (req, res) => {
    await need(req, 'settings.view');
    const mail = await getSetting<{ email?: string } | null>('notification_mail', null), root = await getSetting<{ label?: string } | null>('workspace_root', null);
    json(res, 200, {
      app: { name: 'DMI Workspace', version: '2.0.0', runtime: IS_CLOUDFLARE ? 'Cloudflare Workers' : `Node.js ${process.version}`, database: cloudDatabase ? 'Cloudflare D1' : 'SQLite (data/studio.db)',
        storage: CLOUD_STORAGE_ONLY ? 'Google Drive' : 'Ổ đĩa máy chủ và Google Drive', editor: !CLOUD_STORAGE_ONLY && !!FFMPEG, ffmpeg: !!FFMPEG, serverTime: now() },
      counts: {
        users: await n('SELECT COUNT(*) n FROM users WHERE disabled = 0'), locked: await n('SELECT COUNT(*) n FROM users WHERE disabled = 1'), departments: await n('SELECT COUNT(*) n FROM team_roles'),
        teams: await n('SELECT COUNT(*) n FROM teams WHERE deleted_at IS NULL'), roles: await n('SELECT COUNT(*) n FROM roles'), tasks: await n('SELECT COUNT(*) n FROM tasks WHERE stub = 0'),
        projects: await n('SELECT COUNT(*) n FROM task_projects'), customers: await n('SELECT COUNT(*) n FROM customers WHERE archived_at IS NULL'), boards: await n('SELECT COUNT(*) n FROM boards'),
        cards: await n('SELECT COUNT(*) n FROM board_cards WHERE archived = 0'), services: await n('SELECT COUNT(*) n FROM services WHERE deleted_at IS NULL'), sessions: await n('SELECT COUNT(*) n FROM sessions WHERE expires_at > ?', now()),
      },
      integrations: { googleAccounts: (await G.accounts()).map((a) => a.email), mailSender: mail?.email || null, workspaceRoot: root?.label || null, metaAds: !!(await getSetting('ads_config', null)) },
      logs: { retentionDays: Number(await getSetting('log_retention_days', RETENTION_DEFAULT)), audit: await n('SELECT COUNT(*) n FROM audit_logs'), logins: await n('SELECT COUNT(*) n FROM login_logs'),
        since: Number((await get<any>('SELECT MIN(created_at) n FROM audit_logs'))?.n) || null },
    });
  });
  api.get('/api/admin/settings', async (req, res) => {
    await need(req, 'settings.view');
    json(res, 200, { logRetentionDays: Number(await getSetting('log_retention_days', RETENTION_DEFAULT)), siteUrl: await getSetting('notification_site_url', process.env.PUBLIC_URL || ''), retentionMin: RETENTION_MIN,
      taskWorkspaceAuto: !!(await getSetting('task_workspace_auto', true)) });
  });
  api.put('/api/admin/settings', async (req, res) => {
    const c = await need(req, 'settings.update'), b = await readJson(req);
    const before = { logRetentionDays: Number(await getSetting('log_retention_days', RETENTION_DEFAULT)), siteUrl: String(await getSetting('notification_site_url', '')), taskWorkspaceAuto: !!(await getSetting('task_workspace_auto', true)) };
    const after = { ...before };
    if (b.logRetentionDays !== undefined) {
      const d = Math.round(Number(b.logRetentionDays));
      if (!Number.isFinite(d) || d < RETENTION_MIN || d > 3650) throw new HttpError(400, `Thời gian lưu nhật ký từ ${RETENTION_MIN} đến 3650 ngày`);
      after.logRetentionDays = d; await setSetting('log_retention_days', d);
    }
    if (b.siteUrl !== undefined) {
      const u = String(b.siteUrl || '').trim().replace(/\/+$/, '');
      if (u && !/^https?:\/\/[^\s/]+(\/\S*)?$/.test(u)) throw new HttpError(400, 'Địa chỉ trang phải bắt đầu bằng https://');
      after.siteUrl = u; await setSetting('notification_site_url', u || null);
    }
    // New tasks get a card on Workspace by themselves (on by default); off, a task goes there when linked or synced.
    if (b.taskWorkspaceAuto !== undefined) { after.taskWorkspaceAuto = !!b.taskWorkspaceAuto; await setSetting('task_workspace_auto', after.taskWorkspaceAuto); }
    await changed(c, { action: 'Đổi cấu hình chung', type: 'settings', id: 'general', label: 'Cấu hình chung', before, after });
    json(res, 200, after);
  });
  // Locking the site shuts everyone else out, so it is the Super Admins' alone (not whoever may change settings).
  api.get('/api/admin/site-lock', async (req, res) => {
    await need(req, 'settings.view');
    json(res, 200, await siteLock());
  });
  api.put('/api/admin/site-lock', async (req, res) => {
    const c = await need(req, 'settings.update'), b = await readJson(req);
    if (c.user.role !== 'admin') throw new HttpError(403, 'Chỉ Super Admin mới khoá hoặc mở khoá website');
    const before = await siteLock(), message = b.message !== undefined ? String(b.message || '').trim().slice(0, 300) : before.message;
    const after = await setSiteLock(!!b.on, message || LOCK_MESSAGE, c.user.id);
    await changed(c, { action: after.on ? 'Khoá tạm website' : 'Mở khoá website', type: 'settings', id: 'site_lock', label: 'Khoá website', before: { on: before.on, message: before.message }, after: { on: after.on, message: after.message } });
    json(res, 200, after);
  });
  let lastAuditCache: { data: any; time: number } | null = null;

  api.get('/api/admin/storage', async (req, res) => {
    await need(req, 'settings.view');
    const url = new URL(req.url || '/', 'http://localhost');
    const forceRefresh = url.searchParams.get('refresh') === 'true' || url.searchParams.get('refresh') === '1';

    if (!forceRefresh && lastAuditCache && (Date.now() - lastAuditCache.time < 25000)) {
      return json(res, 200, lastAuditCache.data);
    }

    const size = (f: string) => { try { return fs.statSync(f).size; } catch { return 0; } };
    let database: number | null = null;
    let databaseIsActual = false;
    if (!cloudDatabase) {
      database = size(path.join(DATA_DIR, 'studio.db')) + size(path.join(DATA_DIR, 'studio.db-wal'));
      databaseIsActual = true;
    } else {
      try {
        const pcRow = await get<any>('PRAGMA page_count');
        const psRow = await get<any>('PRAGMA page_size');
        const pc = Number(pcRow?.page_count ?? (pcRow ? Object.values(pcRow)[0] : null));
        const ps = Number(psRow?.page_size ?? (psRow ? Object.values(psRow)[0] : null));
        if (Number.isFinite(pc) && pc > 0 && Number.isFinite(ps) && ps > 0) {
          database = pc * ps;
          databaseIsActual = true;
        }
      } catch {
        database = null;
      }
    }
    const safeCount = async (sql: string) => { try { return await n(sql); } catch { return 0; } };
    const safeBytes = async (sql: string) => { try { return await n(sql); } catch { return 0; } };

    // 1. Audit ALL tables in Database dynamically via sqlite_master
    const rawTables = await all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name ASC"
    ).catch(() => []);

    const tables: Array<{
      name: string;
      count: number;
      bytes: number;
      pct: number;
      group: string;
      lastUpdated: number | null;
      cols: number;
    }> = [];

    let totalDbDataBytes = 0;
    let totalRecords = 0;

    for (const { name } of rawTables) {
      const cRow = await get<any>('SELECT COUNT(*) c FROM ' + name).catch(() => ({ c: 0 }));
      const count = Number(cRow?.c || 0);
      totalRecords += count;
      const cols = await all<any>('PRAGMA table_info(' + name + ')').catch(() => []);

      let bytes = 0;
      if (count > 0 && cols.length > 0) {
        const sumExpr = cols.map((c: any) => `COALESCE(LENGTH(${c.name}), 0)`).join(' + ');
        const bRow = await get<any>(`SELECT SUM(${sumExpr} + 24) s FROM ${name}`).catch(() => ({ s: 0 }));
        bytes = Number(bRow?.s || 0);
      }
      totalDbDataBytes += bytes;

      const dateCol = cols.find((c: any) => c.name === 'updated_at') ||
        cols.find((c: any) => c.name === 'created_at') ||
        cols.find((c: any) => ['happened_at', 'at', 'read_at'].includes(c.name));
      let lastUpdated: number | null = null;
      if (dateCol && count > 0) {
        const row = await get<any>(`SELECT MAX(${dateCol.name}) m FROM ${name}`).catch(() => null);
        lastUpdated = row?.m ? Number(row.m) : null;
      }

      let group = 'Hệ thống & Khác';
      if (name.startsWith('board_') || name === 'boards' || name.startsWith('card_') || name === 'checklist_items' || name === 'inbox_cards') {
        group = 'Board & Thẻ';
      } else if (name === 'tasks' || name.startsWith('task_')) {
        if (name.includes('sheet') || name === 'task_imports') group = 'Bảng tính đã nhập';
        else group = 'Công việc & Dịch vụ';
      } else if (name.startsWith('customer_') || name === 'customers') {
        group = 'Khách hàng (CRM)';
      } else if (name.startsWith('workspace_') || name === 'workspaces') {
        group = 'Không gian làm việc';
      } else if (name.startsWith('user_') || name === 'users' || name.startsWith('role') || name.startsWith('team') || name === 'dept_roles') {
        group = 'Tài khoản & Quyền';
      } else if (name.startsWith('chat_')) {
        group = 'Tin nhắn Messenger';
      } else if (name.includes('log') || name === 'login_attempts') {
        group = 'Nhật ký & Bảo mật';
      } else if (name.startsWith('notification_') || name === 'notifications' || name === 'mail_outbox') {
        group = 'Thông báo & Email';
      } else if (name.startsWith('report_') || name === 'reports' || name === 'ads_services') {
        group = 'Báo cáo & Ads';
      }

      tables.push({ name, count, bytes, pct: 0, group, lastUpdated, cols: cols.length });
    }

    for (const t of tables) {
      t.pct = totalDbDataBytes > 0 ? Number(((t.bytes / totalDbDataBytes) * 100).toFixed(1)) : 0;
    }

    if (!database || database <= 0) {
      database = Math.max(1024 * 1024, Math.round(totalDbDataBytes * 1.45));
    }

    // 2. Google Drive Live API Quota Audit
    const gAccounts = await G.accounts().catch(() => []);
    const driveAccounts: any[] = [];
    let totalDriveBytes = 0;
    let totalDriveTrashBytes = 0;
    let totalGoogleUsage = 0;
    let totalGoogleLimit = 0;

    for (const a of gAccounts) {
      try {
        const token = await G.accessToken(a.email, forceRefresh);
        const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota,user', {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(6000),
        });
        const data: any = await res.json().catch(() => ({}));
        const q = data.storageQuota || {};
        const usageInDrive = Number(q.usageInDrive || 0);
        const usageInDriveTrash = Number(q.usageInDriveTrash || 0);
        const usage = Number(q.usage || 0);
        const limit = q.limit ? Number(q.limit) : null;
        totalDriveBytes += usageInDrive;
        totalDriveTrashBytes += usageInDriveTrash;
        totalGoogleUsage += usage;
        if (limit) totalGoogleLimit += limit;
        driveAccounts.push({
          email: a.email,
          name: data.user?.displayName || a.name || a.email,
          picture: data.user?.photoLink || a.picture || '',
          status: 'connected',
          usageInDrive,
          usageInDriveTrash,
          usage,
          limit,
        });
      } catch (err: any) {
        driveAccounts.push({
          email: a.email,
          name: a.name || a.email,
          picture: a.picture || '',
          status: 'error',
          error: err.message,
        });
      }
    }

    const rootSetting = await getSetting<{ label?: string; id?: string; account?: string } | null>('workspace_root', null);
    let rootFolderDetails: any = null;
    if (rootSetting && rootSetting.id && rootSetting.account) {
      let subfolderCount = 0;
      try {
        const subfolders = await G.listFolders(rootSetting.account, rootSetting.id);
        subfolderCount = subfolders.length;
      } catch {}
      rootFolderDetails = {
        id: rootSetting.id,
        name: rootSetting.label || 'Mặc định',
        account: rootSetting.account,
        subfolderCount,
      };
    }

    // 3. File Manager & In-DB Blobs Audit
    const avatars = await all<any>(
      "SELECT u.name, 'Avatar (' || a.mime || ')' as type, CAST(LENGTH(a.data)*3/4 AS INTEGER) as bytes, a.updated_at as date, 'Cloudflare D1 (In-DB)' as source FROM user_avatars a JOIN users u ON u.id = a.user_id"
    ).catch(() => []);
    const reports = await all<any>(
      "SELECT file as name, 'Ảnh báo cáo (' || mime || ')' as type, CAST(LENGTH(data)*3/4 AS INTEGER) as bytes, NULL as date, 'Cloudflare D1 (In-DB)' as source FROM report_images"
    ).catch(() => []);
    const sheets = await all<any>(
      "SELECT COALESCE(s.name, 'Bảng tính') || ' (Phần ' || p.part || ')' as name, 'Bảng tính Excel/CSV' as type, LENGTH(p.data) as bytes, NULL as date, 'Cloudflare D1 (In-DB)' as source FROM task_import_sheet_parts p LEFT JOIN task_import_sheets s ON s.import_id = p.import_id"
    ).catch(() => []);
    const cardAttachmentsCount = await n('SELECT COUNT(*) n FROM card_attachments').catch(() => 0);
    const serverAssets = (await all<any>('SELECT file as name, kind as type, bytes, created_at as date, "Ổ đĩa máy chủ" as source FROM assets').catch(() => [])) as any[];

    const inDbFilesList = [...avatars, ...reports, ...sheets];
    const totalInDbBytes = inDbFilesList.reduce((acc, f) => acc + f.bytes, 0);
    const serverFiles = (await all<any>('SELECT kind, COUNT(*) files, COALESCE(SUM(bytes), 0) bytes FROM assets GROUP BY kind ORDER BY bytes DESC').catch(() => [])).map((r: any) => ({ kind: r.kind, files: Number(r.files), bytes: Number(r.bytes) }));
    const serverFilesBytes = serverFiles.reduce((acc: number, f: any) => acc + f.bytes, 0);
    const serverFilesCount = serverFiles.reduce((acc: number, f: any) => acc + f.files, 0);

    const allFileList = [...inDbFilesList, ...serverAssets].sort((a, b) => b.bytes - a.bytes);

    const duplicateMap = new Map<string, any[]>();
    for (const f of allFileList) {
      const key = `${f.name}:${f.bytes}`;
      const existing = duplicateMap.get(key) || [];
      existing.push(f);
      duplicateMap.set(key, existing);
    }
    const duplicates: any[] = [];
    for (const [, list] of duplicateMap.entries()) {
      if (list.length > 1) {
        duplicates.push({ name: list[0].name, type: list[0].type, bytes: list[0].bytes, copies: list.length, source: list[0].source });
      }
    }

    const filesBreakdown = {
      totalFiles: inDbFilesList.length + serverFilesCount,
      totalBytes: totalInDbBytes + serverFilesBytes,
      byType: [
        { type: 'sheet_parts', label: 'Bảng tính Excel/CSV thô (Raw chunks)', files: sheets.length, bytes: sheets.reduce((a, b) => a + b.bytes, 0), location: 'Cloudflare D1' },
        { type: 'user_avatars', label: 'Ảnh đại diện người dùng', files: avatars.length, bytes: avatars.reduce((a, b) => a + b.bytes, 0), location: 'Cloudflare D1' },
        { type: 'report_images', label: 'Ảnh trong báo cáo chiến dịch', files: reports.length, bytes: reports.reduce((a, b) => a + b.bytes, 0), location: 'Cloudflare D1' },
        { type: 'card_attachments', label: 'Tệp đính kèm thẻ công việc', files: cardAttachmentsCount, bytes: 0, location: 'Metadata / External Link' },
        ...serverFiles.map((sf: any) => ({ type: `server_${sf.kind}`, label: `Server ${sf.kind}`, files: sf.files, bytes: sf.bytes, location: cloudDatabase ? 'Google Drive' : 'Server Disk' })),
      ],
      duplicates,
    };

    // 4. Sources table
    const WORKERS_ASSETS_BYTES = 909600;
    const WORKERS_ASSETS_FILES = 139;

    const sources = [
      {
        source: 'Cloudflare D1',
        category: 'database',
        items: `${tables.length} bảng (${totalRecords.toLocaleString()} bản ghi)`,
        usedBytes: database,
        status: 'Active',
        isActual: databaseIsActual,
        note: 'Cơ sở dữ liệu chính Cloudflare D1 (dmi-studio-db)',
      },
      {
        source: 'Google Drive',
        category: 'drive',
        items: rootFolderDetails ? `${rootFolderDetails.subfolderCount} thư mục khách hàng (${driveAccounts.length} TK)` : `${driveAccounts.length} tài khoản`,
        usedBytes: totalDriveBytes,
        totalAccountUsage: totalGoogleUsage,
        status: driveAccounts.some((a) => a.status === 'connected') ? 'Connected' : 'Error',
        isActual: true,
        note: `OAuth2 Google Drive v3 · Quota ${totalGoogleLimit ? Math.round(totalGoogleLimit / (1024 ** 4)) + ' TB' : 'Không giới hạn'}`,
      },
      {
        source: 'In-Database BLOBs',
        category: 'in_db_files',
        items: `${inDbFilesList.length} tệp (Avatar, Báo cáo, Sheet)`,
        usedBytes: totalInDbBytes,
        status: 'Active',
        isActual: true,
        note: 'Dữ liệu file lưu trực tiếp dạng Base64/chunk trong D1',
      },
      {
        source: 'Cloudflare Workers Assets',
        category: 'app_assets',
        items: `${WORKERS_ASSETS_FILES} tệp ứng dụng`,
        usedBytes: WORKERS_ASSETS_BYTES,
        status: 'Active',
        isActual: true,
        note: 'Gói frontend tĩnh (HTML, CSS, JS bundles, Font, Logo)',
      },
      {
        source: 'Server Storage (Ổ đĩa máy chủ)',
        category: 'disk',
        items: `${serverFilesCount} tệp`,
        usedBytes: serverFilesBytes,
        status: cloudDatabase ? 'Cloud (Lưu trên Google Drive)' : 'Active',
        isActual: !cloudDatabase,
        note: cloudDatabase ? 'Máy chủ Cloudflare không dùng ổ đĩa cục bộ' : 'Thư mục data/assets trên máy chủ',
      },
      {
        source: 'Cloudflare R2 (Object Storage)',
        category: 'r2',
        items: '—',
        usedBytes: 0,
        status: 'Chưa cấu hình (Not Configured)',
        isActual: false,
        note: 'Chưa kích hoạt R2 bucket binding',
      },
      {
        source: 'Cloudflare KV (Key-Value)',
        category: 'kv',
        items: '—',
        usedBytes: 0,
        status: 'Chưa cấu hình (Not Configured)',
        isActual: false,
        note: 'Chưa kích hoạt Workers KV namespace',
      },
    ];

    // 5. System Health & Cleanable Data
    let integrity = 'OK';
    try {
      const row = await get<any>('PRAGMA integrity_check(1)');
      integrity = row?.integrity_check || (row ? Object.values(row)[0] : 'OK');
    } catch {
      integrity = 'D1 Active';
    }
    const days = 30;
    const cutoff = now() - days * 86400e3;
    const safeN = async (sql: string, ...args: any[]) => { try { return await n(sql, ...args); } catch { return 0; } };
    const expiredSessions = await safeN('SELECT COUNT(*) n FROM sessions WHERE expires_at < ?', now());
    const oldAuditLogs = await safeN('SELECT COUNT(*) n FROM audit_logs WHERE created_at < ?', cutoff);
    const oldLoginLogs = await safeN('SELECT COUNT(*) n FROM login_logs WHERE created_at < ?', cutoff);
    const oldNotifications = await safeN('SELECT COUNT(*) n FROM notifications WHERE (read = 1 AND created_at < ?) OR created_at < ?', cutoff, now() - 60 * 86400e3);
    const orphanedSheetParts = await safeN('SELECT COUNT(*) n FROM task_import_sheet_parts WHERE import_id NOT IN (SELECT id FROM task_imports)');
    const archivedCards = await safeN('SELECT COUNT(*) n FROM board_cards WHERE archived = 1');

    const cleanable = {
      expiredSessions,
      oldAuditLogs,
      oldLoginLogs,
      oldNotifications,
      orphanedSheetParts,
      archivedCards,
      totalGarbage: expiredSessions + oldAuditLogs + oldLoginLogs + oldNotifications + orphanedSheetParts,
    };

    const overview = {
      totalUsedBytes: database + totalDriveBytes + serverFilesBytes + WORKERS_ASSETS_BYTES,
      databaseBytes: database,
      databaseIsActual,
      databaseRecords: totalRecords,
      databaseTableCount: tables.length,
      fileStorageBytes: totalInDbBytes + serverFilesBytes,
      fileCount: inDbFilesList.length + serverFilesCount,
      driveBytes: totalDriveBytes,
      driveTrashBytes: totalDriveTrashBytes,
      driveTotalUsage: totalGoogleUsage,
      driveLimit: totalGoogleLimit,
      driveAccountCount: driveAccounts.length,
      workersAssetsBytes: WORKERS_ASSETS_BYTES,
      workersAssetsFiles: WORKERS_ASSETS_FILES,
      lastUpdated: Date.now(),
    };

    const payload = {
      database,
      cloud: cloudDatabase,
      files: serverFiles,
      inDatabase: [
        { key: 'cards', label: 'Thẻ công việc trên Board', files: await safeCount('SELECT COUNT(*) n FROM board_cards'), bytes: await safeBytes("SELECT COALESCE(SUM(LENGTH(title) + LENGTH(COALESCE(description,'')) + LENGTH(COALESCE(result,'')) + 350), 0) n FROM board_cards") },
        { key: 'tasks', label: 'Công việc Base Wework & Việc con', files: await safeCount('SELECT COUNT(*) n FROM tasks'), bytes: await safeBytes("SELECT COALESCE(SUM(LENGTH(title) + LENGTH(COALESCE(description,'')) + 300), 0) n FROM tasks") },
        { key: 'comments', label: 'Bình luận thẻ & công việc', files: await safeCount('SELECT (SELECT COUNT(*) FROM card_comments) + (SELECT COUNT(*) FROM task_comments) n'), bytes: await safeBytes("SELECT (SELECT COALESCE(SUM(LENGTH(text) + 120), 0) FROM card_comments) + (SELECT COALESCE(SUM(LENGTH(text) + 120), 0) FROM task_comments) n") },
        { key: 'audit_logs', label: 'Nhật ký thao tác (Audit logs)', files: await safeCount('SELECT COUNT(*) n FROM audit_logs'), bytes: await safeBytes("SELECT COALESCE(SUM(LENGTH(COALESCE(old_data, '')) + LENGTH(COALESCE(new_data, '')) + 220), 0) n FROM audit_logs") },
        { key: 'login_logs', label: 'Lịch sử đăng nhập', files: await safeCount('SELECT COUNT(*) n FROM login_logs'), bytes: await safeBytes("SELECT COALESCE(SUM(LENGTH(COALESCE(email, '')) + LENGTH(COALESCE(ip, '')) + 160), 0) n FROM login_logs") },
        { key: 'messages', label: 'Tin nhắn & Tệp Messenger', files: await safeCount('SELECT COUNT(*) n FROM chat_messages'), bytes: await safeBytes("SELECT COALESCE(SUM(LENGTH(COALESCE(message, '')) + 180), 0) n FROM chat_messages") },
        { key: 'task_import_sheet_parts', label: 'Bảng công việc đã nhập', files: await safeCount('SELECT COUNT(DISTINCT import_id) n FROM task_import_sheet_parts'), bytes: await safeBytes('SELECT COALESCE(SUM(LENGTH(data)), 0) n FROM task_import_sheet_parts') },
        { key: 'customers', label: 'Khách hàng & Chiến dịch dịch vụ', files: await safeCount('SELECT (SELECT COUNT(*) FROM customers) + (SELECT COUNT(*) FROM task_projects) n'), bytes: await safeBytes("SELECT (SELECT COALESCE(SUM(LENGTH(name) + LENGTH(COALESCE(notes, '')) + 300), 0) FROM customers) + (SELECT COALESCE(SUM(LENGTH(name) + 200), 0) FROM task_projects) n") },
        { key: 'workspaces', label: 'Không gian làm việc & Board', files: await safeCount('SELECT (SELECT COUNT(*) FROM workspaces) + (SELECT COUNT(*) FROM boards) n'), bytes: await safeBytes("SELECT (SELECT COALESCE(SUM(LENGTH(name) + 200), 0) FROM workspaces) + (SELECT COALESCE(SUM(LENGTH(name) + 200), 0) FROM boards) n") },
        { key: 'users', label: 'Tài khoản nhân viên & Thành viên', files: await safeCount('SELECT COUNT(*) n FROM users'), bytes: await safeBytes("SELECT COALESCE(SUM(LENGTH(name) + LENGTH(email) + 250), 0) n FROM users") },
        { key: 'sessions', label: 'Phiên đăng nhập đang hoạt động', files: await safeCount('SELECT COUNT(*) n FROM sessions'), bytes: await safeBytes("SELECT COALESCE(SUM(LENGTH(token) + 120), 0) n FROM sessions") },
        { key: 'user_avatars', label: 'Ảnh đại diện', files: await safeCount('SELECT COUNT(*) n FROM user_avatars'), bytes: await safeBytes('SELECT COALESCE(SUM(LENGTH(data)), 0) * 3 / 4 n FROM user_avatars') },
        { key: 'report_images', label: 'Ảnh trong báo cáo', files: await safeCount('SELECT COUNT(*) n FROM report_images'), bytes: await safeBytes('SELECT COALESCE(SUM(LENGTH(data)), 0) * 3 / 4 n FROM report_images') },
        { key: 'notifications', label: 'Thông báo hệ thống', files: await safeCount('SELECT COUNT(*) n FROM notifications'), bytes: await safeBytes("SELECT COALESCE(SUM(LENGTH(title) + LENGTH(body) + 150), 0) n FROM notifications") },
        { key: 'quick_notes', label: 'Ghi chú nhanh', files: await safeCount('SELECT COUNT(*) n FROM quick_notes'), bytes: await safeBytes("SELECT COALESCE(SUM(LENGTH(COALESCE(body, '')) + 150), 0) n FROM quick_notes") },
      ],
      renders: await n('SELECT COUNT(*) n FROM renders').catch(() => 0),
      drive: { accounts: driveAccounts.length, root: rootSetting?.label || null },

      // Full Storage Audit
      overview,
      sources,
      tables,
      filesBreakdown,
      driveDetails: {
        connected: driveAccounts.some((a) => a.status === 'connected'),
        accounts: driveAccounts,
        rootFolder: rootFolderDetails,
      },
      health: {
        integrity,
        cloud: cloudDatabase,
        d1Connected: true,
        driveConnected: driveAccounts.some((a) => a.status === 'connected'),
        quotaWarning: null,
      },
      cleanable,
    };

    lastAuditCache = { data: payload, time: Date.now() };
    json(res, 200, payload);
  });

  api.get('/api/admin/storage/check', async (req, res) => {
    await need(req, 'settings.view');
    let integrity = 'OK';
    try {
      const row = await get<any>('PRAGMA integrity_check(1)');
      integrity = row?.integrity_check || (row ? Object.values(row)[0] : 'OK');
    } catch {
      integrity = 'D1 Active';
    }
    const days = 30;
    const cutoff = now() - days * 86400e3;
    const safeN = async (sql: string, ...args: any[]) => { try { return await n(sql, ...args); } catch { return 0; } };
    const expiredSessions = await safeN('SELECT COUNT(*) n FROM sessions WHERE expires_at < ?', now());
    const oldAuditLogs = await safeN('SELECT COUNT(*) n FROM audit_logs WHERE created_at < ?', cutoff);
    const oldLoginLogs = await safeN('SELECT COUNT(*) n FROM login_logs WHERE created_at < ?', cutoff);
    const oldNotifications = await safeN('SELECT COUNT(*) n FROM notifications WHERE (read = 1 AND created_at < ?) OR created_at < ?', cutoff, now() - 60 * 86400e3);
    const orphanedSheetParts = await safeN('SELECT COUNT(*) n FROM task_import_sheet_parts WHERE import_id NOT IN (SELECT id FROM task_imports)');
    const archivedCards = await safeN('SELECT COUNT(*) n FROM board_cards WHERE archived = 1');

    json(res, 200, {
      integrity,
      expiredSessions,
      oldAuditLogs,
      oldLoginLogs,
      oldNotifications,
      orphanedSheetParts,
      archivedCards,
      totalGarbage: expiredSessions + oldAuditLogs + oldLoginLogs + oldNotifications + orphanedSheetParts,
    });
  });

  api.post('/api/admin/storage/clean', async (req, res) => {
    const c = await need(req, 'settings.update');
    const b = await readJson(req);
    const days = Math.max(0, Math.min(3650, Number(b.days ?? 30)));
    const cutoff = now() - days * 86400e3;

    let deletedSessions = 0;
    let deletedLogs = 0;
    let deletedNotifs = 0;
    let deletedSheets = 0;
    let deletedCards = 0;

    if (b.cleanSessions !== false) {
      const r = await run('DELETE FROM sessions WHERE expires_at < ?', now()).catch(() => ({ changes: 0 }));
      deletedSessions = r.changes || 0;
    }
    if (b.cleanLogs) {
      const r1 = await run('DELETE FROM audit_logs WHERE created_at < ?', cutoff).catch(() => ({ changes: 0 }));
      const r2 = await run('DELETE FROM login_logs WHERE created_at < ?', cutoff).catch(() => ({ changes: 0 }));
      deletedLogs = (r1.changes || 0) + (r2.changes || 0);
    }
    if (b.cleanNotifications) {
      const r = await run('DELETE FROM notifications WHERE (read = 1 AND created_at < ?) OR created_at < ?', cutoff, cutoff - 30 * 86400e3).catch(() => ({ changes: 0 }));
      deletedNotifs = r.changes || 0;
    }
    if (b.cleanSheetParts) {
      const r = await run('DELETE FROM task_import_sheet_parts WHERE import_id NOT IN (SELECT id FROM task_imports)').catch(() => ({ changes: 0 }));
      deletedSheets = r.changes || 0;
    }
    if (b.cleanArchivedCards) {
      const r = await run('DELETE FROM board_cards WHERE archived = 1 AND (due_at IS NULL OR due_at < ?)', cutoff).catch(() => ({ changes: 0 }));
      deletedCards = r.changes || 0;
    }

    if (b.optimize) {
      try {
        if (!cloudDatabase) await run('VACUUM');
        else await run('PRAGMA optimize');
      } catch {}
    }

    await logAction(c, 'Dọn dẹp cơ sở dữ liệu', `Xoá ${deletedLogs} nhật ký, ${deletedSessions} phiên, ${deletedNotifs} thông báo`, 'system');
    json(res, 200, {
      ok: true,
      cleaned: {
        logs: deletedLogs,
        sessions: deletedSessions,
        notifications: deletedNotifs,
        sheets: deletedSheets,
        cards: deletedCards,
        total: deletedLogs + deletedSessions + deletedNotifs + deletedSheets + deletedCards,
      },
    });
  });
  api.get('/api/admin/backups', async (req, res) => {
    await need(req, 'settings.view');
    if (!canBackUp) return json(res, 200, { supported: false, items: [], command: 'npm run db:backup' });
    let names: string[] = [];
    try { names = fs.readdirSync(BACKUPS).filter((f) => BACKUP_NAME.test(f)); } catch { /* none yet */ }
    json(res, 200, { supported: true, items: names.map((name) => { const st = fs.statSync(path.join(BACKUPS, name)); return { name, bytes: st.size, at: st.mtimeMs }; }).sort((a, b) => b.at - a.at) });
  });
  // A consistent copy of the whole database (VACUUM INTO), next to it in data/backups.
  api.post('/api/admin/backups', async (req, res) => {
    const c = await need(req, 'settings.update');
    if (!canBackUp) throw new HttpError(400, 'Máy chủ này dùng Cloudflare D1: hãy sao lưu bằng lệnh npm run db:backup');
    fs.mkdirSync(BACKUPS, { recursive: true });
    const d = new Date(now() + 7 * 3600e3).toISOString(), name = `studio-${d.slice(0, 10).replace(/-/g, '')}-${d.slice(11, 19).replace(/:/g, '')}.db`, file = path.join(BACKUPS, name);
    if (fs.existsSync(file)) throw new HttpError(409, 'Vừa có một bản sao lưu, hãy thử lại sau một giây');
    await run('VACUUM INTO ?', file);
    const bytes = fs.statSync(file).size;
    await changed(c, { action: 'Tạo bản sao lưu', type: 'backup', id: name, label: name, after: { bytes } });
    json(res, 201, { name, bytes, at: now() });
  });
  api.get('/api/admin/backups/:name', async (req, res) => {
    const c = await need(req, 'settings.update');
    if (!canBackUp || !BACKUP_NAME.test(req.params.name) || !fs.existsSync(path.join(BACKUPS, req.params.name))) throw new HttpError(404, 'Không tìm thấy bản sao lưu');
    await logAction(c, 'Tải bản sao lưu', req.params.name, 'backup');
    sendFile(req, res, BACKUPS, req.params.name, { download: req.params.name });
  });
}
