// Typed client for Quản trị (/api/admin/*, server/admin/*).
import { req } from '../api';
import { beginLoading } from '../loading';
import type { Scope } from '../../../shared/permissions';

export type Paged<T> = { items: T[]; total: number; page: number; size: number; sort?: string; dir?: 'asc' | 'desc' };
export type Ref = { id: string; name: string };
export type Work = { total: number; open: number; overdue: number; done: number; late: number };
export interface Staff {
  id: string; name: string; email: string; phone: string; avatarAt: number | null; superAdmin: boolean; disabled: boolean; lastLogin: number | null; createdAt: number; updatedAt: number; sessions: number;
  department: { id: string; name: string; color: string } | null; position: { id: string; name: string; level: string } | null; manager: Ref | null;
  teams: { id: string; name: string; color: string; leader: boolean }[]; roles: { id: string; key: string | null; name: string; rank: number; scope: Scope | null; grantedAt?: number | null; grantedBy?: string | null }[];
  rank: number; work: Work; canEdit?: boolean; canManage?: boolean; canLock?: boolean; canAssign?: boolean;
}
export type Change = { action: string; by: string | null; before: Record<string, any> | null; after: Record<string, any> | null; at: number };
export interface StaffDetail extends Staff {
  notifyEmail: string | null; logins: { ok: boolean; method: string; reason: string | null; ip: string | null; agent: string | null; at: number }[];
  activeSessions: { at: number; expiresAt: number; ip: string | null; agent: string | null }[]; actions: { action: string; label: string | null; status: number | null; at: number }[] | null;
  roleHistory: Change[]; changes: Change[]; tasks: { id: string; title: string; status: string; state: string; dueAt: number | null; doneAt: number | null; project: string | null }[] | null;
}
export interface Department { id: string; name: string; color: string; pages: string[]; members: number; active: number; heads: Ref[]; teams: number; boards: number; createdAt: number }
export interface Team { id: string; name: string; about: string; color: string; departmentId: string | null; members: { id: string; name: string; email: string; disabled: boolean; leader: boolean }[]; createdAt: number; updatedAt: number }
export interface Role { id: string; key: string | null; name: string; about: string; rank: number; system: boolean; perms: Record<string, Scope> | 'all'; holders: number; canEdit: boolean; canAssign: boolean; canDelete: boolean; createdAt: number; updatedAt: number }
export interface PermGroupOut { key: string; label: string; about: string; scoped: boolean; actions: Record<string, string>; perms: { key: string; action: string; about: string; roles: string[] }[] }
export interface LogEntry { id: string; kind?: string; action?: string; userId: string | null; userName: string | null; entityType?: string | null; entityId?: string | null; entityLabel?: string | null; method?: string | null; path?: string | null; status?: number | null; before?: any; after?: any; ip: string | null; agent: string | null; at: number; email?: string; ok?: boolean; reason?: string | null }
export interface TaskRow {
  id: string; title: string; status: string; state: string; category: string; startAt: number | null; dueAt: number | null; doneAt: number | null; createdAt: number; updatedAt: number; externalId: string | null;
  project: Ref | null; customer: Ref | null; campaign: Ref | null; parent: { id: string; title: string } | null; children: number; priority: { id: string; name: string; color: string } | null;
  creator: { name: string; userId: string | null } | null; assignees: { id: string; name: string; userId: string | null; departmentId: string | null }[]; labels: string[];
}
export interface TaskDetail extends TaskRow { canSetPriority: boolean; subtasks: { id: string; title: string; status: string; state: string; category: string; dueAt: number | null }[]; history: Change[] }
export interface DictItem { id: string; name: string; color: string; pos: number; active: boolean; used: number }
export interface SupportTicket {
  id: string;
  userId: string;
  userName: string;
  userEmail: string | null;
  message: string;
  status: 'pending' | 'resolved';
  createdAt: number;
  /** How many screenshots came with it. */
  images: number;
}
export interface TaskStatus extends DictItem { category: string; locked: boolean }
export interface TaskTemplate { id: string; name: string; about: string; title: string; checklist: string[]; status: string | null; priorityId: string | null; labels: string[]; dueDays: number | null; createdBy: string | null; updatedBy: string | null; createdAt: number; updatedAt: number }
export interface CustomerRow {
  id: string; name: string; contact: string; phone: string; email: string; status: string | null; category: { id: string; name: string; color: string } | null; tags?: { id: string; name: string; color: string }[]; source: { id: string; name: string; color: string } | null;
  owner: Ref | null; manager: Ref | null; createdAt: number; updatedAt: number; archivedAt: number | null; hasDrive: boolean; needs: Ref[]; projects: number; tasks: number; canEdit?: boolean; canArchive?: boolean;
}
export interface CustomerDetail extends CustomerRow { notes: string; members: { id: string; name: string; level: string }[]; history: Change[] }
export interface Service { id: string; name: string; code: string; about: string; image: string | null; price: number | null; currency: string; unit: string; status: string; category: { id: string; name: string; color: string } | null; packages: number; createdBy: string | null; updatedBy: string | null; createdAt: number; updatedAt: number }
export interface Package { id: string; name: string; about: string; price: number | null; currency: string; term: string; status: string; items: { serviceId: string; name: string; qty: number; price: number | null; currency: string; removed: boolean }[]; createdBy: string | null; updatedBy: string | null; createdAt: number; updatedAt: number }
export interface Sent { id: string; title: string; body: string; link: string | null; audience: string; recipients: number; emailed: number; read: number; sentBy: string | null; at: number }
export interface NotifTemplate { id: string; name: string; title: string; body: string; link: string; createdBy: string | null; updatedBy: string | null; createdAt: number; updatedAt: number }

const q = (params: Record<string, string | number | boolean | null | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) s.set(k, String(v));
  const str = s.toString();
  return str ? '?' + str : '';
};
export type Query = Record<string, string | number | boolean | null | undefined>;

/** Downloads a CSV the server makes (the export permission is checked there). */
export async function download(url: string, name: string) {
  const done = beginLoading();
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Lỗi ${res.status}`);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob()); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } finally { done(); }
}

const dict = (path: string) => ({
  list: () => req<DictItem[]>('GET', `/api/admin/${path}`),
  create: (b: { name: string; color: string }) => req<DictItem>('POST', `/api/admin/${path}`, b),
  update: (id: string, b: Partial<{ name: string; color: string; active: boolean }>) => req<DictItem>('PUT', `/api/admin/${path}/${id}`, b),
  remove: (id: string) => req('DELETE', `/api/admin/${path}/${id}`),
  order: (ids: string[]) => req('POST', `/api/admin/${path}/order`, { ids }),
});
export type DictApi = ReturnType<typeof dict>;

export const admin = {
  q,
  staff: (p: Query) => req<Paged<Staff>>('GET', `/api/admin/staff${q(p)}`),
  staffOne: (id: string) => req<StaffDetail>('GET', `/api/admin/staff/${id}`),
  createStaff: (b: any) => req<Staff>('POST', '/api/admin/staff', b),
  updateStaff: (id: string, b: any) => req<Staff>('PUT', `/api/admin/staff/${id}`, b),
  lockStaff: (id: string, locked: boolean) => req('POST', `/api/admin/staff/${id}/lock`, { locked }),
  signOutStaff: (id: string) => req<{ ended: number }>('POST', `/api/admin/staff/${id}/signout`),
  setAvatar: (id: string, dataUrl: string) => req<{ avatarAt: number }>('PUT', `/api/admin/staff/${id}/avatar`, { dataUrl }),
  removeAvatar: (id: string) => req('DELETE', `/api/admin/staff/${id}/avatar`),
  setRoles: (id: string, roles: { roleId: string; scope: Scope | null }[]) => req<Staff>('PUT', `/api/admin/staff/${id}/roles`, { roles }),
  departments: () => req<Department[]>('GET', '/api/admin/departments'),
  teams: () => req<Team[]>('GET', '/api/admin/teams'),
  createTeam: (b: any) => req<Team>('POST', '/api/admin/teams', b),
  updateTeam: (id: string, b: any) => req<Team>('PUT', `/api/admin/teams/${id}`, b),
  removeTeam: (id: string) => req('DELETE', `/api/admin/teams/${id}`),
  setTeamMembers: (id: string, userIds: string[], leaderIds: string[]) => req<Team>('PUT', `/api/admin/teams/${id}/members`, { userIds, leaderIds }),
  roles: () => req<Role[]>('GET', '/api/admin/roles'),
  createRole: (b: any) => req<Role>('POST', '/api/admin/roles', b),
  updateRole: (id: string, b: any) => req<Role>('PUT', `/api/admin/roles/${id}`, b),
  removeRole: (id: string) => req<{ removedFrom: number }>('DELETE', `/api/admin/roles/${id}`),
  permissions: () => req<PermGroupOut[]>('GET', '/api/admin/permissions'),
  assignments: (p: Query) => req<Paged<Staff>>('GET', `/api/admin/assignments${q(p)}`),
  admins: () => req<Staff[]>('GET', '/api/admin/admins'),
  logs: (p: Query) => req<Paged<LogEntry> & { since: number | null }>('GET', `/api/admin/logs${q(p)}`),
  tasks: (p: Query) => req<Paged<TaskRow> & { counts: { total: number; open: number; overdue: number; done: number } }>('GET', `/api/admin/tasks${q(p)}`),
  task: (id: string) => req<TaskDetail>('GET', `/api/admin/tasks/${id}`),
  setPriority: (id: string, priorityId: string | null) => req('PUT', `/api/admin/tasks/${id}/priority`, { priorityId }),
  statuses: () => req<{ statuses: TaskStatus[]; unlisted: { name: string; used: number; category: string }[] }>('GET', '/api/admin/task-statuses'),
  createStatus: (b: { name: string; color: string }) => req<TaskStatus>('POST', '/api/admin/task-statuses', b),
  updateStatus: (id: string, b: Partial<{ name: string; color: string; active: boolean }>) => req<TaskStatus>('PUT', `/api/admin/task-statuses/${id}`, b),
  removeStatus: (id: string) => req('DELETE', `/api/admin/task-statuses/${id}`),
  clearUnlistedStatus: (name: string) => req('POST', '/api/admin/task-statuses/clear-unlisted', { name }),
  orderStatuses: (ids: string[]) => req('POST', '/api/admin/task-statuses/order', { ids }),
  labels: () => req<{ id: string; name: string; color: string; used: number }[]>('GET', '/api/admin/task-labels'),
  createLabel: (b: { name: string; color: string }) => req('POST', '/api/admin/task-labels', b),
  updateLabel: (id: string, b: Partial<{ name: string; color: string }>) => req('PUT', `/api/admin/task-labels/${id}`, b),
  removeLabel: (id: string) => req('DELETE', `/api/admin/task-labels/${id}`),
  priorities: dict('task-priorities'),
  templates: () => req<TaskTemplate[]>('GET', '/api/admin/task-templates'),
  saveTemplate: (id: string | null, b: any) => req<TaskTemplate>(id ? 'PUT' : 'POST', id ? `/api/admin/task-templates/${id}` : '/api/admin/task-templates', b),
  removeTemplate: (id: string) => req('DELETE', `/api/admin/task-templates/${id}`),
  customers: (p: Query) => req<Paged<CustomerRow>>('GET', `/api/admin/customers${q(p)}`),
  customer: (id: string) => req<CustomerDetail>('GET', `/api/admin/customers/${id}`),
  saveCustomer: (id: string | null, b: any) => req<CustomerRow>(id ? 'PUT' : 'POST', id ? `/api/admin/customers/${id}` : '/api/admin/customers', b),
  removeCustomer: (id: string) => req('DELETE', `/api/admin/customers/${id}`),
  bulkRemoveCustomers: (ids: string[]) => req<{ deleted: number }>('POST', '/api/admin/customers/bulk-delete', { ids }),
  archiveCustomer: (id: string, archived: boolean) => req('POST', `/api/admin/customers/${id}/archive`, { archived }),
  customerStatuses: dict('customer-statuses'),
  customerCategories: dict('customer-categories'),
  customerSources: dict('customer-sources'),
  services: (p: Query) => req<Paged<Service>>('GET', `/api/admin/services${q(p)}`),
  saveService: (id: string | null, b: any) => req<Service>(id ? 'PUT' : 'POST', id ? `/api/admin/services/${id}` : '/api/admin/services', b),
  removeService: (id: string) => req<{ inPackages: number }>('DELETE', `/api/admin/services/${id}`),
  packages: () => req<Package[]>('GET', '/api/admin/service-packages'),
  savePackage: (id: string | null, b: any) => req<Package>(id ? 'PUT' : 'POST', id ? `/api/admin/service-packages/${id}` : '/api/admin/service-packages', b),
  removePackage: (id: string) => req('DELETE', `/api/admin/service-packages/${id}`),
  serviceCategories: dict('service-categories'),
  sent: (p: Query) => req<Paged<Sent>>('GET', `/api/admin/notifications${q(p)}`),
  sentOne: (id: string) => req<Sent & { people: { id: string; name: string; email: string; readAt: number | null }[] }>('GET', `/api/admin/notifications/${id}`),
  send: (b: { title: string; body: string; link: string; audience: { type: string; ids: string[] }; templateId?: string }) => req<{ id: string; recipients: number; emailed: number }>('POST', '/api/admin/notifications', b),
  mailLog: (p: Query) => req<Paged<{ id: string; to: string | null; title: string; state: string; attempts: number; at: number; sentAt: number | null; error: string | null; test: boolean }> & { counts: Record<string, number>; sender: boolean }>('GET', `/api/admin/mail-log${q(p)}`),
  notifTemplates: () => req<NotifTemplate[]>('GET', '/api/admin/notification-templates'),
  saveNotifTemplate: (id: string | null, b: any) => req<NotifTemplate>(id ? 'PUT' : 'POST', id ? `/api/admin/notification-templates/${id}` : '/api/admin/notification-templates', b),
  removeNotifTemplate: (id: string) => req('DELETE', `/api/admin/notification-templates/${id}`),
  stats: (p: Query) => req<any>('GET', `/api/admin/stats${q(p)}`),
  system: () => req<any>('GET', '/api/admin/system'),
  settings: () => req<{ logRetentionDays: number; siteUrl: string; retentionMin: number; taskWorkspaceAuto: boolean }>('GET', '/api/admin/settings'),
  saveSettings: (b: Partial<{ logRetentionDays: number; siteUrl: string; taskWorkspaceAuto: boolean }>) => req<{ logRetentionDays: number; siteUrl: string; taskWorkspaceAuto: boolean }>('PUT', '/api/admin/settings', b),
  storage: () => req<any>('GET', '/api/admin/storage'),
  backups: () => req<{ supported: boolean; items: { name: string; bytes: number; at: number }[]; command?: string }>('GET', '/api/admin/backups'),
  backup: () => req<{ name: string; bytes: number }>('POST', '/api/admin/backups'),
  supportTickets: (p: Query) => req<Paged<SupportTicket>>('GET', `/api/admin/support${q(p)}`),
  updateSupportTicket: (id: string, b: { status: string }) => req<{ ok: true }>('PUT', `/api/admin/support/${id}`, b),
  supportTicketImages: (id: string) => req<string[]>('GET', `/api/admin/support/${id}/images`),
  removeSupportTicket: (id: string) => req<{ ok: true }>('DELETE', `/api/admin/support/${id}`),
};
