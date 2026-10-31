export type Layout = 'title' | 'bullets' | 'stat' | 'quote' | 'split' | 'outro';
export type Kind = 'llm' | 'video' | 'image' | 'tts';

export interface MediaRef { type: 'video' | 'image' | 'audio'; assetId: string; url: string; mime?: string; provider?: string; model?: string; prompt?: string; text?: string; duration?: number }

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
}

export interface Palette { bg1: string; bg2: string; accent: string; text: string }
export interface Storyboard {
  title: string;
  palette: Palette;
  font: string;
  music: { mood: 'calm' | 'upbeat' | 'epic' | 'none'; bpm: number };
  voice_style?: string;
  scenes: Scene[];
}

export interface ChatMsg { who: 'user' | 'ai' | 'err'; text: string; at: number }
export interface Project { id: string; title: string; aspect: Aspect; customerId?: string | null; storyboard: Storyboard | null; chat: ChatMsg[]; updatedAt: number; createdAt: number; scenes?: number; duration?: number; palette?: Palette }
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
export interface AuthInfo { user: User | null; setup: boolean; setupCode?: boolean; google: boolean }
