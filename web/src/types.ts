export type Layout = 'title' | 'bullets' | 'stat' | 'quote' | 'split' | 'outro';
export type Kind = 'llm' | 'video' | 'image' | 'tts';

export interface MediaRef { type: 'video' | 'image' | 'audio'; assetId: string; url: string; mime?: string; provider?: string; model?: string; prompt?: string; text?: string; duration?: number }

/** One cut inside a scene: a clip (from `from` seconds) or a photo, held for `dur` seconds with an optional camera move. */
export interface Shot { media: MediaRef; from?: number; dur: number; move?: 'none' | 'push-in' | 'pull-out' | 'pan-left' | 'pan-right' }
/** On-screen text timed inside its scene (seconds from the scene start). */
export interface TextOverlay { text: string; at: number; dur: number; style: 'title' | 'price' | 'tag' | 'lower' | 'cta'; pos: 'top' | 'center' | 'bottom' }

export interface Scene {
  id: string;
  layout: Layout;
  headline: string;
  subtext?: string;
  bullets?: string[];
  stat_value?: string;
  stat_label?: string;
  icon?: string;
  caption?: string;
  visual_prompt?: string;
  duration: number;
  animation: string;
  background: string;
  media?: MediaRef | null;
  voice?: MediaRef | null;
  /** Edit mode: the cuts and timed text of this scene. */
  shots?: Shot[];
  texts?: TextOverlay[];
}

export interface Palette { bg1: string; bg2: string; accent: string; text: string }
export interface Storyboard {
  title: string;
  palette: Palette;
  font: string;
  music: { mood: 'calm' | 'upbeat' | 'epic' | 'none'; bpm: number };
  voice_style?: string;
  /** 'edit' = footage-first cut built from a request form (shots + timed text), not text-card layouts. */
  mode?: 'edit';
  /** The client's logo, shown in a corner for the whole video (edit mode). */
  logo?: MediaRef | null;
  /** false: a client's video made from its request form, so the Detailers Movement logo is not drawn on it. */
  brandLogo?: boolean;
  scenes: Scene[];
}

/** A clip or photo in the client's Google Drive, streamed through the server (signed URL). */
export interface Source { id: string; account: string; sig: string; name: string; kind: 'video' | 'image'; mime: string; duration?: number; folder: string; url: string; thumb: string; row?: string }
export interface Picked { name: string; reason: string }
/** A video request form read from Google Sheets; the video follows its script table. */
/** One scene of the request sheet's script, cells copied as written. */
export interface ScriptRow { row: string; meaning: string; voice_over: string; visual: string; on_screen: string; source: string; duration: string; note: string }
export interface Sheet { title: string; link: string; csv: string; missing?: string[]; tab?: string; warning?: string; form: { customer: string; aspect: Aspect; seconds: number; sequence: { row: string; ref: string }[]; ignored_rows: string; script?: ScriptRow[]; deadline?: string; urgent?: boolean } }

/** How the logo outro is made (see server/outro.ts): seconds, background ('auto', 'black', 'white' or '#rrggbb'), size. */
export interface OutroOpts { dur: number; bg: string; removeBg: boolean; holes: boolean; shine: boolean; size: 'S' | 'M' | 'L' }
/**
 * The logo outro at the end of the timeline: its clip, the cut-out logo, how its background was handled. `bg`: 'logo'
 * (gradient in the logo's colour), 'logo-bg' (in the colour it stood on), 'expand', 'black', 'white' or a chosen '#rrggbb';
 * `colors`: the gradient's middle and edge; `palette`: the logo's colours, most present first.
 */
export interface Outro { media: MediaRef; logo: string; opts: OutroOpts; aspect: Aspect; removed: 'alpha' | 'key' | 'vision' | 'none'; bg: string; small: boolean; faint: boolean; at: number; palette?: string[]; colors?: string[] }
/** Where a project stands in the work ('' = not set). */
export type Status = '' | 'todo' | 'doing' | 'review' | 'fix' | 'done';
export interface ExportRecord { at: number; to: 'zip' | 'capcut'; name: string }
/** A Drive folder or file pasted on a project (its folder, the finished video…), as a connected account sees it. */
export interface DriveLink { id: string; name: string; folder: boolean; account: string; url: string }
/** The customer a project belongs to, with its folder (path, and link when it is on Google Drive). */
export interface ProjectCustomer { id: string; name: string; label: string; driveUrl: string | null }

export interface ChatMsg { who: 'user' | 'ai' | 'err'; text: string; at: number }
export interface Project { id: string; title: string; aspect: Aspect; customerId?: string | null; storyboard: Storyboard | null; chat: ChatMsg[]; sources?: Source[]; sheet?: Sheet | null; outro?: Outro | null; status?: Status; note?: string; exports?: ExportRecord[]; customer?: ProjectCustomer | null; drive?: DriveLink | null; updatedAt: number; createdAt: number; scenes?: number; duration?: number; palette?: Palette }
/** A row of the project list (no storyboard). */
export interface ProjectItem { id: string; title: string; aspect: Aspect; updatedAt: number; createdAt: number; duration: number; clips: number; thumb: string | null; sheet: { title: string; link: string; customer: string; tab?: string; deadline?: string; urgent?: boolean; missing?: number; scenes?: number } | null; palette?: Palette; status: Status; outro: boolean; exported: number | null; customerId: string | null; customerName: string | null }
export type Aspect = '16:9' | '9:16' | '1:1';

export interface ProviderModel { id: string; label: string; note?: string; custom?: boolean }
export interface Provider {
  id: string; name: string; vendor: string; kind: Kind; keyEnv: string; keyHint?: string; docs?: string; note?: string;
  voices?: string[]; mock: boolean; configured: boolean; models: ProviderModel[];
}
export interface ModelChoice { provider: string; model: string; voice?: string }
export interface Defaults { llm?: ModelChoice; video?: ModelChoice; image?: ModelChoice; tts?: ModelChoice; mediaKind?: 'video' | 'image' }

export interface Job {
  id: string; projectId: string; sceneId: string; kind: 'video' | 'image' | 'tts' | 'transcode'; provider: string; model: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed'; error?: string; result?: MediaRef | null; prompt: string; createdAt: number; updatedAt: number;
}
export interface Render { id: string; status: string; url: string; download: string; mime: string; bytes: number; createdAt: number }

export type Loc = { kind: 'fs'; dir: string } | { kind: 'gdrive'; account: string; id: string; label?: string; owned?: boolean };
export type Storage = 'google' | 'desktop' | 'local';
/** What a file in a customer folder is (like Drive's "Type" filter). */
export type FileKind = 'folder' | 'video' | 'image' | 'audio' | 'pdf' | 'doc' | 'sheet' | 'slides' | 'archive' | 'other';
/** A file or folder in a customer folder. `url` streams it here (null for folders and Google Docs/Sheets/Slides, which open on Drive). */
export interface DriveFile {
  key: string; name: string; kind: FileKind; mime: string; bytes: number; modifiedAt: number;
  url: string | null; thumb: string | null; driveId: string | null; driveUrl: string | null; shared: boolean; shortcut?: boolean;
}
/** A folder of the customer folder, shown as a tab: its files and its own folders. */
export interface DriveFolder { key: string; name: string; driveUrl: string | null; files: DriveFile[] }
export interface CustomerLink { label: string; url: string }
/** A service from the catalogue (Quản trị › Dịch vụ), as a customer's need. */
export interface ServiceRef { id: string; name: string; category?: string | null }
/** `drive`: the folder the customer is linked to (null: database only); `needs`: its services, those of its projects. */
/** On the Customers page list: what Quản trị › Khách hàng sets (status, category, source, the staff member in charge). */
export interface CustomerStatusOption {id:string;name:string;color:string;pos:number;active:number|boolean}
/** `tags`: its tags (the list is Quản trị › Khách hàng › Phân loại); `category` is the first of them. */
export interface CustomerRecord { status?: string | null; category?: { id: string; name: string; color: string } | null; tags?: CustomerTag[]; source?: { id: string; name: string; color: string } | null; owner?: { id: string; name: string } | null; manager?: { id: string; name: string } | null;
  drive?: { label: string; url: string | null } | null; needs?: ServiceRef[]; createdBy?:string|null;level?:Level;canManage?:boolean;canDelete?:boolean; projects?:number; campaigns?:number; tasks?:number; completed?:number; hasDrive?:boolean; id: string; name: string; contact: string; phone: string; email: string; notes: string }
export interface CustomerTag { id: string; name: string; color: string }
export interface Customer {
  id: string; name: string; links: CustomerLink[]; notes: string; createdAt: number; updatedAt: number;
  storage: Storage; account: string | null; folderLabel: string; folderLoc: Loc | null; folderPath: string; error?: string;
  videoCount?: number | null; fileCount?: number | null; folderCount?: number | null; projectCount?: number;
  files?: DriveFile[]; folders?: DriveFolder[]; projects?: { id: string; title: string; aspect: Aspect; updatedAt: number; status: Status; clips: number; deadline: string; urgent: boolean }[]; driveFolderUrl?: string | null;
}
export interface WorkspaceInfo { loc: Loc; storage: Storage; label: string; account: string | null; drive: boolean; mounts: { account: string; dir: string }[]; view: Loc; viewIsRoot: boolean; crumbs: { name: string; loc: Loc }[] }
export interface DrivePlace { label: string; account: string | null; kind: 'my' | 'shared' | 'local'; via: 'google' | 'desktop' | 'local'; loc: Loc }
export interface FolderListing { loc: Loc; account: string | null; crumbs: { name: string; loc: Loc }[]; dirs: { name: string; loc: Loc }[] }
export interface GoogleAccount { email: string; name: string; picture: string }
export interface GoogleStatus { configured: boolean; clientId: string; redirectUri: string; accounts: GoogleAccount[] }
export type Role = 'admin' | 'member';
/** `role`: 'admin' for the company's admins (everything), else 'member'. `teamRole`: the person's department; `deptRole`:
 *  their role in it, whose `level` (admin / member / view only) says what they may do in the department. */
export interface User {
  id: string; email: string; name: string; role: Role; disabled: boolean; hasPassword: boolean; lastLogin: number | null; createdAt: number;
  teamRole: string | null; deptRole: string | null; deptRoleName: string | null; level: Level;
  phone?: string; avatarAt?: number | null;
  /** Where this person's notifications are emailed (admins' list only). */
  notifyEmail?: string | null;
}
/** A role in a department (Trưởng phòng, Editor…) and its level. */
export interface DeptRole { id: string; name: string; level: Level; members: number }
/** A department (phòng ban: Media Execute, Account / Sale…): the pages its people open, its own board, and its roles. */
export interface TeamRole { id: string; name: string; color: string; pages: Page[]; members: number; positions?: DeptRole[] }
/** Workspace: boards of lists of cards (see server/boards.ts); `roleId` null = shared with everyone. */
/** What someone may do on a board or in a workspace, like Trello: settings and members / edit / view and comment. */
export type Level = 'admin' | 'normal' | 'observer';
/** The company's workspace (id 'company': everyone) or one a person made, private until shared. */
/** `visibility`: 'private' (its people only, the default) or 'company' (everyone in the company may view it). */
/** `customerId`: the customer a workspace of one's own is for (its new boards start out for that customer). */
export interface Workspace { avatar?: string | null; id: string; name: string; about: string; kind: 'company' | 'personal'; visibility: 'private' | 'company'; ownerId: string | null; level: Level; members: number; customerId?: string | null; customerName?: string | null }
export interface Person { id: string; name: string; email: string }
export interface WorkspaceMember extends Person { level: Level; owner: boolean }
export interface BoardItem {
  /** `bg`, `labelText` (label names on cards) and folded lists: the board's own look, the same for everyone. `canShape`: may
   *  this account change the board itself (name, background, look, description, lists, labels): its admins, and its
   *  members when `memberEdit`. */
  id: string; name: string; bg: string; roleId: string | null; workspaceId: string; private: boolean; createdBy: string | null;
  starred: boolean; cards: number; taskCount?: number; updatedAt: number; level: Level; memberEdit: boolean; canShape: boolean; labelText: boolean;
  /** Who is on it (its maker, then the people added), in the board list only. */
  people?: { id: string; name: string; avatarAt?: number | null }[];
  /** The customer the board is for (null: none). */
  customerId?: string | null; customerName?: string | null;
  /** Its type (the services it is for), the view it opens in, and the date it starts (its creation, unless set). */
  services?: ServiceRef[]; view?: BoardViewKind; startAt?: number | null;
}
export type BoardViewKind = 'board' | 'table' | 'calendar' | 'dashboard' | 'timeline';
export interface BoardLabel { id: string; name: string; color: string }
/** Someone who sees the board; `added`: given a level on the board itself (not just through its workspace or role). */
export interface BoardMember extends Person { level?: Level; added?: boolean; auto?: boolean; owner?: boolean }
/** The front of a card on the board: what it shows (`checks`: [done, total] of its checklist items). */
export interface BoardCard {
  kind?: 'customer' | 'project' | 'task'; projectCardId?: string | null;
  id: string; listId: string; title: string; cover: string | null; startAt: number | null; dueAt: number | null; done: boolean; desc: boolean;
  labels: string[]; members: string[]; comments: number; attachments: number; checks: [number, number] | null; createdAt: number; createdBy: string | null;
  customerId: string | null; customerName: string | null;
  projectId?: string | null; projectName?: string | null;
}
/** `folded`: shown as a narrow strip, for everyone (set by whoever may change the board). */
export interface BoardList { id: string; name: string; folded?: boolean; color?: string | null; cards: BoardCard[] }
export interface Board extends BoardItem { about: string; labels: BoardLabel[]; members: BoardMember[]; lists: BoardList[] }
export interface BoardActivity { id: string; cardId: string | null; cardTitle: string; userId: string; userName: string; action: string; data: any; createdAt: number }
/** A link on a card, or a video of its customer's folder (`key`: the file there, `customerId`: whose folder). */
export interface CardAttachment { id: string; name: string; url: string; createdAt: number; userId: string; customerId: string | null; key: string | null }
/** A task of the team (Công việc), imported from their task app or made here. `state`: what its status means now. */
export type TaskState = 'done' | 'done_late' | 'overdue' | 'doing' | 'todo' | 'paused' | 'cancelled' | 'other';
export interface TaskPerson { id: string; name: string; userId: string | null; avatarAt?: number | null }
export interface TaskCampaign { id:string; name:string; projectId:string; tasks:number }
export interface TaskItem {
  campaign: {id:string;name:string;projectId:string} | null;
  boardLink?:{cardId:string;boardId:string;boardName:string;listName:string;listId:string}|null;hasBoardLink?:boolean;
  canDelete?: boolean;
  id: string; externalId: string | null; title: string; status: string; state: TaskState; startAt: number | null; dueAt: number | null; doneAt: number | null;
  project: { id: string; name: string; customerId: string | null } | null; parent: { id: string; title: string } | null; children: number;
  createdBy: { id: string; name: string } | null; assignees: TaskPerson[]; cardPeople?: TaskPerson[]; followers: { id: string; name: string; avatarAt?: number | null }[]; labels: string[]; services?: ServiceRef[]; sourceUpdatedAt: number | null; stub: boolean; updatedAt: number; createdAt?: number;
}
export interface TaskDetail extends TaskItem {
  statuses?: string[];
  description: string; result: string | null; resultHidden: boolean; canEdit: boolean; canEditDescription: boolean; canDelete: boolean; hasBoardLink: boolean; boardLink: { cardId: string; boardId: string; listId: string; boardName: string; listName: string } | null; path: { id: string; title: string }[];
  /** The whole branch under it (subtasks, theirs, …), each with its `parent`, as far as this account sees them. */
  childTasks: TaskItem[];
  comments?: { id: string; userId: string; userName: string; text: string; createdAt: number; updatedAt?: number; replyToId?: string | null }[];
  activity?: { id: string; userId?: string; user: string; text: string; at: number; action?: string }[];
}
export interface TaskMeta {
  campaigns:TaskCampaign[]; teams:{id:string;name:string;color:string}[];
  workTeams?:{id:string;name:string;color:string;departmentId:string|null;memberIds:string[];leaderIds:string[]}[];
  people: (TaskPerson & { userName: string | null; tasks: number })[]; projects: { id: string; name: string; customerId: string | null; customerName?: string | null; teamId:string|null;createdBy:string|null;level:Level;tasks: number; completed?: number; overdue?: number; assignees?: TaskPerson[]; stage?: import('../../shared/projects').ProjectStage; hold?: import('../../shared/projects').ProjectHold | null; services?: ServiceRef[] }[];
  mine: string[]; statuses: string[]; users: { id: string; name: string; email: string; teamId: string | null; workTeamIds?: string[] }[];
  labels?: { id: string; name: string; color: string }[];
  imports: { id: string; rows: number; created: number; updated: number; at: number; by: string; sourceName: string; hasSheet: boolean }[];
}
export interface TaskWrite {
  title?: string; description?: string; result?: string; status?: string; startAt?: number | null; dueAt?: number | null;
  campaignId?: string | null; projectId?: string | null; parentId?: string | null; assigneeIds?: string[]; assigneeUserIds?: string[]; followerUserIds?: string[]; labels?: string[]; services?: string[];
}
export interface TaskImportSheet { id: string; name: string; headers: string[]; rows: string[][]; taskIds: (string | null)[]; titleColumn: number; start: number; total: number; page: number; pages: number }
export interface TaskImportResult { sheetRows: number; sheetColumns: number; importId: string; sourceName: string; rows: number; skipped: number; created: number; updated: number; parents: number; stubs: number; people: number; linked: number; projects: number; labels: number }
/** A Meta ad account the token reads. */
export interface AdAccount { id: string; accountId: string; name: string; currency: string; timezone: string; status: string; active: boolean; business: string }
/** Sums over a period and the ratios recomputed from them (null: nothing to divide by); results by each campaign's type. */
export interface AdsTotals {
  spend: number; impressions: number; reach: number; clicks: number; linkClicks: number; leads: number; messages: number; comments: number;
  ctr: number | null; cpc: number | null; cpm: number | null; cpl: number | null; cpme: number | null; cplc: number | null; frequency: number | null;
  primary: number; total: number; costPerTotal: number | null;
}
export type AdsConversion = 'LeadForm' | 'Messages' | 'Traffic' | 'Engagement';
export interface AdsCampaign extends Omit<AdsTotals, 'primary' | 'total' | 'costPerTotal'> {
  id: string; name: string; objective: string; previousSpend: number | null; previousCostPerTotal: number | null;
  results: { type: AdsConversion; kpi: string; primary: number | null; total: number | null; costPerPrimary: number | null; costPerTotal: number | null };
}
export interface AdsReport {
  range: { since: string; until: string }; compare: { since: string; until: string }; current: AdsTotals; previous: AdsTotals;
  daily: { date: string; spend: number; leads: number; messages: number; linkClicks: number; impressions: number; clicks: number }[];
  campaigns: AdsCampaign[]; lastDataDate: string | null;
}
export interface AdsSettings { metaToken: string; metaConnected: boolean; metaVersion: string; who?: { name: string; accounts: number } | null }
/** A card in someone's own inbox (Workspace ▸ Inbox): jotted down, then dragged onto a board. */
export interface InboxItem { id: string; title: string; done: boolean; createdAt: number }
export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderEmail: string;
  recipientId: string | null;
  channel: 'general' | 'dm';
  message: string;
  createdAt: number;
  isMe: boolean;
}
export interface ChatMember {
  id: string;
  name: string;
  email: string;
  teamRole?: string | null;
  lastMessage?: string | null;
  lastAt?: number | null;
  lastActive?: number | null;
}
/** One of someone's cards with a date, for the planner (Workspace ▸ Planner). */
export interface PlannerCard { id: string; title: string; boardId: string; boardName: string; boardBg: string; listName: string; dueAt: number | null; startAt: number | null; done: boolean; canEdit: boolean }
/** A card for a customer, with its videos (the Drive page's overview). */
/** Work of a workspace's boards for a customer (the card's own, or its board's), with the subtasks under it: the Dashboard view of a workspace. */
export interface ClientCard {
  /** A card (`cardId`), or a subtask with no card here (`boardId` null; opens as its task). `parentTaskId`: the task it sits
   *  under, for the tree. `stage`: where it stands. */
  id: string; cardId: string | null; taskId: string | null; parentTaskId: string | null; stage: 'todo' | 'doing' | 'overdue' | 'done';
  title: string; boardId: string | null; boardName: string; boardBg: string; listName: string; listPos: number; done: boolean; startAt: number | null; dueAt: number | null;
  workspaceId?: string | null; workspaceName?: string | null;
  updatedAt: number; customerId: string; customerName: string; labels: { name: string; color: string }[]; members: { id: string; name: string; avatarAt: number | null }[]; services: ServiceRef[];
}
export interface CustomerTask {
  id: string; title: string; customerId: string; boardId: string; boardName: string; boardBg: string; listName: string; done: boolean; dueAt: number | null; updatedAt: number;
  /** The work's result: files of the customer's folder put on the card. */
  files: CardAttachment[];
}
/** Everything on a card (its back). */
export interface CardDetail {
  linkedTask?: { id: string } | null;
  /** The result note of a card without a task (null for those who may not read it; `resultHidden` when there is one). */
  result: string | null; resultHidden: boolean;
  /** Once written, a description is changed only by whoever wrote it (and admins). */
  canEditDescription: boolean;
  id: string; boardId: string; listId: string; listName: string; title: string; description: string; cover: string | null;
  startAt: number | null; dueAt: number | null; done: boolean; archived: boolean; createdAt: number; createdBy: string | null; labels: string[]; members: string[];
  /** The customer the task is for. */
  customerId: string | null; customerName: string | null;
  projectId?: string | null; projectName?: string | null;
  checklists: { id: string; title: string; items: { id: string; text: string; done: boolean }[] }[];
  attachments: CardAttachment[];
  comments: { id: string; userId: string; userName: string; text: string; createdAt: number; edited: boolean; replyToId?: string | null }[];
  activity: BoardActivity[];
}
/** A top-level page whose access admins can grant or withhold per role. */
export type Page = 'workspace' | 'editor' | 'ads';
/** What the signed-in account may do in Quản trị (shared/permissions.ts): each permission it holds, at its scope. */
export interface AdminAccess { superAdmin: boolean; rank: number; perms: Record<string, 'personal' | 'team' | 'department' | 'organization'> }
export interface AuthInfo { siteLock?: { message: string } | null; admin?: AdminAccess | null; user: User | null; pages?: Page[]; prefs?: Record<string, string> | null; setup: boolean; setupCode?: boolean; google: boolean }

/** A Meta Ads campaign report (see server/reports.ts): every field of the page sent to the client; images are file names. */
export interface ReportKV { label: string; value: string }
export interface ReportShot { label: string; image: string }
export interface ReportData {
  client: string;
  hero: { eyebrow: string; title: string; subtitle: string; year: string; month: string; pill: string; agencyLogo: string; clientLogo: string; clientBg: string };
  budget: { on: boolean; kicker: string; title: string; statLabel: string; amount: string; currency: string; statFoot: string; settingsTitle: string; settings: ReportKV[]; focusTitle: string; focus: ReportKV[]; shots: ReportShot[] };
  adsets: {
    on: boolean; kicker: string; title: string; noteTitle: string; note: string;
    sets: { name: string; desc: string; type: string; details: ReportKV[]; url: string; shots: ReportShot[] }[];
    form: { on: boolean; eyebrow: string; title: string; desc: string; steps: ReportShot[] };
  };
  audience: { on: boolean; kicker: string; title: string; note: string; fields: ReportKV[]; shots: ReportShot[] };
  creatives: { on: boolean; kicker: string; title: string; previews: { label: string; url: string }[]; caveat: string; folder: { url: string; name: string } | null; items: { type: string; title: string; url: string; thumb: string; captions: { label: string; text: string }[] }[] };
  copy: { on: boolean; kicker: string; title: string; headlines: string[]; descriptions: string[] };
  /** Meta Ads results of `account` over [since, until], as taken at `fetchedAt`. */
  performance: { on: boolean; kicker: string; title: string; note: string; account: { id: string; name: string; currency: string } | null; since: string; until: string; data: ReportPerf | null; fetchedAt: number | null };
  footer: { brand: string; line: string };
}
export interface ReportPerf {
  compare: { since: string; until: string }; current: AdsTotals; previous: AdsTotals; lastDataDate: string | null;
  daily: { date: string; spend: number; leads: number; messages: number; linkClicks: number }[];
  campaigns: { name: string; type: AdsConversion; kpi: string; spend: number; primary: number | null; comments: number; total: number | null; costPerTotal: number | null; previousCostPerTotal: number | null; ctr: number | null; impressions: number; clicks: number; linkClicks: number }[];
}
/** A report in a list: whose it is and, when it has them, which Meta Ads numbers it carries. */
export interface ReportItem {
  id: string; title: string; customerId: string | null; projectId: string | null; createdAt: number; updatedAt: number;
  customerName?: string | null; client?: string; meta?: { account: string; since: string; until: string } | null;
}
export interface ReportVideo { id:string; account:string; name:string; url:string; seconds:number|null; modifiedAt:string; thumb:string }
/** One Drive folder in the report's video picker: where it is, its sub-folders and the videos directly in it. */
/** A change to a customer's record, on its History tab. */
export interface RecordChange { action: string; by: string | null; before: Record<string, any> | null; after: Record<string, any> | null; at: number }
export interface CustomerTaskRow { id: string; title: string; status: string; state: string; category: string; dueAt: number | null; doneAt: number | null; project: { id: string; name: string } | null; campaign: { id: string; name: string } | null; assignees: { id: string; name: string; userId: string | null }[]; priority: { id: string; name: string; color: string } | null }
/** A private sticky note (Ghi chú nhanh): `body` is its formatted text (only when one note is fetched). */
export type NoteColor = 'yellow' | 'green' | 'pink' | 'purple' | 'blue' | 'dark';
export interface QuickNote { id: string; title: string; preview: string; color: NoteColor; open: boolean; x: number | null; y: number | null; w: number | null; h: number | null; hasImage: boolean; createdAt: number; updatedAt: number; body?: string }
export interface ReportDriveFolder { places?: { account: string; id: string; label: string }[]; account: string; id: string; crumbs: { id: string; name: string }[]; dirs: { id: string; name: string }[]; videos: ReportVideo[] }
export interface Report extends ReportItem { data: ReportData; autofillWarnings?: string[] }

/** The Mac's internet address for the editor, as the cloud site keeps it, and whether that Mac answers. */
export interface EditorLink { url: string; status: 'none' | 'ready' | 'no-editor' | 'blocked' | 'offline' }

export interface UserProfile { id:string;name:string;email?:string;phone?:string;avatarAt?:number|null;role?:Role;level?:Level;department:{id:string;name:string;color:string}|null;position:string|null;createdAt?:number;canEdit:boolean }

export interface NotificationStatus {enabled:boolean;loginEmail:string;email:string|null;verified:boolean;pendingEmail:string|null;codeSent:boolean;sender:string|null;mailReady:boolean;googleConfigured:boolean;gmailSetupUrl?:string;mailIssue?:{code:string;message:string;helpUrl?:string}|null;recent:{id:string;title:string;state:string;createdAt:number;sentAt:number|null;error:string|null}[]}

export interface CustomerMembersData {ownerId:string;level:Level;members:{id:string;name:string;email:string;level:Level}[];people:{id:string;name:string;email:string}[]}

export interface NotificationInbox {unread:number;items:{id:string;taskId:string|null;link:string|null;detail?:{status:string;dueAt:number|null;text:string}|null;title:string;body:string;createdAt:number;read:boolean}[]}
