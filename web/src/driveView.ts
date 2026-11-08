// How Drive folders show (thumbnails in a grid, or a list): one choice for every place Drive opens (a customer's Drive,
// the video picker of reports), kept with the account like the theme.
import { useSyncExternalStore } from 'react';
import { remember } from './prefs';

export type DriveView = 'grid' | 'list';
const KEY = 'dms.driveView';
const subs = new Set<() => void>();
const read = (): DriveView => { try { return localStorage.getItem(KEY) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; } };
export function setDriveView(v: DriveView) {
  try { localStorage.setItem(KEY, v); } catch { /* private mode */ }
  remember(KEY, v);
  subs.forEach((f) => f());
}
export const useDriveView = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, read);
