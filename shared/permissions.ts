// Admin module permissions (RBAC with data scope). The catalog lives in code, not in a table: a permission is only real
// when a server check enforces it, so each key below is checked by an /api/admin endpoint (server/admin/*) or by the
// guard (server/auth.ts). Roles get permissions at a scope; a person's roles add up to the widest scope of each.

/** How much data a permission reaches: their own, their teams', their department's, or everyone's. */
export type Scope = 'personal' | 'team' | 'department' | 'organization';
export const SCOPES: Scope[] = ['personal', 'team', 'department', 'organization'];
export const SCOPE_LABEL: Record<Scope, string> = { personal: 'Cá nhân', team: 'Nhóm', department: 'Phòng ban', organization: 'Toàn hệ thống' };
export const scopeRank = (s: Scope | null | undefined) => (s ? SCOPES.indexOf(s) + 1 : 0);

export type Action = 'view' | 'create' | 'update' | 'delete' | 'export' | 'manage';
export const ACTIONS: Action[] = ['view', 'create', 'update', 'delete', 'export', 'manage'];
export const ACTION_LABEL: Record<Action, string> = { view: 'Xem', create: 'Thêm', update: 'Sửa', delete: 'Xoá', export: 'Xuất', manage: 'Quản lý' };

/** A module (permission group): its actions, what each allows, and whether a scope narrows the data it reaches. */
export interface PermGroup { key: string; label: string; about: string; scoped: boolean; actions: Partial<Record<Action, string>> }
export const PERM_GROUPS: PermGroup[] = [
  { key: 'stats', label: 'Thống kê', about: 'Bảng số liệu và báo cáo hiệu suất', scoped: true,
    actions: { view: 'Xem số liệu trong phạm vi', export: 'Tải báo cáo CSV' } },
  { key: 'staff', label: 'Nhân viên', about: 'Hồ sơ, tài khoản, lịch sử đăng nhập', scoped: true,
    actions: { view: 'Xem danh sách và hồ sơ', create: 'Thêm nhân viên', update: 'Sửa hồ sơ, phòng ban, chức vụ, nhóm, quản lý trực tiếp, đặt mật khẩu', delete: 'Khoá, mở khoá, đăng xuất mọi thiết bị', export: 'Tải danh sách CSV' } },
  { key: 'org', label: 'Cơ cấu tổ chức', about: 'Phòng ban, chức vụ, nhóm', scoped: false,
    actions: { view: 'Xem', create: 'Thêm phòng ban, chức vụ, nhóm', update: 'Sửa, đổi quyền vào trang của phòng, thành viên nhóm', delete: 'Xoá' } },
  { key: 'rbac', label: 'Phân quyền', about: 'Vai trò, quyền, gán vai trò', scoped: false,
    actions: { view: 'Xem vai trò và ma trận quyền', manage: 'Tạo, sửa, xoá vai trò thấp hơn mình; gán và thu hồi vai trò' } },
  { key: 'tasks', label: 'Công việc', about: 'Danh sách toàn bộ công việc, trạng thái, danh mục, ưu tiên, mẫu', scoped: true,
    actions: { view: 'Xem công việc trong phạm vi (không gồm mô tả và kết quả)', update: 'Đặt mức ưu tiên', manage: 'Cấu hình trạng thái, danh mục, ưu tiên, quy trình, mẫu', export: 'Tải danh sách CSV' } },
  { key: 'customers', label: 'Khách hàng', about: 'Hồ sơ khách hàng, phân loại, nguồn, trạng thái', scoped: true,
    actions: { view: 'Xem khách hàng trong phạm vi', create: 'Thêm khách hàng', update: 'Sửa, phân loại, gán phụ trách', delete: 'Lưu trữ và khôi phục', manage: 'Cấu hình phân loại và nguồn', export: 'Tải danh sách CSV' } },
  { key: 'services', label: 'Dịch vụ', about: 'Dịch vụ, danh mục, gói', scoped: false,
    actions: { view: 'Xem', create: 'Thêm', update: 'Sửa', delete: 'Xoá' } },
  { key: 'notifications', label: 'Thông báo', about: 'Gửi thông báo, mẫu, lịch sử gửi', scoped: true,
    actions: { view: 'Xem thông báo đã gửi và lịch sử email', create: 'Gửi thông báo tới người trong phạm vi', manage: 'Quản lý mẫu thông báo' } },
  { key: 'logs', label: 'Nhật ký hệ thống', about: 'Đăng nhập, thao tác, thay đổi dữ liệu, phân quyền, lỗi', scoped: true,
    actions: { view: 'Xem nhật ký của người trong phạm vi', export: 'Tải nhật ký CSV' } },
  { key: 'settings', label: 'Cấu hình hệ thống', about: 'Thông tin hệ thống, cấu hình chung, dung lượng, sao lưu', scoped: false,
    actions: { view: 'Xem', update: 'Đổi cấu hình, tạo bản sao lưu' } },
];
export type Perm = string; // `${group}.${action}`
export const ALL_PERMS: Perm[] = PERM_GROUPS.flatMap((g) => (Object.keys(g.actions) as Action[]).map((a) => `${g.key}.${a}`));
export const isPerm = (p: string) => ALL_PERMS.includes(p);
/** Permissions of unscoped modules always reach the whole organization. */
export const scopedPerm = (p: Perm) => !!PERM_GROUPS.find((g) => g.key === p.split('.')[0])?.scoped;

/** The built-in roles. `rank` orders them: people manage only roles and accounts ranked below their own highest. */
export interface DefaultRole { key: string; name: string; about: string; rank: number; perms: Record<Perm, Scope> }
const every = (scope: Scope, ...perms: Perm[]) => Object.fromEntries(perms.map((p) => [p, scope]));
export const SUPER_ADMIN = 'super_admin', MEMBER = 'member';
export const DEFAULT_ROLES: DefaultRole[] = [
  { key: SUPER_ADMIN, name: 'Super Admin', rank: 100, about: 'Quản trị cao nhất: mọi quyền, quản lý các tài khoản Admin. Cũng là “Quản trị” của các trang khác.',
    perms: every('organization', ...ALL_PERMS) },
  { key: 'admin', name: 'Admin', rank: 80, about: 'Quản trị vận hành: nhân sự, công việc, khách hàng, dịch vụ, thông báo, nhật ký. Không đổi phân quyền, không đổi cấu hình hệ thống.',
    perms: every('organization', 'stats.view', 'stats.export', 'staff.view', 'staff.create', 'staff.update', 'staff.export', 'org.view', 'org.create', 'org.update',
      'rbac.view', 'tasks.view', 'tasks.update', 'tasks.manage', 'tasks.export', 'customers.view', 'customers.create', 'customers.update', 'customers.delete', 'customers.manage', 'customers.export',
      'services.view', 'services.create', 'services.update', 'services.delete', 'notifications.view', 'notifications.create', 'notifications.manage', 'logs.view', 'settings.view') },
  { key: 'manager', name: 'Manager', rank: 60, about: 'Trưởng phòng: xem nhân sự, công việc, khách hàng và số liệu của phòng mình; gửi thông báo cho phòng.',
    perms: { ...every('department', 'stats.view', 'stats.export', 'staff.view', 'tasks.view', 'tasks.update', 'customers.view', 'customers.update', 'notifications.view', 'notifications.create', 'logs.view'), ...every('organization', 'org.view', 'services.view') } },
  { key: 'leader', name: 'Leader', rank: 40, about: 'Trưởng nhóm: xem nhân sự, công việc, khách hàng và số liệu của nhóm mình; gửi thông báo cho nhóm.',
    perms: { ...every('team', 'stats.view', 'staff.view', 'tasks.view', 'customers.view', 'notifications.view', 'notifications.create'), ...every('organization', 'org.view', 'services.view') } },
  { key: MEMBER, name: 'Member', rank: 20, about: 'Mọi nhân viên đều có vai trò này. Mặc định không có quyền quản trị.', perms: {} },
];
/** People holding a role ranked this high or more are listed as Admin accounts. */
export const ADMIN_RANK = 80;
