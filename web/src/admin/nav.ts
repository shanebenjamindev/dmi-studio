// Quản trị's sections and pages, with the permission each needs (the server checks it again on every call). The address
// is #admin/<section>/<page>[?…]; going to a page keeps it there, so a reload or a link comes back to it.
export interface NavPage { key: string; label: string; perm: string }
export interface NavGroup { key: string; label: string; icon: string; pages: NavPage[] }

const p = (key: string, label: string, perm: string): NavPage => ({ key, label, perm });
export const NAV: NavGroup[] = [
  { key: 'stats', label: 'Thống kê', icon: 'activity', pages: [p('overview', 'Thống kê tổng quan', 'stats.view'), p('activity', 'Thống kê hoạt động', 'stats.view'), p('customers', 'Thống kê khách hàng', 'stats.view'), p('tasks', 'Thống kê công việc', 'stats.view'), p('staff', 'Thống kê nhân sự', 'stats.view'), p('performance', 'Báo cáo hiệu suất', 'stats.view')] },
  { key: 'staff', label: 'Nhân viên', icon: 'users', pages: [p('list', 'Danh sách nhân viên', 'staff.view'), p('admins', 'Tài khoản Admin', 'rbac.view'), p('activity', 'Lịch sử hoạt động', 'logs.view'), p('departments', 'Phòng ban', 'org.view'), p('positions', 'Chức vụ', 'org.view'), p('teams', 'Nhóm / Team', 'org.view')] },
  { key: 'rbac', label: 'Phân quyền', icon: 'key', pages: [p('roles', 'Vai trò', 'rbac.view'), p('groups', 'Nhóm quyền', 'rbac.view'), p('permissions', 'Quyền chi tiết', 'rbac.view'), p('assign', 'Gán quyền nhân viên', 'rbac.view')] },
  { key: 'tasks', label: 'Công việc', icon: 'checklist', pages: [p('list', 'Tất cả công việc', 'tasks.view'), p('statuses', 'Trạng thái', 'tasks.view'), p('categories', 'Danh mục', 'tasks.view'), p('priorities', 'Mức độ ưu tiên', 'tasks.view'), p('workflow', 'Quy trình', 'tasks.view'), p('templates', 'Mẫu công việc', 'tasks.view'), p('overdue', 'Công việc quá hạn', 'tasks.view')] },
  { key: 'customers', label: 'Khách hàng', icon: 'card', pages: [p('list', 'Danh sách khách hàng', 'customers.view'), p('statuses', 'Trạng thái khách hàng', 'customers.view'), p('categories', 'Phân loại khách hàng', 'customers.view'), p('sources', 'Nguồn khách hàng', 'customers.view')] },
  { key: 'services', label: 'Dịch vụ', icon: 'tag', pages: [p('list', 'Danh sách dịch vụ', 'services.view'), p('categories', 'Danh mục dịch vụ', 'services.view'), p('packages', 'Gói dịch vụ', 'services.view')] },
  { key: 'notify', label: 'Thông báo', icon: 'bell', pages: [p('list', 'Thông báo đã gửi', 'notifications.view'), p('create', 'Tạo thông báo', 'notifications.create'), p('templates', 'Mẫu thông báo', 'notifications.view'), p('history', 'Lịch sử gửi email', 'notifications.view')] },
  { key: 'logs', label: 'Nhật ký hệ thống', icon: 'lines', pages: [p('logins', 'Lịch sử đăng nhập', 'logs.view'), p('actions', 'Lịch sử thao tác', 'logs.view'), p('data', 'Thay đổi dữ liệu', 'logs.view'), p('permissions', 'Lịch sử phân quyền', 'logs.view'), p('errors', 'Nhật ký lỗi', 'logs.view')] },
  { key: 'system', label: 'Cấu hình hệ thống', icon: 'gear', pages: [p('info', 'Thông tin hệ thống', 'settings.view'), p('general', 'Cấu hình chung', 'settings.view'), p('statuses', 'Cấu hình trạng thái', 'tasks.view'), p('notifications', 'Cấu hình thông báo', 'settings.view'), p('storage', 'Tệp và dung lượng', 'settings.view'), p('backup', 'Sao lưu và phục hồi', 'settings.view')] },
  { key: 'support', label: 'Hỗ trợ lập trình viên', icon: 'chat', pages: [p('list', 'Yêu cầu hỗ trợ', 'settings.view')] },
];

export interface Route { group: string; page: string; params: URLSearchParams }
export function parseRoute(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const [, group = '', page = ''] = path.split('/');
  return { group, page, params: new URLSearchParams(query) };
}
/** Opens a page of Quản trị (with optional parameters, e.g. the record to show). */
export function goAdmin(group: string, page: string, params: Record<string, string> = {}) {
  const q = new URLSearchParams(params).toString();
  history.replaceState(null, '', `#admin/${group}/${page}${q ? '?' + q : ''}`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
/** A parameter of the address, and setting it without leaving the page. */
export const routeParam = (k: string) => parseRoute(location.hash).params.get(k);
export function setRouteParam(k: string, v: string | null) {
  const r = parseRoute(location.hash);
  if (v) r.params.set(k, v); else r.params.delete(k);
  const q = r.params.toString();
  history.replaceState(null, '', `#admin/${r.group}/${r.page}${q ? '?' + q : ''}`);
}
