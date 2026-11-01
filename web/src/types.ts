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
  scenes: Scene[];
}

/** A clip or photo in the client's Google Drive, streamed through the server (signed URL). */
export interface Source { id: string; account: string; sig: string; name: string; kind: 'video' | 'image'; mime: string; duration?: number; folder: string; url: string; thumb: string; row?: string }
export interface Picked { name: string; reason: string }
/** A video request form read from Google Sheets; the video follows its script table. */
/** One scene of the request sheet's script, cells copied as written. */
export interface ScriptRow { row: string; meaning: string; voice_over: string; visual: string; on_screen: string; source: string; duration: string; note: string }
export interface Sheet { title: string; link: string; csv: string; missing?: string[]; tab?: string; warning?: string; form: { customer: string; aspect: Aspect; seconds: number; sequence: { row: string; ref: string }[]; ignored_rows: string; script?: ScriptRow[]; deadline?: string; urgent?: boolean } }

export interface ChatMsg { who: 'user' | 'ai' | 'err'; text: string; at: number }
export interface Project { id: string; title: string; aspect: Aspect; customerId?: string | null; storyboard: Storyboard | null; chat: ChatMsg[]; sources?: Source[]; sheet?: Sheet | null; updatedAt: number; createdAt: number; scenes?: number; duration?: number; palette?: Palette }
/** A row of the project list (no storyboard). */
export interface ProjectItem { id: string; title: string; aspect: Aspect; updatedAt: number; createdAt: number; duration: number; clips: number; thumb: string | null; sheet: { title: string; link: string; customer: string; tab?: string; deadline?: string; urgent?: boolean; missing?: number; scenes?: number } | null; palette?: Palette }
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
export interface CustomerVideo { key: string; name: string; bytes: number; modifiedAt: number; url: string; thumb: string | null; driveId: string | null; driveUrl: string | null; shared: boolean }
export interface VideoFolder { key: string; name: string; driveUrl: string | null; videos: CustomerVideo[] }
export interface CustomerLink { label: string; url: string }
export interface Customer {
  id: string; name: string; links: CustomerLink[]; notes: string; createdAt: number; updatedAt: number;
  storage: Storage; account: string | null; folderLabel: string; folderLoc: Loc; folderPath: string; error?: string;
  videoCount?: number | null; folderCount?: number | null; projectCount?: number;
  videos?: CustomerVideo[]; folders?: VideoFolder[]; projects?: { id: string; title: string; aspect: Aspect; updatedAt: number }[]; driveFolderUrl?: string | null;
}
export interface WorkspaceInfo { loc: Loc; storage: Storage; label: string; account: string | null; drive: boolean; mounts: { account: string; dir: string }[]; view: Loc; viewIsRoot: boolean; crumbs: { name: string; loc: Loc }[] }
export interface DrivePlace { label: string; account: string | null; kind: 'my' | 'shared' | 'local'; via: 'google' | 'desktop' | 'local'; loc: Loc }
export interface FolderListing { loc: Loc; account: string | null; crumbs: { name: string; loc: Loc }[]; dirs: { name: string; loc: Loc }[] }
export interface GoogleAccount { email: string; name: string; picture: string }
export interface GoogleStatus { configured: boolean; clientId: string; redirectUri: string; accounts: GoogleAccount[] }
export type Role = 'admin' | 'member';
export interface User { id: string; email: string; name: string; role: Role; disabled: boolean; hasPassword: boolean; lastLogin: number | null; createdAt: number }
/** A top-level page whose access admins can grant or withhold per role. */
export type Page = 'workspace' | 'editor';
export interface AuthInfo { user: User | null; pages?: Page[]; setup: boolean; setupCode?: boolean; google: boolean }
