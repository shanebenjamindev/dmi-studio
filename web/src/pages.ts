// Every page's code is fetched the first time it is shown, so the first download holds only the shell (top bar,
// sign-in, store) and the page the address opens; once the first screen is up, the rest load while the browser idles.
import { lazy, type ComponentType } from 'react';
import { beginLoading } from './loading';
import type { View } from './store';

const RELOADED = 'dms.reloadedFor';
/** A page's file that is no longer there (a build or deploy replaced the files while this window was open): the window
 *  loads the new version, once per page and address, rather than staying on a page that cannot draw. */
function reloadForNewVersion(page: string) {
  const key = page + '@' + location.href;
  try { if (sessionStorage.getItem(RELOADED) === key) return false; sessionStorage.setItem(RELOADED, key); } catch { return false; }
  location.reload();
  return true;
}
/** A page's code: `preload` fetches it once; `Page` draws it, under the activity signal while it is still coming. */
function lazyPage<M extends Record<K, ComponentType>, K extends keyof M>(load: () => Promise<M>, name: K) {
  let module: Promise<M> | undefined;
  // A download that failed (a dropped connection, a deploy that replaced the files) is tried again next time.
  const preload = () => module ||= load().catch((e) => { module = undefined; throw e; });
  const Page = lazy(async () => {
    const done = beginLoading();
    try { return { default: (await preload())[name] }; }
    catch (e) {
      // Shown, it is a newer version's turn: wait for the reload instead of showing the error.
      if (reloadForNewVersion(String(name))) await new Promise(() => {});
      throw e;
    }
    finally { done(); }
  });
  return { preload, Page };
}

const PAGES = {
  boards: lazyPage(() => import('./components/Boards'), 'BoardsPage'),
  tasks: lazyPage(() => import('./components/Tasks'), 'TasksPage'),
  projects: lazyPage(() => import('./components/WorkProjects'), 'WorkProjects'),
  workspace: lazyPage(() => import('./components/Workspace'), 'WorkspacePage'),
  customers: lazyPage(() => import('./components/Customers'), 'CustomersPage'),
  profile: lazyPage(() => import('./components/Profile'), 'ProfilePage'),
  admin: lazyPage(() => import('./admin/AdminApp'), 'AdminApp'),
  tools: lazyPage(() => import('./components/Tools'), 'ToolsPage'),
  reports: lazyPage(() => import('./components/Reports'), 'ReportsPage'),
  ads: lazyPage(() => import('./components/AdsPage'), 'AdsPage'),
};
type PageKey = keyof typeof PAGES;
export type Can = { admin: boolean };

/** The page a view shows. Quản trị is for whoever holds a permission of it (shared/permissions.ts); a view without a
 * page of its own shows Drive. */
function pageOf(view: View, can: Can): PageKey {
  if (view === 'admin') return can.admin ? 'admin' : 'workspace';
  return view in PAGES ? (view as PageKey) : 'workspace';
}
export const pageFor = (view: View, can: Can) => PAGES[pageOf(view, can)].Page;

/** Starts fetching the page the address opens, alongside the first API calls (before it is known who is signed in). */
export function preloadView(view: View) {
  PAGES[pageOf(view, { admin: true })].preload().catch(() => {});
}

// Safari has no requestIdleCallback.
const idle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(() => fn()) : setTimeout(fn, 1500));
/** The pages this account opens, one at a time while the browser idles, so switching to them is instant. */
export function prefetchPages(views: View[], can: Can) {
  const queue = [...new Set(views.map((v) => pageOf(v, can)))];
  const next = () => { const key = queue.shift(); if (key) PAGES[key].preload().then(() => idle(next), () => idle(next)); };
  idle(next);
}
