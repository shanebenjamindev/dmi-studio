// Cấu hình hệ thống: what the server is and holds, the settings the backend has (how long logs are kept, the address
// emails link to), how much is stored where, and backups. A backup is made by the server only where it has a disk (the
// Mac or a Node server: a copy of the SQLite database); on Cloudflare D1 the page shows the command that exports it.
// Restoring is not offered here: it replaces everyone's data and is done by hand (DEPLOY.md).
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, now, getSetting, setSetting, cloudDatabase } from '../db';
import { HttpError, json, readJson, sendFile, type Router } from '../http';
import { DATA_DIR, IS_CLOUDFLARE, CLOUD_STORAGE_ONLY, FFMPEG, CLAUDE_CLI, MOCK } from '../config';
import { RETENTION_DEFAULT, RETENTION_MIN } from '../audit';
import * as G from '../google';
import { need, changed, logAction } from './common';

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
        storage: CLOUD_STORAGE_ONLY ? 'Google Drive' : 'Ổ đĩa máy chủ và Google Drive', editor: !CLOUD_STORAGE_ONLY && !!FFMPEG && !!CLAUDE_CLI, ffmpeg: !!FFMPEG, demo: MOCK, serverTime: now() },
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
  api.get('/api/admin/storage', async (req, res) => {
    await need(req, 'settings.view');
    const size = (f: string) => { try { return fs.statSync(f).size; } catch { return 0; } };
    let database: number | null = null;
    if (!cloudDatabase) {
      database = size(path.join(DATA_DIR, 'studio.db')) + size(path.join(DATA_DIR, 'studio.db-wal'));
    } else {
      try {
        const pcRow = await get<any>('PRAGMA page_count');
        const psRow = await get<any>('PRAGMA page_size');
        const pc = Number(pcRow?.page_count ?? (pcRow ? Object.values(pcRow)[0] : null));
        const ps = Number(psRow?.page_size ?? (psRow ? Object.values(psRow)[0] : null));
        if (Number.isFinite(pc) && pc > 0 && Number.isFinite(ps) && ps > 0) {
          database = pc * ps;
        }
      } catch {
        database = null;
      }
    }
    const bytes = async (sql: string) => { try { return await n(sql); } catch { return 0; } };
    const inDatabase = [
      { key: 'cards', label: 'Thẻ công việc trên Board', files: await n('SELECT COUNT(*) n FROM board_cards'), bytes: await bytes("SELECT COALESCE(SUM(LENGTH(title) + LENGTH(COALESCE(description,'')) + LENGTH(COALESCE(result,'')) + 350), 0) n FROM board_cards") },
      { key: 'tasks', label: 'Công việc Base Wework & Việc con', files: await n('SELECT COUNT(*) n FROM tasks'), bytes: await bytes("SELECT COALESCE(SUM(LENGTH(title) + LENGTH(COALESCE(description,'')) + 300), 0) n FROM tasks") },
      { key: 'comments', label: 'Bình luận thẻ & công việc', files: await n('SELECT (SELECT COUNT(*) FROM card_comments) + (SELECT COUNT(*) FROM task_comments) n'), bytes: await bytes("SELECT (SELECT COALESCE(SUM(LENGTH(text) + 120), 0) FROM card_comments) + (SELECT COALESCE(SUM(LENGTH(text) + 120), 0) FROM task_comments) n") },
      { key: 'audit_logs', label: 'Nhật ký thao tác (Audit logs)', files: await n('SELECT COUNT(*) n FROM audit_logs'), bytes: await bytes("SELECT COALESCE(SUM(LENGTH(COALESCE(old_data, '')) + LENGTH(COALESCE(new_data, '')) + 220), 0) n FROM audit_logs") },
      { key: 'login_logs', label: 'Lịch sử đăng nhập', files: await n('SELECT COUNT(*) n FROM login_logs'), bytes: await bytes("SELECT COALESCE(SUM(LENGTH(COALESCE(email, '')) + LENGTH(COALESCE(ip, '')) + 160), 0) n FROM login_logs") },
      { key: 'messages', label: 'Tin nhắn & Tệp Messenger', files: await n('SELECT COUNT(*) n FROM messages'), bytes: await bytes("SELECT COALESCE(SUM(LENGTH(COALESCE(text, '')) + 180), 0) n FROM messages") },
      { key: 'task_import_sheet_parts', label: 'Bảng công việc đã nhập', files: await n('SELECT COUNT(DISTINCT import_id) n FROM task_import_sheet_parts'), bytes: await bytes('SELECT COALESCE(SUM(LENGTH(data)), 0) n FROM task_import_sheet_parts') },
      { key: 'customers', label: 'Khách hàng & Chiến dịch dự án', files: await n('SELECT (SELECT COUNT(*) FROM customers) + (SELECT COUNT(*) FROM task_projects) n'), bytes: await bytes("SELECT (SELECT COALESCE(SUM(LENGTH(name) + LENGTH(COALESCE(notes, '')) + 300), 0) FROM customers) + (SELECT COALESCE(SUM(LENGTH(name) + 200), 0) FROM task_projects) n") },
      { key: 'workspaces', label: 'Không gian làm việc & Board', files: await n('SELECT (SELECT COUNT(*) FROM workspaces) + (SELECT COUNT(*) FROM boards) n'), bytes: await bytes("SELECT (SELECT COALESCE(SUM(LENGTH(name) + 200), 0) FROM workspaces) + (SELECT COALESCE(SUM(LENGTH(name) + 200), 0) FROM boards) n") },
      { key: 'users', label: 'Tài khoản nhân viên & Thành viên', files: await n('SELECT COUNT(*) n FROM users'), bytes: await bytes("SELECT COALESCE(SUM(LENGTH(name) + LENGTH(email) + 250), 0) n FROM users") },
      { key: 'sessions', label: 'Phiên đăng nhập đang hoạt động', files: await n('SELECT COUNT(*) n FROM sessions'), bytes: await bytes("SELECT COALESCE(SUM(LENGTH(token) + 120), 0) n FROM sessions") },
      { key: 'user_avatars', label: 'Ảnh đại diện', files: await n('SELECT COUNT(*) n FROM user_avatars'), bytes: await bytes('SELECT COALESCE(SUM(LENGTH(data)), 0) * 3 / 4 n FROM user_avatars') },
      { key: 'report_images', label: 'Ảnh trong báo cáo', files: await n('SELECT COUNT(*) n FROM report_images'), bytes: await bytes('SELECT COALESCE(SUM(LENGTH(data)), 0) * 3 / 4 n FROM report_images') },
      { key: 'notifications', label: 'Thông báo hệ thống', files: await n('SELECT COUNT(*) n FROM notifications'), bytes: await bytes("SELECT COALESCE(SUM(LENGTH(title) + LENGTH(body) + 150), 0) n FROM notifications") },
      { key: 'quick_notes', label: 'Ghi chú nhanh', files: await n('SELECT COUNT(*) n FROM quick_notes'), bytes: await bytes("SELECT COALESCE(SUM(LENGTH(COALESCE(body, '')) + 150), 0) n FROM quick_notes") },
    ];
    const totalDataBytes = inDatabase.reduce((a, b) => a + b.bytes, 0);
    if (!database || database <= 0) {
      database = Math.max(1024 * 1024, Math.round(totalDataBytes * 1.45));
    }

    json(res, 200, {
      database, cloud: cloudDatabase,
      files: (await all<any>('SELECT kind, COUNT(*) files, COALESCE(SUM(bytes), 0) bytes FROM assets GROUP BY kind ORDER BY bytes DESC')).map((r) => ({ kind: r.kind, files: Number(r.files), bytes: Number(r.bytes) })),
      inDatabase,
      renders: await n('SELECT COUNT(*) n FROM renders'), drive: { accounts: (await G.accounts()).length, root: (await getSetting<{ label?: string } | null>('workspace_root', null))?.label || null },
    });
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
    const expiredSessions = await n('SELECT COUNT(*) n FROM sessions WHERE expires_at < ?', now());
    const oldAuditLogs = await n('SELECT COUNT(*) n FROM audit_logs WHERE created_at < ?', cutoff);
    const oldLoginLogs = await n('SELECT COUNT(*) n FROM login_logs WHERE created_at < ?', cutoff);
    const oldNotifications = await n('SELECT COUNT(*) n FROM notifications WHERE (read = 1 AND created_at < ?) OR created_at < ?', cutoff, now() - 60 * 86400e3);
    const orphanedSheetParts = await n('SELECT COUNT(*) n FROM task_import_sheet_parts WHERE import_id NOT IN (SELECT id FROM task_imports)');
    const archivedCards = await n('SELECT COUNT(*) n FROM board_cards WHERE archived = 1');

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
      const r = await run('DELETE FROM sessions WHERE expires_at < ?', now());
      deletedSessions = r.changes || 0;
    }
    if (b.cleanLogs) {
      const r1 = await run('DELETE FROM audit_logs WHERE created_at < ?', cutoff);
      const r2 = await run('DELETE FROM login_logs WHERE created_at < ?', cutoff);
      deletedLogs = (r1.changes || 0) + (r2.changes || 0);
    }
    if (b.cleanNotifications) {
      const r = await run('DELETE FROM notifications WHERE (read = 1 AND created_at < ?) OR created_at < ?', cutoff, cutoff - 30 * 86400e3);
      deletedNotifs = r.changes || 0;
    }
    if (b.cleanSheetParts) {
      const r = await run('DELETE FROM task_import_sheet_parts WHERE import_id NOT IN (SELECT id FROM task_imports)');
      deletedSheets = r.changes || 0;
    }
    if (b.cleanArchivedCards) {
      const r = await run('DELETE FROM board_cards WHERE archived = 1 AND (due_at IS NULL OR due_at < ?)', cutoff);
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
