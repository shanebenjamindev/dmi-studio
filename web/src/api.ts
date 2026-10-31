// Typed client for the DM Studio REST API.
import type { Project, Provider, Defaults, Job, Render, Storyboard, Aspect, ChatMsg, Customer, WorkspaceInfo, DrivePlace, FolderListing, Loc, GoogleStatus, GoogleAccount, AuthInfo, User } from './types';

/** Called when the session has ended (401) so the app can show the sign-in page. */
export const auth = { onSignedOut: () => {} };

async function req<T>(method: string, url: string, body?: any, headers: Record<string, string> = {}): Promise<T> {
  const isBlob = body instanceof Blob;
  const res = await fetch(url, {
    method,
    headers: isBlob ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : isBlob ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: `Lỗi ${res.status}` }));
  if (res.status === 401 && !url.startsWith('/api/auth/')) auth.onSignedOut();
  if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
  return data as T;
}

const atQ = (at: Loc | null, sep: string) => (at ? `${sep}at=${encodeURIComponent(JSON.stringify(at))}` : '');

export const api = {
  me: () => req<AuthInfo>('GET', '/api/auth/me'),
  setup: (b: { name: string; email: string; password: string; code?: string }) => req<{ user: User }>('POST', '/api/auth/setup', b),
  login: (email: string, password: string) => req<{ user: User }>('POST', '/api/auth/login', { email, password }),
  logout: () => req('POST', '/api/auth/logout'),
  changePassword: (current: string, next: string) => req('PUT', '/api/auth/password', { current, next }),
  users: () => req<User[]>('GET', '/api/users'),
  createUser: (u: { name: string; email: string; password?: string; role: string }) => req<User>('POST', '/api/users', u),
  updateUser: (id: string, u: Partial<{ name: string; email: string; role: string; disabled: boolean; password: string }>) => req<User>('PUT', `/api/users/${id}`, u),
  deleteUser: (id: string) => req('DELETE', `/api/users/${id}`),
  health: () => req<{ ok: boolean; mock: boolean; ffmpeg: boolean }>('GET', '/api/health'),
  providers: () => req<{ providers: Provider[]; defaults: Defaults }>('GET', '/api/providers'),
  settings: () => req<{ keys: { env: string; source: 'saved' | 'env' | 'none'; masked: string }[]; defaults: Defaults; ffmpeg: boolean }>('GET', '/api/settings'),
  setKey: (env: string, value: string) => req('PUT', '/api/settings/keys', { env, value }),
  setDefaults: (d: Defaults) => req<Defaults>('PUT', '/api/settings/defaults', d),
  addCustomModel: (provider: string, model: string, remove = false) => req('POST', '/api/settings/custom-models', { provider, model, remove }),

  listProjects: () => req<Project[]>('GET', '/api/projects'),
  createProject: (p: Partial<Project>) => req<Project>('POST', '/api/projects', p),
  getProject: (id: string) => req<Project>('GET', `/api/projects/${id}`),
  saveProject: (id: string, p: { title?: string; aspect?: Aspect; storyboard?: Storyboard | null; chat?: ChatMsg[] }) => req<Project>('PUT', `/api/projects/${id}`, p),
  duplicateProject: (id: string) => req<Project>('POST', `/api/projects/${id}/duplicate`),
  deleteProject: (id: string) => req('DELETE', `/api/projects/${id}`),

  storyboard: (b: { provider: string; model: string; prompt: string; seconds: number; aspect: Aspect; style: string; brand: boolean; projectId?: string }) =>
    req<{ storyboard: Storyboard }>('POST', '/api/ai/storyboard', b),
  refine: (b: { provider: string; model: string; storyboard: Storyboard; instruction: string; brand: boolean; projectId?: string }) =>
    req<{ storyboard: Storyboard }>('POST', '/api/ai/refine', b),

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
  shareCustomerVideo: (id: string, key: string) => req<{ url: string }>('POST', `/api/customers/${id}/videos/${encodeURIComponent(key)}/share`),
  customers: (fresh = false, at: Loc | null = null) => req<Customer[]>('GET', `/api/customers?fresh=${fresh ? 1 : 0}${atQ(at, '&')}`),
  customer: (id: string, fresh = false) => req<Customer>('GET', `/api/customers/${id}${fresh ? '?fresh=1' : ''}`),
  createCustomer: (c: Partial<Customer>, at: Loc | null = null) => req<Customer>('POST', `/api/customers${atQ(at, '?')}`, c),
  updateCustomer: (id: string, c: Partial<Customer>) => req<Customer>('PUT', `/api/customers/${id}`, c),
  deleteCustomer: (id: string) => req('DELETE', `/api/customers/${id}`),
  revealCustomer: (id: string) => req('POST', `/api/customers/${id}/reveal`),
  createVideoFolder: (id: string, name: string) => req<{ key: string; name: string }>('POST', `/api/customers/${id}/folders`, { name }),
  renameVideoFolder: (id: string, key: string, name: string) => req<{ key: string; name: string }>('PUT', `/api/customers/${id}/folders/${encodeURIComponent(key)}`, { name }),
  deleteVideoFolder: (id: string, key: string) => req('DELETE', `/api/customers/${id}/folders/${encodeURIComponent(key)}`),
  deleteCustomerVideo: (id: string, key: string) => req('DELETE', `/api/customers/${id}/videos/${encodeURIComponent(key)}`),
  /**
   * Google Drive: the browser sends the file straight to Google through a resumable session the server opens,
   * so the video crosses the network once. Falls back to going through the server if Google refuses the browser.
   */
  uploadCustomerVideo: async (id: string, file: File, folder: string, direct: boolean, onProgress: (k: number) => void) => {
    if (direct) {
      const q = new URLSearchParams({ name: file.name, folder, size: String(file.size), mime: file.type || 'video/mp4' });
      const { url } = await req<{ url: string }>('POST', `/api/customers/${id}/videos/session?${q}`);
      const done = await xhrSend('PUT', url, file, onProgress).then(() => true, (e) => { if (e.network) return false; throw e; });
      if (done) return;
      // The browser lost Google's answer: only send again if Google did not receive the whole file.
      if ((await req<{ done: boolean }>('POST', `/api/customers/${id}/videos/session/check`, { url, size: file.size })).done) return;
      onProgress(0);
    }
    await xhrSend('POST', `/api/customers/${id}/videos?${new URLSearchParams({ name: file.name, folder })}`, file, onProgress);
  },
};

/** XHR instead of fetch so the page can show upload progress. Rejects with `network: true` when the request never got an answer. */
function xhrSend(method: string, url: string, file: File, onProgress: (k: number) => void) {
  return new Promise<any>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, url);
    x.setRequestHeader('content-type', file.type || 'video/mp4');
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => {
      if (x.status === 401 && url.startsWith('/')) auth.onSignedOut();
      let data: any = {}; try { data = JSON.parse(x.responseText); } catch { /* non-JSON */ }
      x.status < 300 ? resolve(data) : reject(new Error(data.error?.message || data.error || `Lỗi ${x.status}`));
    };
    x.onerror = () => reject(Object.assign(new Error('Mất kết nối khi tải lên'), { network: true }));
    x.timeout = 0;
    x.send(file);
  });
}
