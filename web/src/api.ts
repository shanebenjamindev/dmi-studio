import {beginLoading} from './loading';
import type { AdsService, AdsSummary } from '../../shared/ads-summary';
// Typed client for the DMI Workspace REST API.
import type { QuickNote, CustomerTaskRow, RecordChange, ReportDriveFolder, ServiceRef, NotificationInbox, CustomerMembersData, NotificationStatus, UserProfile, ReportVideo, TaskCampaign, CustomerRecord, TaskImportSheet, TaskWrite, TeamRole, DeptRole, Workspace, WorkspaceMember, Person, Level, BoardMember, Board, BoardItem, BoardList, BoardCard, BoardLabel, BoardActivity, CardDetail, CustomerTask, InboxItem, ChatMessage, ChatMember, PlannerCard, TaskItem, TaskDetail, TaskMeta, TaskImportResult, AdAccount, AdsReport, AdsSettings, Report, ReportData, ReportItem, Outro, OutroOpts, Status, Project, ProjectItem, Provider, Defaults, Job, Render, Storyboard, Aspect, ChatMsg, Customer, DriveFile, Source, Picked, Sheet, WorkspaceInfo, DrivePlace, FolderListing, Loc, GoogleStatus, GoogleAccount, AuthInfo, User, Role, Page, EditorLink } from './types';

/** Called when the session has ended (401) so the app can show the sign-in page. */
export const auth = { onSignedOut: () => {} };

export async function req<T>(method: string, url: string, body?: any, headers: Record<string, string> = {}): Promise<T> {
  const finishLoading=beginLoading();
  try {
  const isBlob = body instanceof Blob;
  const send = () => fetch(url, {
    method,
    cache: 'no-store',
    headers: isBlob ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : isBlob ? body : JSON.stringify(body),
  });
  // The browser says only "Failed to fetch" when a request never reaches the server (network drop, a blocking
  // extension). Reads are retried twice; a change is not, so it can never be applied twice.
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    try { res = await send(); break; }
    catch {
      if (method !== 'GET' || attempt >= 2) throw new Error(navigator.onLine === false ? 'Mất kết nối mạng. Kiểm tra mạng rồi thử lại.' : 'Không kết nối được máy chủ. Kiểm tra mạng hoặc tiện ích chặn quảng cáo rồi thử lại.');
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  const data = await res.json().catch(() => ({ error: `Lỗi ${res.status}` }));
  if (res.status === 401 && !url.startsWith('/api/auth/')) auth.onSignedOut();
  if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
  if(method!=='GET'&&/^\/api\/(tasks|cards)(\/|$)/.test(url))window.dispatchEvent(new Event('dms:notifications-changed'));
  if(method!=='GET'&&/^\/api\/admin\/customer-statuses(?:\/|$)/.test(url))window.dispatchEvent(new Event('dms:customer-statuses'));
  if(method!=='GET'&&/^\/api\/(cards|lists|boards|tasks|task-projects|customers)(\/|$)/.test(url))window.dispatchEvent(new Event('dms:entities-changed'));
  return data as T;
  } finally {finishLoading();}
}

/** A project member's role: 'observer' follows every new task of the project, 'viewer' only sees it. */
export type ProjectRole = 'admin' | 'normal' | 'observer' | 'viewer';

const atQ = (at: Loc | null, sep: string) => (at ? `${sep}at=${encodeURIComponent(JSON.stringify(at))}` : '');

/** A tag put on a customer: one of the list, or a new name that joins it. */
type TagChoice = { id: string } | { name: string };
export const api = {
  me: () => req<AuthInfo>('GET', '/api/auth/me'),
  access: () => req<Record<Role, Page[]>>('GET', '/api/access'),
  setAccess: (member: Page[]) => req<Record<Role, Page[]>>('PUT', '/api/access', { member }),
  authConfig: () => req<{ turnstile: { siteKey: string; required: boolean } }>('GET', '/api/auth/config'),
  setup: (b: { name: string; email: string; password: string; code?: string }) => req<{ user: User }>('POST', '/api/auth/setup', b),
  login: (email: string, password: string, turnstileToken?: string) => req<{ user: User }>('POST', '/api/auth/login', { email, password, turnstileToken }),
  logout: () => req('POST', '/api/auth/logout'),
  forgotPassword: (email: string, turnstileToken?: string) => req<{ ok: true }>('POST', '/api/auth/forgot', { email, turnstileToken }),
  resetPassword: (token: string, password: string) => req<{ ok: true }>('POST', '/api/auth/reset', { token, password }),
  changePassword: (current: string, next: string) => req('PUT', '/api/auth/password', { current, next }),
  notificationInbox:()=>req<NotificationInbox>('GET','/api/notifications/inbox'),
  notificationLatest:()=>req<{latest:number;unread:number}>('GET','/api/notifications/latest'),
  readNotifications:(id?:string)=>req('POST','/api/notifications/read',{id}),
  requestNotificationEmail:(email:string)=>req<{sent:boolean}>('POST','/api/notifications/email/request',{email}),
  verifyNotificationEmail:(code:string)=>req('POST','/api/notifications/email/verify',{code}),
  removeNotificationEmail:()=>req('DELETE','/api/notifications/email'),
  notifications:()=>req<NotificationStatus>('GET','/api/notifications'),
  setNotifications:(enabled:boolean)=>req('PUT','/api/notifications',{enabled}),
  testNotification:()=>req('POST','/api/notifications/test',{}),
  disconnectNotificationMail:()=>req('DELETE','/api/notifications/mail'),
  profile: (id:string) => req<UserProfile>('GET', `/api/profiles/${encodeURIComponent(id)}`),
  updateProfile: (name: string, phone?: string) => req<User>('PUT', '/api/auth/profile', { name, ...(phone !== undefined ? { phone } : {}) }),
  setMyAvatar: (dataUrl: string) => req<User>('PUT', '/api/auth/avatar', { dataUrl }),
  removeMyAvatar: () => req<User>('DELETE', '/api/auth/avatar'),
  setStaffAvatar: (id: string, dataUrl: string) => req<{ avatarAt: number }>('PUT', `/api/admin/staff/${id}/avatar`, { dataUrl }),
  removeStaffAvatar: (id: string) => req<{ ok: boolean }>('DELETE', `/api/admin/staff/${id}/avatar`),
  avatars: () => req<Record<string, number>>('GET', '/api/avatars'),
  savePrefs: (p: Record<string, string | null>) => req('PUT', '/api/auth/prefs', p),
  users: () => req<User[]>('GET', '/api/users'),
  createUser: (u: { name: string; email: string; password?: string; role: string; teamRole?: string | null; deptRole?: string | null; notifyEmail?: string | null }) => req<User>('POST', '/api/users', u),
  updateUser: (id: string, u: Partial<{ name: string; email: string; phone: string; role: string; disabled: boolean; password: string; teamRole: string | null; deptRole: string | null; notifyEmail: string | null }>) => req<User>('PUT', `/api/users/${id}`, u),
  roles: () => req<TeamRole[]>('GET', '/api/roles'),
  createRole: (r: { name: string; color?: string; pages?: Page[] }) => req<TeamRole>('POST', '/api/roles', r),
  updateRole: (id: string, r: Partial<{ name: string; color: string; pages: Page[] }>) => req<TeamRole>('PUT', `/api/roles/${id}`, r),
  deleteRole: (id: string) => req('DELETE', `/api/roles/${id}`),
  createPosition: (deptId: string, p: { name: string; level: Level }) => req<DeptRole>('POST', `/api/roles/${deptId}/positions`, p),
  updatePosition: (id: string, p: Partial<{ name: string; level: Level }>) => req('PUT', `/api/positions/${id}`, p),
  deletePosition: (id: string) => req('DELETE', `/api/positions/${id}`),
  boards: () => req<BoardItem[]>('GET', '/api/boards'),
  board: (id: string) => req<Board>('GET', `/api/boards/${id}`),
  createBoard: (b: { name: string; bg: string; roleId: string | null; workspaceId?: string; private?: boolean; lists?: string[] }) => req<BoardItem>('POST', '/api/boards', b),
  updateBoard: (id: string, b: Partial<{ name: string; bg: string; roleId: string | null; private: boolean; workspaceId: string; about: string; memberEdit: boolean; labelText: boolean }>) => req('PUT', `/api/boards/${id}`, b),
  boardMembers: (id: string) => req<{ members: BoardMember[]; people: Person[] }>('GET', `/api/boards/${id}/members`),
  setBoardMember: (id: string, userId: string, level: Level) => req<{ members: BoardMember[] }>('PUT', `/api/boards/${id}/members/${userId}`, { level }),
  removeBoardMember: (id: string, userId: string) => req<{ members: BoardMember[] }>('DELETE', `/api/boards/${id}/members/${userId}`),
  transferBoardOwner: (id: string, userId: string) => req<{ ok: boolean; ownerId: string; members: BoardMember[] }>('POST', `/api/boards/${id}/transfer-owner`, { userId }),
  workspaces: () => req<Workspace[]>('GET', '/api/workspaces'),
  createWorkspace: (w: { name: string; about?: string; visibility?: 'private' | 'company' }) => req<Workspace>('POST', '/api/workspaces', w),
  updateWorkspace: (id: string, w: Partial<{ name: string; about: string; visibility: 'private' | 'company' }>) => req('PUT', `/api/workspaces/${id}`, w),
  setWorkspaceAvatar: (id: string, dataUrl: string | null) => req('PUT', `/api/workspaces/${id}/avatar`, { dataUrl }),
  deleteWorkspace: (id: string) => req('DELETE', `/api/workspaces/${id}`),
  workspaceMembers: (id: string) => req<{ members: WorkspaceMember[]; people: Person[] }>('GET', `/api/workspaces/${id}/members`),
  setWorkspaceMember: (id: string, userId: string, level: Level) => req<{ members: WorkspaceMember[] }>('PUT', `/api/workspaces/${id}/members/${userId}`, { level }),
  removeWorkspaceMember: (id: string, userId: string) => req<{ members: WorkspaceMember[] }>('DELETE', `/api/workspaces/${id}/members/${userId}`),
  transferWorkspaceOwner: (id: string, userId: string) => req<{ ok: boolean; ownerId: string; members: WorkspaceMember[] }>('POST', `/api/workspaces/${id}/transfer-owner`, { userId }),
  boardActivity: (id: string) => req<BoardActivity[]>('GET', `/api/boards/${id}/activity`),
  boardArchived: (id: string) => req<{ cards: (BoardCard & { listName: string })[]; lists: { id: string; name: string }[] }>('GET', `/api/boards/${id}/archived`),
  searchBoards: (q: string) => req<{ boards: BoardItem[]; cards: { id: string; title: string; boardId: string; boardName: string; boardBg: string; listName: string }[] }>('GET', `/api/boards-search?q=${encodeURIComponent(q)}`),
  createLabel: (boardId: string, l: { name: string; color: string }) => req<BoardLabel>('POST', `/api/boards/${boardId}/labels`, l),
  updateLabel: (id: string, l: Partial<{ name: string; color: string }>) => req('PUT', `/api/labels/${id}`, l),
  deleteLabel: (id: string) => req('DELETE', `/api/labels/${id}`),
  deleteBoard: (id: string) => req('DELETE', `/api/boards/${id}`),
  starBoard: (id: string, on: boolean) => req('PUT', `/api/boards/${id}/star`, { on }),
  boardBackground: (id: string, bg: string) => req('PUT', `/api/boards/${id}/background`, { bg }),
  createList: (boardId: string, name: string) => req<BoardList>('POST', `/api/boards/${boardId}/lists`, { name }),
  updateList: (id: string, l: Partial<{ name: string; index: number; archived: boolean; folded: boolean; color: string | null }>) => req('PUT', `/api/lists/${id}`, l),
  sortList: (id: string, by: 'newest' | 'oldest' | 'name' | 'due') => req('POST', `/api/lists/${id}/sort`, { by }),
  moveListCards: (id: string, to: string) => req('POST', `/api/lists/${id}/move-cards`, { to }),
  archiveListCards: (id: string) => req<{ archived: string[]; kept: number }>('POST', `/api/lists/${id}/archive-cards`),
  copyList: (id: string, name: string) => req('POST', `/api/lists/${id}/copy`, { name }),
  deleteList: (id: string) => req('DELETE', `/api/lists/${id}`),
  createCard: (listId: string, title: string, top = false, syncTask = true, kind: 'customer' | 'project' | 'task' = 'task', projectCardId: string | null = null, customerCardId: string | null = null, customerId: string | null = null) => req<BoardCard>('POST', `/api/lists/${listId}/cards`, { title, top, syncTask, kind, projectCardId, customerCardId, customerId }),
  card: (id: string) => req<CardDetail>('GET', `/api/cards/${id}`),
  updateCard: (id: string, c: Partial<{ title: string; description: string; result: string; startAt: number | null; dueAt: number | null; done: boolean; cover: string | null; archived: boolean; customerId: string | null; projectId: string | null; linkTask: boolean; listId: string; index: number }>) => req<CardDetail>('PUT', `/api/cards/${id}`, c),
  deleteCard: (id: string) => req('DELETE', `/api/cards/${id}`),
  bulkDeleteCards: (ids: string[]) => req<{ ok: true; deleted: number }>('POST', '/api/cards/bulk-delete', { ids }),
  copyCard: (id: string, title: string) => req<{ id: string }>('POST', `/api/cards/${id}/copy`, { title }),
  cardLabel: (id: string, labelId: string, on: boolean) => req('PUT', `/api/cards/${id}/labels`, { labelId, on }),
  cardMember: (id: string, userId: string, on: boolean) => req('PUT', `/api/cards/${id}/members`, { userId, on }),
  addChecklist: (cardId: string, title: string) => req('POST', `/api/cards/${cardId}/checklists`, { title }),
  renameChecklist: (id: string, title: string) => req('PUT', `/api/checklists/${id}`, { title }),
  deleteChecklist: (id: string) => req('DELETE', `/api/checklists/${id}`),
  addItem: (checklistId: string, text: string) => req('POST', `/api/checklists/${checklistId}/items`, { text }),
  updateItem: (id: string, i: Partial<{ text: string; done: boolean }>) => req('PUT', `/api/items/${id}`, i),
  deleteItem: (id: string) => req('DELETE', `/api/items/${id}`),
  addComment: (cardId: string, text: string) => req('POST', `/api/cards/${cardId}/comments`, { text }),
  editComment: (id: string, text: string) => req('PUT', `/api/comments/${id}`, { text }),
  deleteComment: (id: string) => req('DELETE', `/api/comments/${id}`),
  addAttachment: (cardId: string, url: string, name: string) => req('POST', `/api/cards/${cardId}/attachments`, { url, name }),
  deleteAttachment: (id: string) => req('DELETE', `/api/attachments/${id}`),
  addCardFiles: (cardId: string, keys: string[]) => req<{ added: number }>('POST', `/api/cards/${cardId}/files`, { keys }),
  boardCustomers: () => req<{ id: string; name: string }[]>('GET', '/api/boards-customers'),
  customerTasks: (customerId?: string) => req<CustomerTask[]>('GET', '/api/customer-tasks' + (customerId ? `?customer=${encodeURIComponent(customerId)}` : '')),
  inbox: () => req<InboxItem[]>('GET', '/api/inbox'),
  addInbox: (title: string, top = false) => req<InboxItem>('POST', '/api/inbox', { title, top }),
  updateInbox: (id: string, c: Partial<{ title: string; done: boolean; index: number }>) => req<InboxItem>('PUT', `/api/inbox/${id}`, c),
  deleteInbox: (id: string) => req('DELETE', `/api/inbox/${id}`),
  inboxToList: (id: string, listId: string, index: number) => req<BoardCard>('POST', `/api/inbox/${id}/to-list`, { listId, index }),
  chatMessages: (channel: 'general' | 'dm' = 'general', recipientId?: string, since = 0) =>
    req<ChatMessage[]>('GET', `/api/chat/messages?channel=${channel}${recipientId ? `&recipientId=${recipientId}` : ''}${since ? `&since=${since}` : ''}`),
  sendChatMessage: (message: string, channel: 'general' | 'dm' = 'general', recipientId?: string) =>
    req<ChatMessage>('POST', '/api/chat/messages', { message, channel, recipientId }),
  chatMembers: () => req<ChatMember[]>('GET', '/api/chat/members'),
  chatUnread: (since = 0) =>
    req<{
      unread: number;
      general: number;
      dms: Array<{ senderId: string; count: number; lastAt: number; senderName: string; senderEmail: string }>;
    }>('GET', `/api/chat/unread${since ? `?since=${since}` : ''}`),
  deleteChatMessage: (id: string) => req('DELETE', `/api/chat/messages/${id}`),
  clearChatMessages: (channel: 'general' | 'dm' = 'general', recipientId?: string) =>
    req('DELETE', `/api/chat/messages?channel=${channel}${recipientId ? `&recipientId=${recipientId}` : ''}`),
  planner: (from: number, to: number) => req<PlannerCard[]>('GET', `/api/planner?from=${from}&to=${to}`),
  syncTasksToBoard:()=>req<{total:number;created:number;linked:number;remaining:number}>('POST','/api/tasks/sync-board',{}),
  tasks: (q: { scope?: 'mine' | 'team' | 'all'; rel?: string; team?: string; person?: string; employee?:string; project?: string; campaign?:string; state?: string; q?: string }) =>
    req<{ tasks: TaskItem[]; linked: boolean }>('GET', `/api/tasks?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][])}`),
  projectMembers:(id:string)=>req<{ownerId:string;teamId:string|null;level:'admin'|'normal'|'observer';members:{id:string;name:string;level:ProjectRole}[];people:{id:string;name:string;teamId:string|null}[];teams:{id:string;name:string}[]}>('GET',`/api/task-projects/${id}/members`),
  setProjectTeam:(id:string,teamId:string|null)=>req('PUT',`/api/task-projects/${id}/team`,{teamId}),
  setProjectMember:(id:string,userId:string,level:ProjectRole)=>req('PUT',`/api/task-projects/${id}/members/${userId}`,{level}),
  removeProjectMember:(id:string,userId:string)=>req('DELETE',`/api/task-projects/${id}/members/${userId}`),
  projectCampaigns: (project: string) => req<TaskCampaign[]>('GET', `/api/task-projects/${project}/campaigns`),
  createCampaign: (project:string,name:string)=>req<TaskCampaign>('POST',`/api/task-projects/${project}/campaigns`,{name}),
  renameCampaign:(project:string,id:string,name:string)=>req('PUT',`/api/task-projects/${project}/campaigns/${id}`,{name}),
  deleteCampaign:(project:string,id:string)=>req('DELETE',`/api/task-projects/${project}/campaigns/${id}`),
  renameTaskProject:(id:string,name:string)=>req<{ok:true;id:string;name:string}>('PUT',`/api/task-projects/${id}`,{name}),
  updateTaskProject:(id:string,b:{name?:string;customerId?:string|null;teamId?:string|null;hold?:'paused'|'cancelled'|null;services?:string[]})=>req<{ok:true;id:string;name:string;customerId:string|null;teamId:string|null}>('PUT',`/api/task-projects/${id}`,b),
  createTaskProject:(b:{name:string;customerId?:string|null;teamId?:string|null;services?:string[]})=>req<{id:string;name:string;customerId:string|null;teamId:string|null}>('POST','/api/task-projects',b),
  deleteTaskProject:(id:string)=>req<{ok:true}>('DELETE',`/api/task-projects/${id}`),
  bulkDeleteTaskProjects:(ids:string[])=>req<{ok:true;deleted:number}>('POST','/api/task-projects/bulk-delete',{ids}),
  taskMeta: () => req<TaskMeta>('GET', '/api/tasks/meta'),
  task: (id: string) => req<TaskDetail>('GET', `/api/tasks/${id}`),
  createTask: (body: TaskWrite) => req<{ id: string }>('POST', '/api/tasks', body),
  updateTask: (id: string, body: TaskWrite) => req('PUT', `/api/tasks/${id}`, body),
  deleteTask: (id: string) => req('DELETE', `/api/tasks/${id}`),
  bulkDeleteTasks: (ids: string[]) => req<{ ok: true; deleted: number }>('POST', '/api/tasks/bulk-delete', { ids }),
  linkTaskCard: (id: string, body: { listId?: string; cardId?: string }) => req<{ cardId: string; boardId: string }>('POST', `/api/tasks/${id}/card`, body),
  unlinkTaskCard: (id: string) => req('DELETE', `/api/tasks/${id}/card`),
  setTaskStatus: (id: string, status: string) => req('PUT', `/api/tasks/${id}`, { status }),
  importTasks: (text: string, sourceName = '', people: Record<string, string | null> = {}) => req<TaskImportResult>('POST', '/api/tasks/import', { text, sourceName, people }),
  taskImportSheet: (id: string, page = 0) => req<TaskImportSheet>('GET', `/api/tasks/imports/${id}/sheet?page=${page}`),
  addTaskPersonName: (name: string) => req<{id:string;userId:null}>('POST', '/api/task-people', {name}),
  addTaskPerson: (userId: string) => req<{id:string;userId:string}>('POST', '/api/task-people', {userId}),
  linkTaskPerson: (id: string, userId: string | null) => req('PUT', `/api/task-people/${id}`, { userId }),
  adsServices: () => req<AdsService[]>('GET', '/api/ads/services'),
  createAdsService: (s: Omit<AdsService, 'id'>) => req<AdsService>('POST', '/api/ads/services', s),
  saveAdsService: (id: string, s: Partial<AdsService>) => req<AdsService>('PUT', `/api/ads/services/${id}`, s),
  deleteAdsService: (id: string) => req('DELETE', `/api/ads/services/${id}`),
  adsSummary: (until = '', fresh = false) => req<AdsSummary>('GET', `/api/ads/summary?${new URLSearchParams({ ...(until ? { until } : {}), ...(fresh ? { fresh: '1' } : {}) })}`),
  adAccounts: (fresh = false) => req<AdAccount[]>('GET', `/api/ads/meta/accounts${fresh ? '?fresh=1' : ''}`),
  adsReport: (account: string, since: string, until: string, fresh = false) => req<AdsReport>('GET', `/api/ads/meta/report?account=${encodeURIComponent(account)}&since=${since}&until=${until}${fresh ? '&fresh=1' : ''}`),
  adsSettings: () => req<AdsSettings>('GET', '/api/settings/ads'),
  saveAdsSettings: (s: { metaToken?: string; metaVersion?: string }) => req<AdsSettings>('PUT', '/api/settings/ads', s),
  deleteUser: (id: string) => req('DELETE', `/api/users/${id}`),
  health: () => req<{ ok: boolean; mock: boolean; ffmpeg: boolean; editor: boolean }>('GET', '/api/health'),
  editorLink: () => req<EditorLink>('GET', '/api/editor-link'),
  setEditorLink: (url: string) => req<EditorLink>('PUT', '/api/settings/editor-link', { url }),
  providers: () => req<{ providers: Provider[]; defaults: Defaults }>('GET', '/api/providers'),
  settings: () => req<{ keys: { env: string; source: 'saved' | 'env' | 'none'; masked: string }[]; defaults: Defaults; ffmpeg: boolean }>('GET', '/api/settings'),
  setKey: (env: string, value: string) => req('PUT', '/api/settings/keys', { env, value }),
  setDefaults: (d: Defaults) => req<Defaults>('PUT', '/api/settings/defaults', d),
  addCustomModel: (provider: string, model: string, remove = false) => req('POST', '/api/settings/custom-models', { provider, model, remove }),

  listProjects: () => req<ProjectItem[]>('GET', '/api/projects'),
  createProject: (p: Partial<Project>) => req<Project>('POST', '/api/projects', p),
  getProject: (id: string) => req<Project>('GET', `/api/projects/${id}`),
  saveProject: (id: string, p: { title?: string; aspect?: Aspect; storyboard?: Storyboard | null; chat?: ChatMsg[]; sources?: Source[]; sheet?: Sheet | null; outro?: Outro | null; status?: Status; note?: string; customerId?: string | null }) => req<Project>('PUT', `/api/projects/${id}`, p),
  projectDrive: (id: string, link: string) => req<Project>('POST', `/api/projects/${id}/drive`, { link }),
  projectAutoCustomer: (id: string) => req<Project>('POST', `/api/projects/${id}/customer/auto`),
  outroLogo: (projectId: string, file: File, opts: OutroOpts) => req<{ outro: Outro }>('POST', `/api/projects/${projectId}/outro/logo?opts=${encodeURIComponent(JSON.stringify(opts))}`, file, { 'content-type': file.type }),
  outroRender: (projectId: string, opts: OutroOpts) => req<{ outro: Outro }>('POST', `/api/projects/${projectId}/outro`, { opts }),
  duplicateProject: (id: string) => req<Project>('POST', `/api/projects/${id}/duplicate`),
  deleteProject: (id: string) => req('DELETE', `/api/projects/${id}`),

  storyboard: (b: { provider: string; model: string; prompt: string; seconds: number; aspect: Aspect; style: string; brand: boolean; projectId?: string; sources?: Source[]; sheet?: Sheet | null }) =>
    req<{ storyboard: Storyboard; picked: Picked[] | null }>('POST', '/api/ai/storyboard', b),
  refine: (b: { provider: string; model: string; storyboard: Storyboard; instruction: string; brand: boolean; projectId?: string; sources?: Source[]; sheet?: Sheet | null }) =>
    req<{ storyboard: Storyboard; picked: Picked[] | null }>('POST', '/api/ai/refine', b),
  capcutStart: (projectId: string, to: 'capcut' | 'zip') => req<{ job: string }>('POST', `/api/projects/${projectId}/capcut`, { to }),
  capcutStatus: (job: string) => req<{ phase: 'media' | 'pack' | 'done' | 'error'; to: 'capcut' | 'zip'; name: string; done: number; total: number; error: string | null; bytes: number }>('GET', `/api/capcut/${job}`),
  capcutLocal: () => req<{ drafts: string }>('GET', '/api/capcut/local'),
  capcutOpen: () => req<{ ok: true }>('POST', '/api/capcut/open'),
  sheetProgress: (token: string) => req<{ text: string }>('GET', `/api/sheets/progress/${token}`),
  sheetTabs: (link: string) => req<{ title: string; tabs: { name: string; cells: number }[] }>('POST', '/api/sheets/tabs', { link }),
  readSheet: (link: string, token?: string, tab?: string) => req<{ sheet: Sheet; sources: Source[]; missing: string[]; links: number; storyboard: Storyboard | null }>('POST', '/api/sheets/read', { link, token, tab }),
  scanSources: (link: string) => req<{ folder: string; account: string; total: number; sources: Source[] }>('POST', '/api/sources/scan', { link }),

  createJobs: (jobs: any[]) => req<Job[]>('POST', '/api/jobs', { jobs }),
  jobs: (projectId: string) => req<Job[]>('GET', `/api/jobs?projectId=${encodeURIComponent(projectId)}`),
  cancelJob: (id: string) => req<Job>('POST', `/api/jobs/${id}/cancel`),
  templatePreviews: () => req<Job[]>('GET', '/api/templates/previews'),
  uploadTemplateClip: (id: string, file: File, prompt: string, source: string) =>
    req<Job>('POST', `/api/templates/${encodeURIComponent(id)}/preview?${new URLSearchParams({ prompt, source })}`, file, { 'content-type': file.type || 'video/mp4' }),

  uploadRender: (projectId: string, blob: Blob, mp4: boolean) =>
    req<{ id: string; transcodeJob: string | null }>('POST', `/api/projects/${projectId}/renders${mp4 ? '?mp4=1' : ''}`, blob, { 'content-type': blob.type || 'video/webm' }),
  renders: (projectId: string) => req<Render[]>('GET', `/api/projects/${projectId}/renders`),
  deleteRender: (id: string) => req('DELETE', `/api/renders/${id}`),

  /** `at` = the folder this person is browsing (null = the shared root). */
  workspace: (at: Loc | null = null) => req<WorkspaceInfo>('GET', `/api/workspace${atQ(at, '?')}`),
  setWorkspace: (loc: Loc) => req<WorkspaceInfo>('PUT', '/api/workspace', { loc }),
  drivePlaces: () => req<DrivePlace[]>('GET', '/api/workspace/places'),
  browse: (loc: Loc) => req<FolderListing>('POST', '/api/workspace/browse', { loc }),
  makeFolder: (loc: Loc, name: string) => req<{ name: string; loc: Loc }>('POST', '/api/workspace/folders', { loc, name }),
  linkCustomerFolder: (id: string, loc: Loc) => req<Customer>('PUT', `/api/customers/${id}/folder`, { loc }),
  googleStatus: () => req<GoogleStatus>('GET', '/api/google/status'),
  setGoogleConfig: (clientId: string, clientSecret: string) => req('PUT', '/api/google/config', { clientId, clientSecret }),
  removeGoogleAccount: (email: string) => req<{ accounts: GoogleAccount[] }>('DELETE', `/api/google/accounts/${encodeURIComponent(email)}`),
  shareCustomerFile: (id: string, key: string) => req<{ url: string }>('POST', `/api/customers/${id}/files/${encodeURIComponent(key)}/share`),
  customers: (fresh = false, at: Loc | null = null) => req<Customer[]>('GET', `/api/customers?fresh=${fresh ? 1 : 0}${atQ(at, '&')}`),
  reportCustomers: () => req<{ id: string; name: string }[]>('GET', '/api/reports/customers'),
  reports: (q: { customer?: string; project?: string }) => req<ReportItem[]>('GET', `/api/reports?${new URLSearchParams(q)}`),
  createReport: (b: { projectId?: string; customerId?: string | null; meta?: { account: string; since: string; until: string } }) => req<Report>('POST', '/api/reports', b),
  report: (id: string) => req<Report>('GET', `/api/reports/${id}`),
  saveReport: (id: string, b: { title?: string; data?: ReportData }) => req<Report>('PUT', `/api/reports/${id}`, b),
  deleteReport: (id: string) => req('DELETE', `/api/reports/${id}`),
  reportVideoLibrary:(id:string,q:string,folder='')=>req<{videos:ReportVideo[];warnings:string[]}>('GET',`/api/reports/${id}/video-library?${new URLSearchParams({q,folder})}`),
  reportDriveBrowse:(id:string,at:{account?:string;id?:string;folder?:string;places?:boolean})=>req<ReportDriveFolder>('GET',`/api/reports/${id}/drive-browse?${new URLSearchParams(Object.entries(at).filter(([,v])=>v).map(([k,v])=>[k,v===true?'1':String(v)]))}`),
  linkReportVideos:(id:string,videos:{id:string;account:string}[],targetIndex?:number|null)=>req<Report & {added:number}>('POST',`/api/reports/${id}/link-videos`,{videos,...(targetIndex!==undefined&&targetIndex!==null?{targetIndex}:{})}),
  reportVideos: (id: string, link: string) => req<Report & { videos: number }>('POST', `/api/reports/${id}/videos`, { link }),
  autofillReport: (id: string) => req<Report>('POST', `/api/reports/${id}/autofill`, {}),
  reportMeta: (id: string, b: { account: string; since: string; until: string }) => req<Report>('POST', `/api/reports/${id}/meta`, b),
  shareReportVideos: (id: string) => req<{ shared: number; failed: string[] }>('POST', `/api/reports/${id}/share-videos`),
  reportImage: (id: string, file: File) => req<{ file: string; url: string }>('POST', `/api/reports/${id}/images`, file, { 'content-type': file.type }),
  customersAll: () => req<{ id: string; name: string; label: string }[]>('GET', '/api/customers/all'),
  customer: (id: string, fresh = false) => req<Customer>('GET', `/api/customers/${id}${fresh ? '?fresh=1' : ''}`),
  importCustomers: (text: string, linkProjects: boolean) => req<{created:number;kept:number;projectLinks:number;skipped:number}>('POST','/api/customers/import',{text,linkProjects}),
  customerMembers:(id:string)=>req<CustomerMembersData>('GET',`/api/customers/${id}/members`),
  setCustomerMember:(id:string,userId:string,level:Level)=>req('PUT',`/api/customers/${id}/members/${userId}`,{level}),
  removeCustomerMember:(id:string,userId:string)=>req('DELETE',`/api/customers/${id}/members/${userId}`),
  transferCustomerOwner:(id:string,userId:string)=>req<{ok:boolean;ownerId:string}>('POST',`/api/customers/${id}/transfer-owner`,{userId}),
  customerStatuses: () => req<import('./types').CustomerStatusOption[]>('GET', '/api/customers/statuses'),
  customerClassifications: () => req<{id:string;name:string;color:string;active:number}[]>('GET', '/api/customers/classifications'),
  customerSources: () => req<{id:string;name:string;color:string;active:number}[]>('GET', '/api/customers/sources'),
  addCustomerSource: (name: string) => req<{id:string;name:string;color:string;active:number}>('POST', '/api/customers/sources', { name }),
  customerManagers: () => req<{id:string;name:string;email:string;teamId:string|null}[]>('GET', '/api/customers/managers'),
  customerRecord: (id: string) => req<CustomerRecord>('GET', `/api/customers/${id}/record`),
  saveCustomerRecord: (id: string, data: Partial<Omit<CustomerRecord,'id'|'needs'|'status'|'tags'>> & { tags?: TagChoice[]; categoryId?: string | null; sourceId?: string | null; managerId?: string | null; status?: string | null }) => req<CustomerRecord>('PUT', `/api/customers/${id}/record`,data),
  /** Links a customer to the Drive folder of a pasted link (a connected Google account must be able to open it). */
  linkCustomerDrive: (id: string, link: string) => req<Customer>('PUT', `/api/customers/${id}/folder`, { link }),
  /** Unlinks the customer's folder; the folder and its files stay on Drive. */
  unlinkCustomerDrive: (id: string) => req<CustomerRecord>('DELETE', `/api/customers/${id}/folder`),
  serviceCatalog: () => req<ServiceRef[]>('GET', '/api/services'),
  /** Everything this account may open that matches (5 of each kind, or up to 50 of one `type`). */
  search: (q: string, type = '') => req<Record<string, { items: any[]; total: number }>>('GET', `/api/search?${new URLSearchParams({ q, ...(type ? { type } : {}) })}`),
  quickNotes: (q = '') => req<QuickNote[]>('GET', `/api/quick-notes${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  quickNote: (id: string) => req<QuickNote>('GET', `/api/quick-notes/${id}`),
  createQuickNote: (b: Partial<Pick<QuickNote, 'color' | 'x' | 'y' | 'w' | 'h'>>) => req<QuickNote>('POST', '/api/quick-notes', b),
  saveQuickNote: (id: string, b: Partial<Pick<QuickNote, 'body' | 'color' | 'open' | 'x' | 'y' | 'w' | 'h'>>) => req<QuickNote>('PUT', `/api/quick-notes/${id}`, b),
  removeQuickNote: (id: string) => req('DELETE', `/api/quick-notes/${id}`),
  orderQuickNotes: (ids: string[]) => req('PUT', '/api/quick-notes/order', { ids }),
  removeQuickNotes: (ids: string[]) => req<{ deleted: number }>('POST', '/api/quick-notes/delete', { ids }),
  customerTaskList: (id: string) => req<CustomerTaskRow[]>('GET', `/api/customers/${id}/tasks`),
  customerHistory: (id: string) => req<RecordChange[]>('GET', `/api/customers/${id}/history`),
  /** Adds a service to the catalogue by name (needs the services.create permission of Quản trị). */
  createService: (name: string) => req<ServiceRef>('POST', '/api/admin/services', { name }),
  customerDirectory: () => req<CustomerRecord[]>('GET', '/api/customers/directory'),
  customerProjects: (id: string) => req<{ id: string; name: string; tasks: number; services: ServiceRef[] }[]>('GET', `/api/customers/${id}/projects`),
  createCustomerProject: (id: string, b: { name?: string; projectId?: string; services?: string[] }) => req<{id: string; name: string}>('POST', `/api/customers/${id}/projects`, b),
  updateCustomerProject: (id: string, campaign: string, b: { name?: string; unlink?: boolean }) => req('PUT', `/api/customers/${id}/projects/${campaign}`, b),
  createCustomer: (c: Partial<Customer> & { existingFolder?: Loc; databaseOnly?: boolean; status?: string | null; tags?: TagChoice[]; categoryId?: string | null; sourceId?: string | null; managerId?: string | null; contact?: string; email?: string; phone?: string }, at: Loc | null = null) => req<Customer>('POST', `/api/customers${atQ(at, '?')}`, c),
  updateCustomer: (id: string, c: Partial<Customer>) => req<Customer>('PUT', `/api/customers/${id}`, c),
  deleteCustomer: (id: string) => req('DELETE', `/api/customers/${id}`),
  bulkDeleteCustomers: (ids: string[]) => req<{ ok: true; deleted: number }>('POST', '/api/customers/bulk-delete', { ids }),
  revealCustomer: (id: string) => req('POST', `/api/customers/${id}/reveal`),
  createVideoFolder: (id: string, name: string) => req<{ key: string; name: string }>('POST', `/api/customers/${id}/folders`, { name }),
  renameVideoFolder: (id: string, key: string, name: string) => req<{ key: string; name: string }>('PUT', `/api/customers/${id}/folders/${encodeURIComponent(key)}`, { name }),
  deleteVideoFolder: (id: string, key: string) => req('DELETE', `/api/customers/${id}/folders/${encodeURIComponent(key)}`),
  deleteCustomerFile: (id: string, key: string) => req('DELETE', `/api/customers/${id}/files/${encodeURIComponent(key)}`),
  /** What is inside a folder below a tab (folders open in place, like on Drive). */
  browseCustomer: (id: string, folder: string) => req<{ files: DriveFile[] }>('GET', `/api/customers/${id}/browse?folder=${encodeURIComponent(folder)}`),
  /**
   * Google Drive: the browser sends the file straight to Google through a resumable session the server opens,
   * so the file crosses the network once. Falls back to going through the server if Google refuses the browser.
   */
  uploadCustomerFile: async (id: string, file: File, folder: string, direct: boolean, onProgress: (k: number) => void) => {
    if (direct) {
      const q = new URLSearchParams({ name: file.name, folder, size: String(file.size), mime: file.type });
      const { url } = await req<{ url: string }>('POST', `/api/customers/${id}/videos/session?${q}`);
      const done = await xhrSend('PUT', url, file, onProgress).then(() => true, (e) => { if (e.network) return false; throw e; });
      if (done) return;
      // The browser lost Google's answer: only send again if Google did not receive the whole file.
      if ((await req<{ done: boolean }>('POST', `/api/customers/${id}/videos/session/check`, { url, size: file.size })).done) return;
      onProgress(0);
    }
    await xhrSend('POST', `/api/customers/${id}/videos?${new URLSearchParams({ name: file.name, folder })}`, file, onProgress);
  },
  sendSupport: (message: string) => req<{ ok: true; id: string }>('POST', '/api/support', { message }),
};

/** XHR instead of fetch so the page can show upload progress. Rejects with `network: true` when the request never got an answer. */
function xhrSend(method: string, url: string, file: File, onProgress: (k: number) => void) {
  const finish=beginLoading();
  return new Promise<any>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, url);
    if (file.type) x.setRequestHeader('content-type', file.type); // unknown types: the server goes by the file name
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => {
      if (x.status === 401 && url.startsWith('/')) auth.onSignedOut();
      let data: any = {}; try { data = JSON.parse(x.responseText); } catch { /* non-JSON */ }
      x.status < 300 ? resolve(data) : reject(new Error(data.error?.message || data.error || `Lỗi ${x.status}`));
    };
    x.onerror = () => reject(Object.assign(new Error('Mất kết nối khi tải lên'), { network: true }));
    x.timeout = 0;
    x.onabort=()=>reject(new Error('Đã huỷ tải lên'));
    x.send(file);
  }).finally(finish);
}
