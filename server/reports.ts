import {customerLevels,requireCustomer,customerAccessSql} from './customer-access';
// Campaign reports: the page Detailers Movement sends a client once a Meta Ads campaign is set up (budget, ad sets,
// audience, creatives with their captions, headlines and descriptions) and how it performs (Meta Ads numbers for a
// period, against the one before, taken from the Marketing API and kept in the report), exported as one self-contained HTML file in the
// look of the reports made by hand so far (reports/template.css). Every field is edited in DMI Workspace; a new report is
// filled in from what DMI Workspace knows: the customer, its logo (cut out for a logo outro), its videos (its projects,
// with their Drive links and thumbnails) and the agency's logo.
import fs from 'node:fs';
import reportCss from './reports/template-css';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Router, HttpError, json, readJson, readBody, sendFile } from './http';
import { DATA_DIR, CLOUD_STORAGE_ONLY } from './config';
import { all, get, run, uid, now } from './db';
import * as G from './google';
import { driveId, locate } from './sources';
import { metaSnapshot } from './ads';
import { currentUser, pagesOf } from './auth';

const DIR = path.join(DATA_DIR, 'reports');
const HERE = () => path.dirname(fileURLToPath(import.meta.url));
let css: string | null = null;
const CSS = () => CLOUD_STORAGE_ONLY ? reportCss : (css ??= fs.readFileSync(path.join(HERE(), 'reports', 'template.css'), 'utf8'));

type KV = { label: string; value: string };
/** A screenshot behind a button: `image` is a file of the report ('' = none yet). */
type Shot = { label: string; image: string };
export type ReportData = {
  client: string;
  hero: { eyebrow: string; title: string; subtitle: string; year: string; month: string; pill: string; agencyLogo: string; clientLogo: string; clientBg: string };
  budget: { on: boolean; kicker: string; title: string; statLabel: string; amount: string; currency: string; statFoot: string; settingsTitle: string; settings: KV[]; focusTitle: string; focus: KV[]; shots: Shot[] };
  adsets: {
    on: boolean; kicker: string; title: string; noteTitle: string; note: string;
    sets: { name: string; desc: string; type: string; details: KV[]; url: string; shots: Shot[] }[];
    form: { on: boolean; eyebrow: string; title: string; desc: string; steps: Shot[] };
  };
  audience: { on: boolean; kicker: string; title: string; note: string; fields: KV[]; shots: Shot[] };
  creatives: {
    on: boolean; kicker: string; title: string; previews: { label: string; url: string }[]; caveat: string;
    /** The Drive folder the videos were taken from (each video's link and thumbnail). */
    folder: { url: string; name: string } | null;
    items: { type: string; title: string; url: string; thumb: string; captions: { label: string; text: string }[] }[];
  };
  copy: { on: boolean; kicker: string; title: string; headlines: string[]; descriptions: string[] };
  /** Meta Ads results of `account` over [since, until], as taken at `fetchedAt` (null until taken). */
  performance: { on: boolean; kicker: string; title: string; note: string; account: { id: string; name: string; currency: string } | null; since: string; until: string; data: Perf | null; fetchedAt: number | null };
  footer: { brand: string; line: string };
};
type PerfTotals = {
  spend: number; impressions: number; reach: number; clicks: number; linkClicks: number; leads: number; messages: number; comments: number;
  ctr: number | null; cpc: number | null; cpm: number | null; cpl: number | null; cpme: number | null; cplc: number | null; frequency: number | null;
  primary: number; total: number; costPerTotal: number | null;
};
type Perf = {
  compare: { since: string; until: string }; current: PerfTotals; previous: PerfTotals; lastDataDate: string | null;
  daily: { date: string; spend: number; leads: number; messages: number; linkClicks: number }[];
  campaigns: { name: string; type: string; kpi: string; spend: number; primary: number | null; comments: number; total: number | null; costPerTotal: number | null; previousCostPerTotal: number | null; ctr: number | null; impressions: number; clicks: number; linkClicks: number }[];
};

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const kv = (...labels: string[]): KV[] => labels.map((label) => ({ label, value: '' }));

/** A new report: the sections and labels of the reports sent so far, values left to fill in. */
function blank(client: string, service: string): ReportData {
  const d = new Date();
  return {
    client,
    hero: { eyebrow: client.toUpperCase(), title: 'Meta Ads', subtitle: 'Campaign Setup & Creative Summary', year: String(d.getFullYear()), month: MONTHS[d.getMonth()], pill: service, agencyLogo: '', clientLogo: '', clientBg: '#050505' },
    budget: {
      on: true, kicker: 'Campaign-Level Budget', title: 'Budget Overview', statLabel: 'Campaign Daily Budget', amount: '', currency: 'USD', statFoot: 'Shared across both ad sets',
      settingsTitle: 'Budget Settings', settings: [{ label: 'Budget strategy', value: 'Campaign Budget' }, { label: 'Advantage+ campaign budget', value: 'On' }, { label: 'Campaign daily budget', value: '' }, { label: 'Campaign bid strategy', value: 'Highest volume' }],
      focusTitle: 'Campaign Focus', focus: [{ label: 'Business', value: client }, { label: 'Service', value: service }, ...kv('Offer', 'Promotional availability', 'Offer deadline')],
      shots: [{ label: 'View Budget Screenshot', image: '' }],
    },
    adsets: {
      on: true, kicker: 'Lead Generation Setup', title: 'Ad Set Configuration', noteTitle: 'One campaign, two conversion paths', note: 'Both ad sets use the same creative and ad copy.',
      sets: [
        { name: 'Messenger Lead', desc: 'Facebook lead form with Messenger follow-up', type: 'Instant Form', details: [{ label: 'Lead destination', value: 'Facebook Instant Form' }, { label: 'Follow-up', value: 'Messenger conversation' }, { label: 'Lead form', value: 'Five-step experience' }, { label: 'Ad creative', value: 'Shared with Ad Set 02' }], url: '', shots: [] },
        { name: 'Website / Landing Page', desc: `Website leads using the ${service || 'service'} landing page`, type: 'Website', details: [{ label: 'Conversion location', value: 'Website' }, { label: 'Performance goal', value: 'Maximize number of leads' }, { label: 'Browser add-ons', value: 'None' }, { label: 'Ad creative', value: 'Shared with Ad Set 01' }], url: '', shots: [{ label: 'View Conversion Screenshot', image: '' }, { label: 'View Destination Screenshot', image: '' }] },
      ],
      form: { on: true, eyebrow: 'AD SET 01 · LEAD COLLECTION', title: 'Facebook Instant Form', desc: 'Screens from the Messenger Lead form. Select any step to view its screenshot.', steps: ['Offer & Vehicle Info', 'Your Message', 'Contact Details', 'Privacy & Submit', 'Confirmation'].map((label) => ({ label, image: '' })) },
    },
    audience: {
      on: true, kicker: 'Shared Location & Targeting', title: 'Audience Overview', note: '',
      fields: [...kv('Target Location', 'Location Radius'), { label: 'Age Range', value: '25–65+' }, { label: 'Gender', value: 'All genders' }, { label: 'Languages', value: 'All languages' }, ...kv('Detailed Targeting Suggestion'), { label: 'Advantage+ Audience', value: 'On' }, { label: 'Custom Audiences', value: 'None' }],
      shots: [{ label: 'Ad Set 01 Location', image: '' }, { label: 'Ad Set 01 Audience', image: '' }],
    },
    creatives: { on: true, kicker: 'Creative Assets & Preview Links', title: 'Creative Previews & Captions', previews: [], caveat: '', folder: null, items: [] },
    copy: { on: true, kicker: service, title: 'Headlines & Descriptions', headlines: [], descriptions: [] },
    performance: { on: true, kicker: 'Meta Ads Results', title: 'Performance Overview', note: '', account: null, since: '', until: '', data: null, fetchedAt: null },
    footer: { brand: 'DETAILERS MOVEMENT', line: `${client}${service ? ` · ${service}` : ''} Meta Ads` },
  };
}

// ------------------------------------------------------------------ what a client may save (shapes and sizes kept sane)
const str = (x: any, max = 4000) => String(x ?? '').slice(0, max);
const bool = (x: any) => x !== false;
const list = <T>(x: any, max: number, f: (v: any) => T): T[] => (Array.isArray(x) ? x.slice(0, max).map(f) : []);
const kvs = (x: any) => list(x, 40, (v) => ({ label: str(v?.label, 200), value: str(v?.value, 1000) }));
const IMG = /^[0-9a-z]{8,40}\.(png|jpg|webp|gif)$/;
const image = (x: any) => (IMG.test(String(x || '')) ? String(x) : '');
const shots = (x: any) => list(x, 20, (v) => ({ label: str(v?.label, 200), image: image(v?.image) }));
const n0 = (x: any) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const nn = (x: any) => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
const DATE = (x: any) => (/^\d{4}-\d{2}-\d{2}$/.test(String(x || '')) ? String(x) : '');
const perfTotals = (t: any): PerfTotals => ({
  spend: n0(t?.spend), impressions: n0(t?.impressions), reach: n0(t?.reach), clicks: n0(t?.clicks), linkClicks: n0(t?.linkClicks), leads: n0(t?.leads), messages: n0(t?.messages), comments: n0(t?.comments),
  ctr: nn(t?.ctr), cpc: nn(t?.cpc), cpm: nn(t?.cpm), cpl: nn(t?.cpl), cpme: nn(t?.cpme), cplc: nn(t?.cplc), frequency: nn(t?.frequency), primary: n0(t?.primary), total: n0(t?.total), costPerTotal: nn(t?.costPerTotal),
});
function perf(x: any): Perf | null {
  if (!x || typeof x !== 'object' || !x.current) return null;
  return {
    compare: { since: DATE(x.compare?.since), until: DATE(x.compare?.until) }, current: perfTotals(x.current), previous: perfTotals(x.previous), lastDataDate: DATE(x.lastDataDate) || null,
    daily: list(x.daily, 400, (d) => ({ date: DATE(d?.date), spend: n0(d?.spend), leads: n0(d?.leads), messages: n0(d?.messages), linkClicks: n0(d?.linkClicks) })).filter((d) => d.date),
    campaigns: list(x.campaigns, 40, (c) => ({ name: str(c?.name, 300), type: str(c?.type, 30), kpi: str(c?.kpi, 10), spend: n0(c?.spend), primary: nn(c?.primary), comments: n0(c?.comments), total: nn(c?.total),
      costPerTotal: nn(c?.costPerTotal), previousCostPerTotal: nn(c?.previousCostPerTotal), ctr: nn(c?.ctr), impressions: n0(c?.impressions), clicks: n0(c?.clicks), linkClicks: n0(c?.linkClicks) })),
  };
}
function clean(d: any): ReportData {
  const b = blank('', ''), h = d?.hero || {}, bu = d?.budget || {}, a = d?.adsets || {}, au = d?.audience || {}, c = d?.creatives || {}, cp = d?.copy || {}, f = d?.footer || {}, pf = d?.performance || {};
  return {
    client: str(d?.client, 200),
    hero: { eyebrow: str(h.eyebrow, 200), title: str(h.title ?? b.hero.title, 200), subtitle: str(h.subtitle ?? b.hero.subtitle, 300), year: str(h.year, 20), month: str(h.month, 40), pill: str(h.pill, 200),
      agencyLogo: image(h.agencyLogo), clientLogo: image(h.clientLogo), clientBg: /^#[0-9a-f]{6}$/i.test(h.clientBg) ? h.clientBg : '#050505' },
    budget: { on: bool(bu.on), kicker: str(bu.kicker, 200), title: str(bu.title, 200), statLabel: str(bu.statLabel, 200), amount: str(bu.amount, 60), currency: str(bu.currency, 20), statFoot: str(bu.statFoot, 300),
      settingsTitle: str(bu.settingsTitle, 200), settings: kvs(bu.settings), focusTitle: str(bu.focusTitle, 200), focus: kvs(bu.focus), shots: shots(bu.shots) },
    adsets: { on: bool(a.on), kicker: str(a.kicker, 200), title: str(a.title, 200), noteTitle: str(a.noteTitle, 300), note: str(a.note, 2000),
      sets: list(a.sets, 10, (s) => ({ name: str(s?.name, 200), desc: str(s?.desc, 400), type: str(s?.type, 60), details: kvs(s?.details), url: str(s?.url, 500), shots: shots(s?.shots) })),
      form: { on: bool(a.form?.on), eyebrow: str(a.form?.eyebrow, 200), title: str(a.form?.title, 200), desc: str(a.form?.desc, 600), steps: shots(a.form?.steps) } },
    audience: { on: bool(au.on), kicker: str(au.kicker, 200), title: str(au.title, 200), note: str(au.note, 2000), fields: kvs(au.fields), shots: shots(au.shots) },
    creatives: { on: bool(c.on), kicker: str(c.kicker, 200), title: str(c.title, 200), previews: list(c.previews, 20, (p) => ({ label: str(p?.label, 200), url: str(p?.url, 500) })), caveat: str(c.caveat, 1000),
      folder: c.folder?.url ? { url: str(c.folder.url, 500), name: str(c.folder.name, 300) } : null,
      items: list(c.items, 30, (i) => ({ type: str(i?.type, 200), title: str(i?.title, 200), url: str(i?.url, 500), thumb: image(i?.thumb), captions: list(i?.captions, 10, (x) => ({ label: str(x?.label, 100), text: str(x?.text, 6000) })) })) },
    copy: { on: bool(cp.on), kicker: str(cp.kicker, 200), title: str(cp.title, 200), headlines: list(cp.headlines, 30, (x) => str(x, 400)), descriptions: list(cp.descriptions, 30, (x) => str(x, 600)) },
    performance: {
      on: bool(pf.on), kicker: str(pf.kicker ?? b.performance.kicker, 200), title: str(pf.title ?? b.performance.title, 200), note: str(pf.note, 2000),
      account: pf.account?.id && /^act_\d+$/.test(pf.account.id) ? { id: str(pf.account.id, 40), name: str(pf.account.name, 200), currency: /^[A-Z]{3}$/.test(pf.account.currency) ? pf.account.currency : 'USD' } : null,
      since: DATE(pf.since), until: DATE(pf.until), data: perf(pf.data), fetchedAt: nn(pf.fetchedAt),
    },
    footer: { brand: str(f.brand, 200), line: str(f.line, 300) },
  };
}

// ------------------------------------------------------------------ images
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
/** Keep an image with the report; returns its file name. */
async function keep(id: string, buf: Buffer, mime: string) {
  const ext = EXT[mime];
  if (!ext) throw new HttpError(400, 'Ảnh cần là PNG, JPG, WebP hoặc GIF');
  const dir = path.join(DIR, id), file = `${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}.${ext}`;
  if (CLOUD_STORAGE_ONLY) {
    if (buf.length > 512*1024) throw new HttpError(400,'Ảnh trên cloud tối đa 512 KB; hãy giảm kích thước ảnh trước khi tải.');
    await run('INSERT INTO report_images(report_id,file,mime,data) VALUES(?,?,?,?)',id,file,mime,buf.toString('base64')); return file;
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), buf);
  return file;
}
const dataUri = (id: string, file: string) => {
  try { return `data:${MIME[file.split('.').pop()!]};base64,${fs.readFileSync(path.join(DIR, id, file)).toString('base64')}`; } catch { return ''; }
};

// ------------------------------------------------------------------ the HTML
const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** Text with **bold** parts. */
const rich = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
const two = (n: number) => String(n).padStart(2, '0');
const link = (url: string) => (/^https?:\/\//i.test(url.trim()) ? url.trim() : url.trim() ? `https://${url.trim()}` : '');
const ICON = {
  table: '<svg aria-hidden="true" fill="none" height="16" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.85" viewBox="0 0 24 24" width="16"><rect height="16" rx="3" width="16" x="4" y="4"></rect><path d="M4 10h16M10 10v10"></path></svg>',
  chart: '<svg aria-hidden="true" fill="none" height="16" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" viewBox="0 0 24 24" width="16"><rect height="18" rx="3" width="18" x="3" y="3"></rect><path d="m7 16 4-4 3 2 3-4"></path></svg>',
  pin: '<svg aria-hidden="true" fill="none" height="16" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.85" viewBox="0 0 24 24" width="16"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"></path><circle cx="12" cy="10" r="2.5"></circle></svg>',
  people: '<svg aria-hidden="true" fill="none" height="16" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.85" viewBox="0 0 24 24" width="16"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v10M7 12h10"></path></svg>',
  out: '<svg fill="none" height="19" stroke="currentColor" stroke-linecap="round" stroke-width="1.8" viewBox="0 0 24 24" width="19"><path d="M7 17 17 7M8 7h9v9"></path></svg>',
  chevron: '<svg aria-hidden="true" fill="none" focusable="false" height="18" viewBox="0 0 24 24" width="18" xmlns="http://www.w3.org/2000/svg"><path d="M5.5 9.5 12 16l6.5-6.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>',
  close: '<svg fill="none" height="19" stroke="currentColor" stroke-linecap="round" stroke-width="2" viewBox="0 0 24 24" width="19"><path d="M18 6 6 18M6 6l12 12"></path></svg>',
  play: '<svg aria-hidden="true" fill="currentColor" height="24" viewBox="0 0 24 24" width="24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5Z"></path></svg>',
};
const SCRIPT = `(() => {
  let lastTrigger = null;
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const closeControl = target.closest('[data-close-shot]');
    if (closeControl) { event.preventDefault(); const d = document.getElementById(closeControl.dataset.closeShot); if (d instanceof HTMLDialogElement && d.open) d.close(); return; }
    const openControl = target.closest('[data-open-shot]');
    if (openControl) { event.preventDefault(); const d = document.getElementById(openControl.dataset.openShot); if (d instanceof HTMLDialogElement && !d.open) { lastTrigger = openControl; d.showModal(); } return; }
    const dialog = target.closest('dialog.location-shot-dialog');
    if (dialog && target === dialog && dialog.open) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); }
  });
  document.querySelectorAll('dialog.location-shot-dialog').forEach((d) => d.addEventListener('close', () => { if (lastTrigger && lastTrigger.isConnected) lastTrigger.focus({ preventScroll: true }); lastTrigger = null; }));
  // A video plays in place (Drive's player) once its picture is clicked, in the picture's shape.
  document.addEventListener('click', (event) => {
    const play = event.target instanceof Element && event.target.closest('[data-drive-video]');
    if (!play) return;
    const img = play.querySelector('img'), frame = document.createElement('iframe');
    frame.className = 'video-frame';
    frame.src = 'https://drive.google.com/file/d/' + encodeURIComponent(play.dataset.driveVideo) + '/preview';
    frame.allow = 'autoplay; fullscreen';
    frame.allowFullscreen = true;
    frame.title = play.getAttribute('aria-label') || 'Video';
    if (img && img.naturalWidth) frame.style.aspectRatio = img.naturalWidth + ' / ' + img.naturalHeight;
    play.replaceWith(frame);
  });
})();`;
// Small additions to the template: a thumbnail not added yet, and a video that plays in place.
const MORE_CSS = '.thumb-empty{aspect-ratio:9/16;display:grid;place-items:center;border-radius:14px;background:#dfe9f8;color:#697d9a;font-size:12px}'
  + '.video-play{position:relative;display:block;margin:auto;padding:0;border:0;background:none;cursor:pointer;border-radius:11px}'
  + '.video-play .thumb-empty{height:300px}'
  + '.video-play-badge{position:absolute;left:50%;top:50%;width:58px;height:58px;margin:-29px 0 0 -29px;display:grid;place-items:center;border-radius:50%;background:#0b1b33cc;color:#fff;box-shadow:0 6px 20px #0b1b3366;transition:transform .15s}'
  + '.video-play:hover .video-play-badge,.video-play:focus-visible .video-play-badge{transform:scale(1.08);background:#1268e3}'
  + '.video-frame{display:block;margin:auto;height:300px;aspect-ratio:9/16;max-width:100%;border:0;border-radius:11px;background:#000;box-shadow:0 8px 26px #1739642e}'
  + '.creative-thumb figcaption a{color:inherit}'
  + '@media(max-width:1100px){.video-frame,.video-play .thumb-empty{height:275px}}@media(max-width:750px){.video-frame,.video-play .thumb-empty{height:270px}}'
  + '@media print{.video-play-badge{display:none}}'
  // Meta Ads results
  + '.perf-period{margin:-6px 0 16px;color:var(--muted);font-size:13px}.perf-stats{grid-template-columns:repeat(4,minmax(0,1fr))}'
  + '.perf-delta{font-size:12.5px;font-weight:700;color:var(--muted);margin:0 0 4px}.perf-delta.good{color:#16825d}.perf-delta.warn{color:#c2620a}'
  + '.perf-delivery{margin:14px 2px;color:var(--muted);font-size:12.5px;line-height:1.55}.perf-note{margin:14px 2px 0;font-size:14px;line-height:1.6}'
  + '.perf-chart{margin:0 0 16px;padding:16px 18px 10px}.perf-chart figcaption{font-size:11px;color:#7488a2;text-transform:uppercase;font-weight:850;letter-spacing:.11em;margin-bottom:8px}'
  + '.perf-chart svg{display:block;width:100%;height:auto}.perf-grid{stroke:var(--line);stroke-width:1}.perf-tick{fill:#8091a6;font-size:11px}.perf-bar path{fill:var(--blue)}.perf-bar:hover path{fill:var(--mid)}'
  + '.perf-table-wrap{overflow-x:auto}.perf-table{width:100%;border-collapse:collapse;font-size:13px}.perf-table th{padding:12px 14px;border-bottom:1px solid var(--line);color:#7488a2;font-size:11px;font-weight:850;letter-spacing:.06em;text-transform:uppercase;text-align:right;white-space:nowrap}'
  + '.perf-table td{padding:12px 14px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.perf-table tr:last-child td{border-bottom:0}'
  + '.perf-table th:first-child,.perf-table td:first-child{text-align:left}.perf-name{white-space:normal!important;min-width:200px;font-weight:600}.perf-table small{display:block;color:var(--muted);font-size:11px}'
  + '.perf-table td.good{color:#16825d;font-weight:700}.perf-table td.warn{color:#c2620a;font-weight:700}'
  + '@media(max-width:900px){.perf-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:520px){.perf-stats{grid-template-columns:1fr}}';
/** The id of a file on Drive from its link (videos of the report play from Drive). */
const driveFile = (url: string) => url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{20,})/)?.[1] || '';

// ------------------------------------------------------------------ Meta Ads results (the Report Center's V2 tiles)
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TYPE_LABEL: Record<string, string> = { LeadForm: 'Leads', Messages: 'Messages', Traffic: 'Link Clicks', Engagement: 'Engagement' };
/** "Sep 20 – Oct 19, 2026" (the year once when both ends share it). */
function span(a: string, b: string) {
  const [ya, ma, da] = a.split('-').map(Number), [yb, mb, db] = b.split('-').map(Number);
  return ya === yb ? `${SHORT[ma - 1]} ${da} – ${SHORT[mb - 1]} ${db}, ${yb}` : `${SHORT[ma - 1]} ${da}, ${ya} – ${SHORT[mb - 1]} ${db}, ${yb}`;
}
function perfHtml(pf: ReportData['performance'], ix: string) {
  const p = pf.data!, cur = pf.account!.currency, c = p.current, b = p.previous;
  const money = (v: number | null) => (v === null ? '—' : v.toLocaleString('en-US', { style: 'currency', currency: cur, maximumFractionDigits: cur === 'VND' ? 0 : 2 }));
  const int = (v: number | null) => (v === null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: v % 1 ? 1 : 0 }));
  const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(2)}%`);
  // Results up, cost down and spend up read as good; nothing to compare with: a new baseline.
  const delta = (now: number | null, before: number | null, upGood: boolean) => {
    if (now === null || before === null) return '';
    if (!before) return now ? '<div class="perf-delta">New baseline</div>' : '';
    const x = ((now - before) / Math.abs(before)) * 100;
    if (Math.abs(x) < 0.05) return '<div class="perf-delta">No change vs previous</div>';
    return `<div class="perf-delta ${(x > 0) === upGood ? 'good' : 'warn'}">${x > 0 ? '↑' : '↓'} ${Math.abs(x).toFixed(1)}% vs previous</div>`;
  };
  const tile = (label: string, value: string, d: string, foot: string) => `<article class="panel stat"><div class="stat-label">${label}</div><div class="stat-main">${value}</div>${d}<div class="stat-foot">${esc(foot)}</div></article>`;
  const tiles = [
    tile('Total Spend', money(c.spend), delta(c.spend, b.spend, true), `Previous: ${money(b.spend)}`),
    tile('Total Results', int(c.total), delta(c.total, b.total, true), `Primary: ${int(c.primary)}${c.comments ? ` · Meta Comments: ${int(c.comments)}` : ''} · Previous Total: ${int(b.total)}`),
    tile('Blended Cost / Total Result', money(c.costPerTotal), delta(c.costPerTotal, b.costPerTotal, false), `Previous: ${money(b.costPerTotal)}`),
    tile('CTR', pct(c.ctr), '', `${int(c.clicks)} clicks · ${int(c.impressions)} impressions${c.messages ? ` · ${int(c.messages)} messages` : ''}`),
  ].join('');
  // Daily spend: one series, columns from one baseline, each with its value as a tooltip.
  const days = p.daily, max = Math.max(...days.map((d) => d.spend), 0);
  const raw = max / 4 || 1, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) || raw;
  const W = 1000, H = 200, L = 56, T = 8, B = 24, iw = W - L - 4, ih = H - T - B, band = iw / Math.max(1, days.length), bw = Math.max(2, Math.min(24, band - 2));
  const y = (v: number) => T + ih - (v / (step * 4)) * ih, every = Math.max(1, Math.ceil(days.length / 12));
  const chart = days.length ? `<figure class="panel perf-chart"><figcaption>Daily spend</figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily spend, ${esc(span(pf.since, pf.until))}">`
    + [0, 1, 2, 3, 4].map((i) => `<line x1="${L}" x2="${W - 4}" y1="${y(step * i).toFixed(1)}" y2="${y(step * i).toFixed(1)}" class="perf-grid"/><text x="${L - 8}" y="${(y(step * i) + 4).toFixed(1)}" text-anchor="end" class="perf-tick">${esc(money(step * i).replace(/\.00$/, ''))}</text>`).join('')
    + days.map((d, i) => {
      const x = L + i * band + (band - bw) / 2, h = (d.spend / (step * 4)) * ih, r = Math.min(4, h / 2, bw / 2), base = T + ih;
      const bar = h > 0 ? `<path d="M${x.toFixed(1)},${base}V${(base - h + r).toFixed(1)}Q${x.toFixed(1)},${(base - h).toFixed(1)} ${(x + r).toFixed(1)},${(base - h).toFixed(1)}H${(x + bw - r).toFixed(1)}Q${(x + bw).toFixed(1)},${(base - h).toFixed(1)} ${(x + bw).toFixed(1)},${(base - h + r).toFixed(1)}V${base}Z"/>` : '';
      const [, m, dd] = d.date.split('-').map(Number);
      return `<g class="perf-bar"><title>${SHORT[m - 1]} ${dd}: ${esc(money(d.spend))}</title><rect x="${(L + i * band).toFixed(1)}" y="${T}" width="${band.toFixed(1)}" height="${ih}" fill="transparent"/>${bar}`
        + (i % every === 0 ? `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="perf-tick">${SHORT[m - 1]} ${dd}</text>` : '') + '</g>';
    }).join('') + '</svg></figure>' : '';
  const rowsHtml = p.campaigns.map((k) => {
    const ch = k.costPerTotal !== null && k.previousCostPerTotal ? ((k.costPerTotal - k.previousCostPerTotal) / k.previousCostPerTotal) * 100 : null;
    const change = ch === null ? (k.previousCostPerTotal === null && k.costPerTotal !== null ? 'New baseline' : '—') : `${ch > 0 ? '+' : '−'}${Math.abs(ch).toFixed(1)}%`;
    return `<tr><td class="perf-name">${esc(k.name)}</td><td>${esc(TYPE_LABEL[k.type] || k.type)}${k.kpi ? `<small>${esc(k.kpi)}</small>` : ''}</td><td>${money(k.spend)}</td><td>${int(k.primary)}</td><td>${int(k.comments)}</td><td>${int(k.total)}</td><td>${money(k.costPerTotal)}</td><td>${money(k.previousCostPerTotal)}</td>`
      + `<td class="${ch === null || Math.abs(ch) < 0.05 ? '' : ch < 0 ? 'good' : 'warn'}">${change}</td></tr>`;
  }).join('');
  return `<section class="section" id="performance">
<div class="section-heading"><div><div class="section-kicker">${esc(pf.kicker)}</div><h2>${esc(pf.title)}</h2></div><span class="section-index">${ix}</span></div>
<p class="perf-period">${esc(pf.account!.name)} · ${esc(span(pf.since, pf.until))}${p.compare.since ? ` · compared with ${esc(span(p.compare.since, p.compare.until))}` : ''}${p.lastDataDate && p.lastDataDate < pf.until ? ` · data through ${esc(span(p.lastDataDate, p.lastDataDate).replace(/ – .*?, /, ', '))}` : ''}</p>
<div class="stats perf-stats">${tiles}</div>
<p class="perf-delivery">Delivery: ${int(c.impressions)} impressions · ${int(c.clicks)} clicks · ${int(c.linkClicks)} link clicks · ${int(c.messages)} messages · ${int(c.comments)} comments. Total Results = Primary Results + Comments. Comments remain engagement actions and are not relabeled as leads/conversions.</p>
${chart}
${p.campaigns.length ? `<div class="panel perf-table-wrap"><table class="perf-table"><thead><tr><th>Campaign</th><th>Result</th><th>Spend</th><th>Primary</th><th>Comments</th><th>Total Results</th><th>Cost / Total</th><th>Previous Cost</th><th>Change</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>` : '<p class="perf-delivery">No campaign delivered in this period.</p>'}
${pf.note ? `<p class="perf-note">${rich(pf.note)}</p>` : ''}
</section>`;
}

/** The report as one HTML page; `src(file)` gives an image's address (a data: URI when exporting). */
export function renderReport(r: ReportData, src: (file: string) => string) {
  const dialogs: string[] = [];
  const dialog = (eyebrow: string, heading: string, file: string, alt: string, footer = false) => {
    const id = `shot-${dialogs.length + 1}`;
    dialogs.push(`<dialog aria-labelledby="${id}-heading" class="location-shot-dialog" id="${id}"><div class="location-shot-head"><div><div class="location-shot-eyebrow">${esc(eyebrow)}</div><h3 id="${id}-heading">${esc(heading)}</h3></div>`
      + `<button aria-label="Close screenshot" class="location-close-btn" data-close-shot="${id}" type="button">${ICON.close}</button></div>`
      + `<div class="location-shot-body"><img alt="${esc(alt)}" src="${src(file)}"/></div>`
      + (footer ? `<div class="location-shot-footer"><span>Original Meta Ads Manager screenshot</span><button class="location-footer-close" data-close-shot="${id}" type="button">Close</button></div>` : '') + '</dialog>');
    return id;
  };
  /** Buttons for the screenshots that have an image. */
  const shotButtons = (list: Shot[], eyebrow: string, icon: (s: Shot) => string) => list.filter((s) => s.image).map((s) => {
    const id = dialog(eyebrow, s.label.replace(/^View\s+/i, ''), s.image, s.label);
    return `<button aria-controls="${id}" aria-haspopup="dialog" class="location-screenshot-btn" data-open-shot="${id}" type="button">${icon(s)}<span>${esc(s.label)}</span></button>`;
  }).join('');
  const rows = (items: KV[]) => items.filter((x) => x.label || x.value).map((x) => `<div class="data-row"><dt>${esc(x.label)}</dt><dd>${esc(x.value || '—')}</dd></div>`).join('\n');

  const sections: { id: string; nav: string; html: (index: string) => string }[] = [];
  const { hero, budget, adsets, audience, creatives, copy, performance } = r;
  const client = r.client || hero.eyebrow;
  if (performance.on && performance.data && performance.account) sections.push({ id: 'performance', nav: 'Performance', html: (ix) => perfHtml(performance, ix) });
  if (budget.on) sections.push({ id: 'budget', nav: 'Budget', html: (ix) => `<section class="section" id="budget">
<div class="section-heading budget-heading"><div class="audience-heading-copy"><div class="section-kicker">${esc(budget.kicker)}</div>
<div class="audience-heading-title-row"><h2>${esc(budget.title)}</h2>${shotButtons(budget.shots, 'CAMPAIGN SETUP', () => ICON.table)}</div></div>
<span class="section-index">${ix}</span></div>
${budget.amount ? `<div class="stats"><article class="panel stat"><div class="stat-label">${esc(budget.statLabel)}</div><div class="stat-main">${esc(budget.amount)} <small>${esc(budget.currency)}</small></div><div class="stat-foot">${esc(budget.statFoot)}</div></article></div>` : ''}
<div class="detail-grid">
<article class="panel detail-panel"><h3 class="panel-title">${esc(budget.settingsTitle)}</h3><dl class="data-list">${rows(budget.settings)}</dl></article>
<article class="panel detail-panel"><h3 class="panel-title">${esc(budget.focusTitle)}</h3><dl class="data-list">${rows(budget.focus)}</dl></article>
</div></section>` });

  if (adsets.on) sections.push({ id: 'adsets', nav: 'Ad Sets', html: (ix) => {
    const form = adsets.form.on && adsets.form.steps.length ? adsets.form : null;
    const cards = adsets.sets.map((s, i) => {
      const url = link(s.url);
      const actions = (form && /form/i.test(s.type) ? '<a class="setup-link" href="#lead-form">View lead form walkthrough <span aria-hidden="true">↘</span></a>' : '')
        + s.shots.filter((x) => x.image).map((x) => `<span class="btn-wrap">${shotButtons([x], `AD SET ${two(i + 1)}`, () => ICON.chart)}</span>`).join('');
      return `<article class="panel setup-card">
<div class="setup-card-head"><div class="setup-number">${two(i + 1)}</div><div><div class="setup-eyebrow">AD SET ${two(i + 1)}</div><h3>${esc(s.name)}</h3><p>${esc(s.desc)}</p></div>${s.type ? `<span class="setup-type">${esc(s.type)}</span>` : ''}</div>
<div class="setup-details">${s.details.filter((x) => x.label || x.value).map((x) => `<div><span>${esc(x.label)}</span><strong>${esc(x.value || '—')}</strong></div>`).join('')}</div>
${url ? `<div class="dest-url"><span>Website &amp; display URL</span><a href="${esc(url)}" rel="noopener noreferrer" target="_blank">${esc(url.replace(/^https?:\/\//i, '').replace(/\/$/, ''))} <span aria-hidden="true">↗</span></a></div>` : ''}
${actions ? `<div class="setup-actions">${actions}</div>` : ''}
</article>`;
    }).join('\n');
    const steps = form ? form.steps.map((st, i) => {
      const head = `Step ${two(i + 1)} / ${two(form.steps.length)} — ${st.label}`;
      if (!st.image) return `<div class="form-step"><span class="form-step-num">${two(i + 1)}</span><span class="form-step-name">${esc(st.label)}</span></div>`;
      const id = dialog('FACEBOOK INSTANT FORM', head, st.image, `Form screen ${i + 1} of ${form.steps.length}: ${st.label}`, true);
      return `<button aria-controls="${id}" aria-haspopup="dialog" class="form-step" data-open-shot="${id}" type="button"><span class="form-step-num">${two(i + 1)}</span><span class="form-step-name">${esc(st.label)}</span><span class="form-step-open">View screenshot <span aria-hidden="true">↗</span></span></button>`;
    }).join('') : '';
    return `<section class="section" id="adsets">
<div class="section-heading"><div><div class="section-kicker">${esc(adsets.kicker)}</div><h2>${esc(adsets.title)}</h2></div><span class="section-index">${ix}</span></div>
${adsets.noteTitle || adsets.note ? `<div class="shared-note"><span class="shared-dot"></span><div><strong>${esc(adsets.noteTitle)}</strong><p>${rich(adsets.note)}</p></div></div>` : ''}
<div class="setup-compare">${cards}</div>
${form ? `<div class="form-panel panel" id="lead-form"><div class="form-panel-head"><div><div class="setup-eyebrow">${esc(form.eyebrow)}</div><h3>${esc(form.title)}</h3><p>${esc(form.desc)}</p></div><span class="form-count">${form.steps.length} STEPS</span></div>
<div class="form-steps">${steps}</div></div>` : ''}
</section>`;
  } });

  if (audience.on) sections.push({ id: 'audience', nav: 'Audience', html: (ix) => `<section class="section" id="audience">
<div class="section-heading audience-heading"><div class="audience-heading-copy"><div class="section-kicker">${esc(audience.kicker)}</div>
<div class="audience-heading-title-row"><h2>${esc(audience.title)}</h2>${shotButtons(audience.shots, 'AUDIENCE TARGETING', (s) => (/location/i.test(s.label) ? ICON.pin : ICON.people))}</div></div>
<span class="section-index">${ix}</span></div>
${audience.note ? `<div class="shared-audience-note">${rich(audience.note)}</div>` : ''}
<div class="audience-grid">${audience.fields.filter((x) => x.label || x.value).map((x) => `<article class="panel aud-item"><div class="aud-label">${esc(x.label)}</div><div class="aud-value${x.value.length > 24 ? ' smaller' : ''}">${esc(x.value || '—')}</div></article>`).join('\n')}</div>
</section>` });

  if (creatives.on) sections.push({ id: 'creatives', nav: 'Creative Previews', html: (ix) => {
    const previews = creatives.previews.filter((p) => link(p.url));
    const items = creatives.items.map((c) => {
      const url = link(c.url);
      const caps = c.captions.filter((x) => x.text.trim()).map((x) => {
        const lines = x.text.split('\n').map((l) => l.trim()).filter(Boolean);
        return `<details class="caption-item"><summary><span class="caption-item-heading"><span class="caption-item-label">${esc(x.label)}</span><span class="caption-item-title">${esc(lines[0])}</span></span><span aria-hidden="true" class="caption-item-chevron">${ICON.chevron}</span></summary>`
          + `<div class="caption-item-body"><section class="caption-box"><p class="caption-lead">${esc(lines[0])}</p>${lines.slice(1).map((l) => `<p>${rich(l)}</p>`).join('')}</section></div></details>`;
      }).join('');
      const thumb = c.thumb ? `<img alt="${esc(c.title)} video thumbnail" class="thumb-img" loading="lazy" src="${src(c.thumb)}"/>` : '<div class="thumb-empty">No thumbnail</div>';
      // A video on Drive plays here; any other link opens in a new tab.
      const vid = driveFile(url);
      const media = vid
        ? `<button aria-label="Play ${esc(c.title)}" class="video-play" data-drive-video="${esc(vid)}" type="button">${thumb}<span class="video-play-badge">${ICON.play}</span></button>`
        : url ? `<a aria-label="Open ${esc(c.title)} video preview" href="${esc(url)}" rel="noopener noreferrer" target="_blank">${thumb}</a>` : thumb;
      return `<article aria-label="${esc(c.title)} creative and captions" class="panel creative-feature"><header class="creative-feature-top"><div class="creative-feature-title"><div class="creative-type">${esc(c.type)}</div><h3>${esc(c.title)}</h3></div>`
        + (url ? `<a class="preview-link" href="${esc(url)}" rel="noopener noreferrer" target="_blank">Open Video Preview <span aria-hidden="true">↗</span></a>` : '') + '</header>'
        + `<div class="creative-feature-body"><figure class="creative-thumb">${media}<figcaption>${vid ? 'Click to play' : 'Video thumbnail'}</figcaption></figure>`
        + `<div class="captions-accordion">${caps}</div></div></article>`;
    }).join('');
    return `<section class="section" id="creatives">
<div class="section-heading"><div><div class="section-kicker">${esc(creatives.kicker)}</div><h2>${esc(creatives.title)}</h2></div><span class="section-index">${ix}</span></div>
${previews.length ? `<div aria-label="Facebook creative previews" class="facebook-preview-area"><div class="facebook-preview-head"><div><div class="eyebrow-small">FACEBOOK ADS</div><h3>Facebook Preview Links</h3></div><span class="source-tag">${previews.length} LINK${previews.length > 1 ? 'S' : ''}</span></div>
<div class="facebook-preview-grid">${previews.map((p, i) => `<a class="facebook-link-card" href="${esc(link(p.url))}" rel="noopener noreferrer" target="_blank"><span class="fb-preview-mark">${two(i + 1)}</span><span class="fb-preview-copy"><strong>${esc(p.label || `Facebook Preview ${two(i + 1)}`)}</strong><small>Open original Meta Ads preview</small></span>${ICON.out}</a>`).join('\n')}</div>
${creatives.caveat ? `<p class="source-caveat">${esc(creatives.caveat)}</p>` : ''}</div>` : ''}
<div class="creative-list">${items}</div>
</section>`;
  } });

  if (copy.on) sections.push({ id: 'ad-copy', nav: 'Ad Copy', html: (ix) => {
    const panel = (title: string, items: string[]) => `<article class="panel copy-panel"><div class="copy-title"><h3>${title}</h3><span class="copy-count">${items.length} Option${items.length === 1 ? '' : 's'}</span></div><ol class="copy-list">${items.map((x, i) => `<li><span class="item-num">${two(i + 1)}</span><span>${esc(x)}</span></li>`).join('\n')}</ol></article>`;
    return `<section class="section" id="ad-copy">
<div class="section-heading"><div><div class="section-kicker">${esc(copy.kicker)}</div><h2>${esc(copy.title)}</h2></div><span class="section-index">${ix}</span></div>
<div class="copy-grid">${panel('Headlines', copy.headlines.filter((x) => x.trim()))}${panel('Descriptions', copy.descriptions.filter((x) => x.trim()))}</div>
</section>`;
  } });

  const n = sections.length;
  const body = sections.map((s, i) => s.html(`${two(i + 1)} / ${two(n)}`)).join('\n');
  const title = `${client} | ${hero.pill ? `${hero.pill} ` : ''}${hero.title} Campaign Summary`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1" name="viewport"/>
<meta content="light" name="color-scheme"/>
<meta content="${esc(`${client} ${hero.title} campaign budget, audience targeting, video creative previews, captions, headlines and descriptions.`)}" name="description"/>
<title>${esc(title)}</title>
<style>${CSS()}${MORE_CSS}</style>
</head>
<body>
<div class="wrap">
<header aria-labelledby="report-title" class="hero">
<div class="hero-copy">
<p class="hero-eyebrow">${esc(hero.eyebrow)}</p>
<h1 id="report-title">${esc(hero.title)}</h1>
<p class="hero-sub">${esc(hero.subtitle)}</p>
<div class="hero-period"><strong>${esc(hero.year)}</strong><span aria-hidden="true" class="vertical"></span><span>${esc(hero.month)}</span></div>
${hero.pill ? `<div class="hero-pill">${esc(hero.pill)}</div>` : ''}
</div>
<div aria-label="Brand logos" class="logos">
${hero.agencyLogo ? `<div class="logo-box agency"><img alt="${esc(r.footer.brand)} logo" src="${src(hero.agencyLogo)}"/></div>` : ''}
${hero.clientLogo ? `<div class="logo-box client" style="background:${hero.clientBg}"><img alt="${esc(client)} logo" src="${src(hero.clientLogo)}"/></div>` : ''}
</div>
</header>
${n > 1 ? `<nav aria-label="Report sections" class="section-nav"><span>Sections</span>${sections.map((s) => `<a href="#${s.id}">${s.nav}</a>`).join('')}</nav>` : ''}
<main>
${body}
</main>
<footer class="footer"><strong>${esc(r.footer.brand)}</strong><span>${esc(r.footer.line)}</span></footer>
</div>
${dialogs.join('\n')}
<script>${SCRIPT}</script>
</body>
</html>
`;
}

// ------------------------------------------------------------------ videos from a Drive folder
const CAPTION_LABELS = ['Caption 1', 'Caption 2', 'Comment'];
/** "Video 01 | No Voice" → no voiceover; "… Voice" / "… VO" → with voiceover. */
const typeOf = (name: string) => (/no[\s_.-]*(voice|vo)\b|kh[oô]ng[\s_-]*(voice|vo)\b/i.test(name) ? 'Video Creative · No Voiceover' : /voice|\bvo\b/i.test(name) ? 'Video Creative · With Voiceover' : 'Video Creative');
const byName = (a: string, b: string) => a.localeCompare(b, 'vi', { numeric: true, sensitivity: 'base' });
/** `f` over `items`, `n` at a time, results in order. */
async function pool<T, R>(items: T[], n: number, f: (x: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { for (let i = next++; i < items.length; i = next++) out[i] = await f(items[i]); }));
  return out;
}
/**
 * The videos in a Drive folder and in the folders right inside it, by name: one creative each, linked to the video's
 * page on Drive, with its thumbnail. A video already in the report keeps its title, type and captions; videos added by
 * hand that are not in the folder stay after it (empty placeholders go). Returns how many videos the folder has.
 */
async function videosFrom(id: string, d: ReportData, link: string) {
  const fid = driveId(link);
  if (!fid) throw new HttpError(400, 'Đây không phải link thư mục Google Drive');
  const { account, file } = await locate(fid);
  if (file.mimeType !== G.FOLDER_MIME) throw new HttpError(400, 'Link này là một file. Hãy dán link thư mục chứa các video.');
  const subs = await G.listFolders(account, file.id).catch(() => [] as G.GFile[]);
  const sub = new Map(subs.map((x) => [x.id, x.name]));
  const vids = (await G.listMediaIn(account, [file.id, ...subs.map((x) => x.id)])).filter((f) => f.mimeType.startsWith('video/'))
    .sort((a, b) => byName(sub.get(a.parents?.[0] || '') || '', sub.get(b.parents?.[0] || '') || '') || byName(a.name, b.name));
  if (!vids.length) throw new HttpError(404, `Thư mục “${file.name}” không có video nào`);
  const old = d.creatives.items;
  const seen = new Set<string>();
  const items = await pool(vids, 4, async (v) => {
    const title = v.name.replace(/\.[a-z0-9]{2,4}$/i, '');
    const url = `https://drive.google.com/file/d/${v.id}/view`;
    const prev = old.find((c) => c.url.includes(v.id)) || old.find((c) => !c.url && c.title.trim().toLowerCase() === title.toLowerCase());
    if (prev) seen.add(old.indexOf(prev) + '');
    let thumb = prev?.thumb || '';
    if (!thumb) { try { const t = await G.thumbBuffer(account, v.id); thumb = await keep(id, t.body, t.type.split(';')[0]); } catch { /* Drive has no thumbnail yet */ } }
    return { type: prev?.type || typeOf(v.name), title: prev?.title || title, url, thumb, captions: prev?.captions?.length ? prev.captions : CAPTION_LABELS.map((label) => ({ label, text: '' })) };
  });
  const rest = old.filter((c, i) => !seen.has(i + '') && (c.url || c.captions.some((x) => x.text.trim())));
  d.creatives.items = [...items, ...rest].slice(0, 30);
  d.creatives.folder = { url: `https://drive.google.com/drive/folders/${file.id}`, name: file.name };
  return vids.length;
}

// ------------------------------------------------------------------ filled in from DMI Workspace
/** "[ADS] FORM YÊU CẦU DỰNG VIDEO | DYNAMIC M DETAIL | CERAMIC COATING" → "Ceramic Coating" (the last part, in Title Case). */
function serviceOf(sheetTitle: string) {
  const parts = String(sheetTitle || '').split('|').map((x) => x.trim()).filter(Boolean);
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  return last.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}
/** A project's title without the request form's prefix. */
const videoTitle = (t: string) => String(t).replace(/\[ADS\]\s*/i, '').replace(/FORM YÊU CẦU DỰNG VIDEO\s*\|?\s*/i, '').trim();

async function fillFrom(id: string, projectId: string | null, customerId: string | null) {
  const c = customerId ? await get<any>('SELECT * FROM customers WHERE id = ?', customerId) : null;
  const projects = customerId
    ? await all<any>('SELECT id, title, data FROM projects WHERE customer_id = ? ORDER BY created_at', customerId)
    : projectId ? await all<any>('SELECT id, title, data FROM projects WHERE id = ?', projectId) : [];
  const first = projects.map((p) => JSON.parse(p.data)).find((d) => d.sheet);
  const client = c?.name || first?.sheet?.form?.customer || 'Client';
  const d = blank(client, serviceOf(first?.sheet?.title || ''));
  // Setup values are not facts until Meta supplies them.
  d.adsets.sets = []; d.adsets.on = false; d.adsets.form.on = false;
  d.audience.fields = []; d.audience.on = false;
  d.budget.settings = []; d.budget.statFoot = ''; d.budget.currency = '';
  d.budget.statLabel = 'Ngân sách';
  const links = (() => { try { return JSON.parse(c?.links || '[]'); } catch { return []; } })();
  d.creatives.previews = links.filter((l: any) => /^https?:\/\//i.test(l.url || '')).slice(0, 20).map((l: any) => ({ label: l.label || l.url, url: l.url }));
  const deadline = first?.sheet?.form?.deadline;
  if (deadline) d.budget.focus.push({ label: 'Hạn bàn giao video', value: String(deadline) });
  if (c?.gloc) { try { const g = JSON.parse(c.gloc); if (g.id) d.creatives.folder = { url: `https://drive.google.com/drive/folders/${g.id}`, name: c.name }; } catch { /* no linked Drive folder */ } }

  // The agency's logo, and the client's from a logo outro (already cut out).
  try { d.hero.agencyLogo = await keep(id, fs.readFileSync(path.join(HERE(), '..', 'web', 'public', 'brand', 'logo.png')), 'image/png'); } catch { /* no brand file */ }
  for (const p of projects) {
    const f = path.join(DATA_DIR, 'outro', p.id, 'logo.png');
    if (fs.existsSync(f)) { d.hero.clientLogo = await keep(id, fs.readFileSync(f), 'image/png'); break; }
  }
  // The videos of the Drive folder linked on the project (or another of the customer's projects), with their links;
  // without one, one creative per project, with the thumbnail of its first clip.
  const folder = [...projects].sort((a, b) => +(b.id === projectId) - +(a.id === projectId)).map((p) => JSON.parse(p.data).drive).find((x) => x?.folder);
  if (folder && await videosFrom(id, d, folder.url).catch(() => 0)) return { data: d, title: `${client} · Meta Ads ${d.hero.month.charAt(0)}${d.hero.month.slice(1).toLowerCase()} ${d.hero.year}` };
  for (const p of projects) {
    const data = JSON.parse(p.data);
    const shot = (data.storyboard?.scenes || []).flatMap((s: any) => s.shots || []).find((x: any) => x.media?.provider === 'drive');
    let thumb = '';
    if (shot) {
      const q = new URLSearchParams(String(shot.media.url).split('?')[1] || '');
      try { const t = await G.thumbBuffer(q.get('a') || '', shot.media.assetId); thumb = await keep(id, t.body, t.type.split(';')[0]); } catch { /* no thumbnail on Drive */ }
    }
    d.creatives.items.push({ type: 'Video Creative', title: videoTitle(p.title), url: data.drive && !data.drive.folder ? data.drive.url : '', thumb, captions: CAPTION_LABELS.map((label) => ({ label, text: '' })) });
  }
  return { data: d, title: `${client} · Meta Ads ${d.hero.month.charAt(0)}${d.hero.month.slice(1).toLowerCase()} ${d.hero.year}` };
}

/** Fill empty/template fields only. Client edits take precedence over fetched data. */
function fillMetaInputs(d: ReportData, snap: Awaited<ReturnType<typeof metaSnapshot>>, initial = false) {
  const base = blank(d.client, d.hero.pill), same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const pf = d.performance;
  if (!d.client || d.client === 'Client') { d.client = snap.account.name; if (!d.hero.eyebrow || d.hero.eyebrow === 'CLIENT') d.hero.eyebrow = d.client.toUpperCase(); }
  if (initial || !d.hero.year) d.hero.year = pf.until.slice(0, 4);
  if (initial || !d.hero.month) d.hero.month = MONTHS[Number(pf.until.slice(5, 7)) - 1] || '';
  if (!d.hero.pill) d.hero.pill = snap.data.campaigns.map((c) => c.name).join(' · ').slice(0, 300);
  if (!d.hero.subtitle || d.hero.subtitle === base.hero.subtitle) d.hero.subtitle = `Meta Ads · ${pf.since} – ${pf.until}`;
  if (!d.footer.line || /^Client(?: ·| Meta)/.test(d.footer.line)) d.footer.line = `${d.client} · Meta Ads`;
  if (!d.budget.amount) {
    d.budget.amount = String(snap.data.current.spend);
    d.budget.currency = snap.account.currency;
    d.budget.statLabel = 'Chi tiêu thực tế trong kỳ';
    d.budget.statFoot = `${pf.since} – ${pf.until}`;
    if (d.budget.title === base.budget.title) d.budget.title = 'Chi tiêu quảng cáo';
  }
  if (same(d.budget.settings, base.budget.settings) || !d.budget.settings.length) d.budget.settings = [
    { label: 'Tài khoản quảng cáo', value: snap.account.name }, { label: 'Đơn vị tiền tệ', value: snap.account.currency },
    { label: 'Kỳ báo cáo', value: `${pf.since} – ${pf.until}` }, { label: 'Chiến dịch', value: snap.data.campaigns.map((c) => c.name).join(' · ').slice(0, 1000) },
  ];
  for (const row of d.budget.focus) {
    if (row.label === 'Business' && (!row.value || row.value === 'Client')) row.value = d.client;
  }
  const setup = snap.setup;
  if (!d.adsets.sets.length || same(d.adsets.sets, base.adsets.sets)) {
    d.adsets.sets = (setup.adsets || []).slice(0, 12).map((a: any) => ({ name: str(a.name, 200), desc: '', type: str(a.destination_type, 60), url: '', shots: [], details: [
      { label: 'Performance goal', value: str(a.optimization_goal, 200) }, { label: 'Billing event', value: str(a.billing_event, 200) },
      { label: 'Start', value: str(a.start_time, 100) }, { label: 'End', value: str(a.end_time, 100) },
    ].filter((x) => x.value) }));
    d.adsets.on = !!d.adsets.sets.length;
    if (d.adsets.noteTitle === base.adsets.noteTitle) d.adsets.noteTitle = 'Cấu hình hiện tại trên Meta';
    if (d.adsets.note === base.adsets.note) d.adsets.note = 'Cấu hình lấy tại thời điểm tạo/cập nhật báo cáo; có thể khác cấu hình trong kỳ chạy trước.';
    if (same(d.adsets.form, base.adsets.form)) d.adsets.form.on = false;
  }
  if (!d.audience.fields.length || same(d.audience.fields, base.audience.fields)) {
    d.audience.fields = (setup.adsets || []).slice(0, 12).flatMap((a: any) => {
      const t = a.targeting || {}, geo = t.geo_locations || {};
      const locations = [...(geo.countries || []), ...(geo.regions || []).map((x: any) => x.name || x.key), ...(geo.cities || []).map((x: any) => [x.name || x.key, x.radius && `${x.radius} ${x.distance_unit || ''}`].filter(Boolean).join(' · ')), ...(geo.custom_locations || []).map((x: any) => x.address || `${x.latitude}, ${x.longitude}`)];
      return [
        { label: `${a.name} · Vị trí`, value: locations.join(', ') },
        { label: `${a.name} · Độ tuổi`, value: t.age_min || t.age_max ? `${t.age_min || '?'}–${t.age_max || '?'}` : '' },
        { label: `${a.name} · Giới tính`, value: Array.isArray(t.genders) ? t.genders.map((g: number) => g === 1 ? 'Nam' : g === 2 ? 'Nữ' : String(g)).join(', ') : '' },
        { label: `${a.name} · Sở thích`, value: (t.flexible_spec || []).flatMap((x: any) => (x.interests || []).map((i: any) => i.name)).join(', ') },
      ].filter((x) => x.value).map((x) => ({ label: str(x.label, 200), value: str(x.value, 1000) }));
    }).slice(0, 40);
    d.audience.on = !!d.audience.fields.length;
  }
  const headlines: string[] = [], descriptions: string[] = [];
  for (const ad of (setup.ads || []).slice(0, 30)) {
    const c = ad.creative || {}, story = c.object_story_spec || {}, content = story.link_data || story.video_data || story.photo_data || {}, assets = c.asset_feed_spec || {};
    const head = [c.title, content.name, content.title, ...(assets.titles || []).map((x: any) => x.text)].filter(Boolean).map(String);
    const body = [c.body, content.message, ...(assets.bodies || []).map((x: any) => x.text)].filter(Boolean).map(String);
    headlines.push(...head); descriptions.push(...[content.description, ...(assets.descriptions || []).map((x: any) => x.text)].filter(Boolean).map(String));
    const url = content.link || content.call_to_action?.value?.link || c.object_url || assets.link_urls?.[0]?.website_url || '';
    const set = d.adsets.sets.find((a) => a.name === setup.adsets?.find((a: any) => a.id === ad.adset_id)?.name);
    if (set && !set.url) set.url = str(url, 500);
    if (!d.creatives.items.some((i) => i.title === ad.name)) d.creatives.items.push({ type: 'Meta Ad', title: str(ad.name, 200), url: str(url, 500), thumb: '', captions: body.slice(0, 10).map((text) => ({ label: 'Primary text', text: str(text, 6000) })) });
  }
  if (!d.copy.headlines.length) d.copy.headlines = [...new Set(headlines)].slice(0, 30).map((x) => str(x, 400));
  if (!d.copy.descriptions.length) d.copy.descriptions = [...new Set(descriptions)].slice(0, 30).map((x) => str(x, 600));
  d.creatives.items = d.creatives.items.slice(0, 30);
}

// ------------------------------------------------------------------ routes
const mustReport = async (id: string) => {
  const r = await get<any>('SELECT * FROM reports WHERE id = ?', id);
  if (!r) throw new HttpError(404, 'Không tìm thấy báo cáo');
  return r;
};
const out = (r: any, full = true) => ({ id: r.id, title: r.title, customerId: r.customer_id, projectId: r.project_id, createdAt: r.created_at, updatedAt: r.updated_at, ...(full ? { data: clean(JSON.parse(r.data)) } : {}) });
const slug = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'report';

/** A Drive video as the report's video picker shows it. */
const videoOut=(reportId:string,account:string,file:G.GFile)=>({id:file.id,account,name:file.name,url:`https://drive.google.com/file/d/${file.id}/view`,seconds:file.videoMediaMetadata?.durationMillis?Number(file.videoMediaMetadata.durationMillis)/1000:null,modifiedAt:file.modifiedTime||'',thumb:`/api/reports/${reportId}/video-thumbnail/${file.id}?account=${encodeURIComponent(account)}`});
export function registerReports(api: Router) {
  // Report customer choices come only from saved records, without scanning Drive.
  api.get('/api/reports/customers', async (req, res) => {
    const user=(await currentUser(req))!;json(res,200,await all(`SELECT c.id,c.name FROM customers c WHERE ${customerAccessSql()} ORDER BY c.name COLLATE NOCASE`,user.id,user.id,user.id));
  });
  // A customer's reports (or a project's, when it has no customer).
  api.get('/api/reports', async (req, res) => {
    const c = req.query.get('customer'), p = req.query.get('project');
    const sql = 'SELECT r.*, c.name customer_name FROM reports r LEFT JOIN customers c ON c.id = r.customer_id';
    const rows = c ? await all<any>(`${sql} WHERE r.customer_id = ? ORDER BY r.updated_at DESC`, c)
      : p ? await all<any>(`${sql} WHERE r.project_id = ? ORDER BY r.updated_at DESC`, p)
      : await all<any>(`${sql} ORDER BY r.updated_at DESC`);
    const levels=await customerLevels((await currentUser(req))!.id);
    json(res, 200, rows.filter(r=>!r.customer_id||levels.has(r.customer_id)).map((r) => {
      const d = clean(JSON.parse(r.data)), pf = d.performance;
      return { ...out(r, false), customerName: r.customer_name || null, client: d.client, meta: pf.account && pf.data ? { account: pf.account.name, since: pf.since, until: pf.until } : null };
    }));
  });
  // A new report filled in from the customer (all its projects) or from one project.
  api.post('/api/reports', async (req, res) => {
    const b = await readJson(req);
    let snapshot: Awaited<ReturnType<typeof metaSnapshot>> | null = null;
    let meta: (Omit<ReportData['performance'], 'on' | 'kicker' | 'title' | 'note' | 'account'> & { account: NonNullable<ReportData['performance']['account']> }) | null = null;
    if (b.meta) {
      const u = (await currentUser(req))!;
      if (u.role !== 'admin' && !(await pagesOf(u)).includes('ads')) throw new HttpError(403, 'Bạn chưa được cấp quyền xem số liệu Meta Ads');
      const since = DATE(b.meta.since), until = DATE(b.meta.until);
      if (!since || !until || since > until) throw new HttpError(400, 'Hãy chọn khoảng ngày hợp lệ');
      const snap = await metaSnapshot(String(b.meta.account || ''), since, until);
      snapshot = snap;
      meta = { account: snap.account, since, until, data: perf(snap.data), fetchedAt: now() };
    }
    const p = b.projectId ? await get<any>('SELECT id, customer_id FROM projects WHERE id = ?', String(b.projectId)) : null;
    const customer = b.customerId ? await get<any>('SELECT id FROM customers WHERE id = ?', String(b.customerId)) : null;
    if (b.customerId && !customer) throw new HttpError(404, 'Khách hàng không còn trong database. Hãy chọn lại.');
    const customerId = customer?.id || p?.customer_id || null;
    if(customerId)await requireCustomer((await currentUser(req))!.id,customerId,'normal');
    const id = uid('r_');
    const filled = await fillFrom(id, p?.id || null, customerId);
    const data = filled.data;
    const title = meta ? `${meta.account.name} · Meta Ads ${meta.since} – ${meta.until}` : filled.title;
    if (meta) data.performance = { ...data.performance, ...meta, on: true };
    if (snapshot) fillMetaInputs(data, snapshot, true);
    await run('INSERT INTO reports(id, customer_id, project_id, title, data, created_at, updated_at) VALUES(?,?,?,?,?,?,?)', id, customerId, p?.id || null, title, JSON.stringify(data), now(), now());
    json(res, 201, { ...out(await mustReport(id)), autofillWarnings: snapshot?.warnings || [] });
  });
  api.get('/api/reports/:id', async (req, res) => json(res, 200, out(await mustReport(req.params.id))));
  api.put('/api/reports/:id', async (req, res) => {
    const r = await mustReport(req.params.id);
    const b = await readJson(req);
    await run('UPDATE reports SET title=?, data=?, updated_at=? WHERE id=?', str(b.title ?? r.title, 200) || r.title, b.data !== undefined ? JSON.stringify(clean(b.data)) : r.data, now(), r.id);
    json(res, 200, out(await mustReport(r.id)));
  });
  api.post('/api/reports/:id/autofill', async (req, res) => {
    const r = await mustReport(req.params.id), d = clean(JSON.parse(r.data));
    const source = (await fillFrom(r.id, r.project_id, r.customer_id)).data;
    if (!d.client || d.client === 'Client') d.client = source.client;
    if (!d.hero.eyebrow || d.hero.eyebrow === 'CLIENT') d.hero.eyebrow = d.client.toUpperCase();
    for (const k of ['pill', 'agencyLogo', 'clientLogo'] as const) if (!d.hero[k]) d.hero[k] = source.hero[k];
    for (const x of d.budget.focus) if (!x.value || (x.label === 'Business' && x.value === 'Client')) x.value = source.budget.focus.find((v) => v.label === x.label)?.value || '';
    if (!d.creatives.folder) d.creatives.folder = source.creatives.folder;
    if (!d.creatives.previews.length) d.creatives.previews = source.creatives.previews;
    if (!d.creatives.items.length) d.creatives.items = source.creatives.items;
    const warnings: string[] = [];
    const u = (await currentUser(req))!;
    if (d.performance.account && d.performance.since && d.performance.until && (u.role === 'admin' || (await pagesOf(u)).includes('ads'))) {
      const snap = await metaSnapshot(d.performance.account.id, d.performance.since, d.performance.until);
      d.performance = { ...d.performance, data: perf(snap.data), account: snap.account, fetchedAt: now() };
      fillMetaInputs(d, snap); warnings.push(...snap.warnings);
    }
    await run('UPDATE reports SET data=?, updated_at=? WHERE id=?', JSON.stringify(d), now(), r.id);
    json(res, 200, { ...out(await mustReport(r.id)), autofillWarnings: warnings });
  });
  api.delete('/api/reports/:id', async (req, res) => {
    await run('DELETE FROM reports WHERE id = ?', req.params.id);
    await run('DELETE FROM report_images WHERE report_id=?',req.params.id);
    if(!CLOUD_STORAGE_ONLY) fs.rmSync(path.join(DIR, path.basename(req.params.id)), { recursive: true, force: true });
    json(res, 200, { ok: true });
  });
  // Take the videos of a Drive folder into the report: each one's link and thumbnail (captions written so far are kept).
  api.post('/api/reports/:id/videos', async (req, res) => {
    const r = await mustReport(req.params.id);
    const d = clean(JSON.parse(r.data));
    const n = await videosFrom(r.id, d, String((await readJson(req)).link || ''));
    await run('UPDATE reports SET data=?, updated_at=? WHERE id=?', JSON.stringify(d), now(), r.id);
    json(res, 200, { ...out(await mustReport(r.id)), videos: n });
  });
  // Meta Ads results for the report: the account's numbers over [since, until] are taken now and kept in the report
  // (the file shows them as they were); for those who may see Meta Ads numbers.
  api.post('/api/reports/:id/meta', async (req, res) => {
    const u = (await currentUser(req))!;
    if (u.role !== 'admin' && !(await pagesOf(u)).includes('ads')) throw new HttpError(403, 'Bạn chưa được cấp quyền xem số liệu Meta Ads');
    const r = await mustReport(req.params.id), b = await readJson(req);
    const since = DATE(b.since), until = DATE(b.until);
    if (!since || !until) throw new HttpError(400, 'Hãy chọn khoảng ngày');
    const snap = await metaSnapshot(String(b.account || ''), since, until);
    const d = clean(JSON.parse(r.data));
    d.performance = { ...d.performance, on: true, account: snap.account, since, until, data: perf(snap.data), fetchedAt: now() };
    fillMetaInputs(d, snap);
    await run('UPDATE reports SET data=?, updated_at=? WHERE id=?', JSON.stringify(d), now(), r.id);
    json(res, 200, { ...out(await mustReport(r.id)), autofillWarnings: snap.warnings });
  });
  api.get('/api/reports/:id/video-library',async(req,res)=>{
    await mustReport(req.params.id);
    const query=String(req.query.get('q')||'').trim().slice(0,150), folder=String(req.query.get('folder')||'').trim();
    const accounts=await G.publicAccounts();if(!accounts.length)throw new HttpError(400,'Chưa kết nối tài khoản Google Drive. Kết nối trong Quản trị trước khi tìm video.');
    let found:{account:string;file:G.GFile}[]=[];const warnings:string[]=[];
    if(folder){
      const fid=driveId(folder);if(!fid)throw new HttpError(400,'Link thư mục Drive không hợp lệ');
      const located=await locate(fid);if(located.file.mimeType!==G.FOLDER_MIME)throw new HttpError(400,'Hãy chọn một thư mục Drive');
      const subs=await G.listFolders(located.account,fid);
      found=(await G.listMediaIn(located.account,[fid,...subs.slice(0,100).map(f=>f.id)])).filter(f=>f.mimeType.startsWith('video/')&&(!query||f.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))).map(file=>({account:located.account,file}));
    }else{
      const batches=await pool(accounts,2,async(a)=>{try{return(await G.searchVideos(a.email,query)).map(file=>({account:a.email,file}));}catch{warnings.push(`Không đọc được video từ ${a.email}`);return [];}});
      found=batches.flat();if(warnings.length===accounts.length)throw new HttpError(502,'Không đọc được Drive. Hãy kết nối lại tài khoản Google.');
    }
    const seen=new Set<string>();
    json(res,200,{videos:found.filter(({file})=>{if(seen.has(file.id))return false;seen.add(file.id);return true;}).slice(0,150).map(({account,file})=>videoOut(req.params.id,account,file)),warnings});
  });
  // The video picker browses Drive one folder at a time: the folder's sub-folders and the videos directly in it (nothing
  // deeper, nothing before the picker opens). Without a folder: the report's video folder when it has one, else the first
  // account's My Drive; `places=1` adds the connected accounts' drives for the picker's side list.
  api.get('/api/reports/:id/drive-browse',async(req,res)=>{
    await mustReport(req.params.id);
    const accounts=await G.publicAccounts();if(!accounts.length)throw new HttpError(400,'Chưa kết nối tài khoản Google Drive. Kết nối trong Quản trị trước khi chọn video.');
    const q=req.query;let account=String(q.get('account')||''),id=String(q.get('id')||'');
    if(!id&&q.get('folder')){const fid=driveId(String(q.get('folder')));if(fid)try{const l=await locate(fid);if(l.file.mimeType===G.FOLDER_MIME){account=l.account;id=l.file.id;}}catch{/* not reachable: start at My Drive */}}
    if(!id){account=accounts[0].email;id='root';}
    if(!accounts.some(a=>a.email===account))throw new HttpError(400,'Tài khoản Google này chưa được kết nối');
    const places=q.get('places')==='1'?(await pool(accounts,2,async(a)=>[{account:a.email,id:'root',label:'My Drive'},...(await G.sharedDrives(a.email).catch(()=>[])).map(d=>({account:a.email,id:d.id,label:d.name}))])).flat():undefined;
    const chain=await G.crumbs(account,id),here=chain[chain.length-1];
    const [dirs,media]=await Promise.all([G.listFoldersDeep(account,here.id),G.listMediaIn(account,[here.id])]);
    json(res,200,{places,account,id:here.id,crumbs:chain,dirs:dirs.map(d=>({id:d.id,name:d.name})).sort((a,b)=>a.name.localeCompare(b.name,'vi',{numeric:true})),
      videos:media.filter(f=>f.mimeType.startsWith('video/')).sort((a,b)=>String(b.modifiedTime||'').localeCompare(String(a.modifiedTime||''))).map(f=>videoOut(req.params.id,account,f))});
  });
  api.get('/api/reports/:id/video-thumbnail/:file',async(req,res)=>{
    await mustReport(req.params.id);const account=String(req.query.get('account')||'');
    if(!(await G.publicAccounts()).some(a=>a.email===account))throw new HttpError(404,'Không có tài khoản Drive');
    if(!/^[a-zA-Z0-9_-]{5,200}$/.test(req.params.file))throw new HttpError(400,'Video không hợp lệ');
    const thumb=await G.thumbBuffer(account,req.params.file);res.writeHead(200,{'content-type':thumb.type,'cache-control':'private,max-age=300'});res.end(thumb.body);
  });
  api.post('/api/reports/:id/link-videos',async(req,res)=>{
    const r=await mustReport(req.params.id),b=await readJson(req);
    if(!Array.isArray(b.videos)||!b.videos.length||b.videos.length>30)throw new HttpError(400,'Chọn từ 1 đến 30 video');
    const accounts=new Set((await G.publicAccounts()).map(a=>a.email));
    const picks=b.videos as {id:string;account:string}[];
    if(picks.some(v=>!v||!accounts.has(v.account)||!/^[-_a-zA-Z0-9]{5,200}$/.test(v.id)))throw new HttpError(400,'Video hoặc tài khoản Drive không hợp lệ');
    const files=await pool(picks,3,async(v)=>{const file=await G.meta(v.account,v.id,'id,name,mimeType');if(!file.mimeType.startsWith('video/'))throw new HttpError(400,`${file.name} không phải video`);return {...v,file};});
    const d=clean(JSON.parse(r.data));let added=0;
    const targetIndex=typeof b.targetIndex==='number'&&Number.isInteger(b.targetIndex)?b.targetIndex:null;
    if(targetIndex!==null){
      if(targetIndex<0||targetIndex>=d.creatives.items.length)throw new HttpError(400,'Mục video cần liên kết không hợp lệ');
      const v=files[0],cur=d.creatives.items[targetIndex],cleanTitle=v.file.name.replace(/\.[a-z0-9]{2,4}$/i,'');
      let thumb=cur.thumb;try{const t=await G.thumbBuffer(v.account,v.id);thumb=await keep(r.id,t.body,t.type.split(';')[0]);}catch{/* Keep current or empty thumbnail. */}
      d.creatives.items[targetIndex]={...cur,title:!cur.title||/^Video \d+$/i.test(cur.title.trim())?cleanTitle:cur.title,type:!cur.type||cur.type==='Video Creative'||cur.type==='Meta Ad'?typeOf(v.file.name):cur.type,url:`https://drive.google.com/file/d/${v.id}/view`,thumb};
      added=1;
    }else{
      const existing=new Set(d.creatives.items.map(c=>driveFile(c.url)).filter(Boolean));
      const unique=files.filter(v=>{if(existing.has(v.id))return false;existing.add(v.id);return true;});
      if(d.creatives.items.length+unique.length>30)throw new HttpError(400,'Báo cáo tối đa 30 video. Bỏ bớt video trước khi thêm.');
      for(const v of unique){let thumb='';try{const t=await G.thumbBuffer(v.account,v.id);thumb=await keep(r.id,t.body,t.type.split(';')[0]);}catch{/* Video link still works without a thumbnail. */}
        d.creatives.items.push({title:v.file.name.replace(/\.[a-z0-9]{2,4}$/i,''),type:typeOf(v.file.name),url:`https://drive.google.com/file/d/${v.id}/view`,thumb,captions:CAPTION_LABELS.map(label=>({label,text:''}))});added++;
      }
    }
    d.creatives.on=true;await run('UPDATE reports SET data=?,updated_at=? WHERE id=?',JSON.stringify(d),now(),r.id);
    json(res,200,{...out(await mustReport(r.id)),added});
  });
  // The report's videos play from Drive, which shows them to clients only once anyone with the link may view them.
  api.post('/api/reports/:id/share-videos', async (req, res) => {
    const d = clean(JSON.parse((await mustReport(req.params.id)).data));
    const ids = [...new Set(d.creatives.on ? d.creatives.items.map((c) => driveFile(link(c.url))).filter(Boolean) : [])];
    let shared = 0;
    const failed: string[] = [];
    await pool(ids, 4, async (fid) => {
      try { const { account } = await locate(fid); await G.shareAnyone(account, fid); shared++; } catch { failed.push(d.creatives.items.find((c) => c.url.includes(fid))?.title || fid); }
    });
    json(res, 200, { shared, failed });
  });
  // An image for the report (the request body): logo, screenshot or thumbnail.
  api.post('/api/reports/:id/images', async (req, res) => {
    const r = await mustReport(req.params.id);
    const buf = await readBody(req, 20 * 1024 * 1024);
    if (!buf.length) throw new HttpError(400, 'File rỗng');
    const file = await keep(r.id, buf, String(req.headers['content-type'] || '').split(';')[0]);
    json(res, 201, { file, url: `/api/reports/${r.id}/images/${file}` });
  });
  api.get('/api/reports/:id/images/:file', async (req, res) => {
    if(CLOUD_STORAGE_ONLY){
      const img=await get<any>('SELECT mime,data FROM report_images WHERE report_id=? AND file=?',req.params.id,req.params.file);
      if(!img)throw new HttpError(404,'Không có ảnh');
      res.writeHead(200,{'content-type':img.mime,'cache-control':'private, max-age=31536000'});res.end(Buffer.from(img.data,'base64'));return;
    }

    if (!IMG.test(req.params.file) || !sendFile(req, res, path.join(DIR, path.basename(req.params.id)), req.params.file, { cache: 'private, max-age=31536000' })) throw new HttpError(404, 'Không có ảnh');
  });
  // The page itself: images by address for the preview, inside the file (one self-contained .html) with ?download=1.
  api.get('/api/reports/:id/html', async (req, res) => {
    const r = await mustReport(req.params.id);
    const download = req.query.get('download') === '1';
    const images = CLOUD_STORAGE_ONLY && download ? new Map((await all<any>('SELECT file,mime,data FROM report_images WHERE report_id=?',r.id)).map(x=>[x.file,`data:${x.mime};base64,${x.data}`])) : null;
    const html = renderReport(clean(JSON.parse(r.data)), download ? (f) => images ? images.get(f) || '' : dataUri(r.id, f) : (f) => `/api/reports/${r.id}/images/${f}`);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      ...(download ? { 'content-disposition': `attachment; filename="${slug(r.title)}.html"` } : {}) });
    res.end(html);
  });
}
