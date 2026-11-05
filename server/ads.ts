// Báo cáo Ads: numbers pulled straight from Meta Ads through the Marketing API (Insights), with an access token an
// admin pastes once (a Business Manager system user's token with ads_read). The fields and formulas follow the
// agency's reporting sheets (PAID_ADS_MASTER_V2 / REPORT_CENTER_V2, used only as the model): spend, impressions, reach,
// clicks, link clicks, leads, messages and comments per campaign and day; CTR, CPC, CPM, CPL, CPMe (per message), CPLC
// (per link click) and frequency recomputed from totals, blank when the denominator is 0; a campaign's primary result
// follows its conversion type (lead form → leads, messages → messages, traffic → link clicks, engagement → none) and
// total results = primary results + comments. Each period is compared with the one just before it, of the same length.
import { Router, HttpError, json, readJson } from './http';
import { getSetting, setSetting } from './db';
import { currentUser } from './auth';
import { metaRow, conversionOf, totals, results, previousRange, type Totals } from './meta';

// ------------------------------------------------------------------ settings
export interface AdsConfig { metaToken: string; metaVersion: string }
const DEFAULT_VERSION = 'v26.0';
export async function config(): Promise<AdsConfig> {
  const c = await getSetting<Partial<AdsConfig> | null>('ads_config', null);
  return { metaToken: c?.metaToken || '', metaVersion: c?.metaVersion || DEFAULT_VERSION };
}
const masked = (t: string) => (t ? `${t.slice(0, 6)}…${t.slice(-4)}` : '');

// ------------------------------------------------------------------ Graph API
const GRAPH = () => (process.env.META_GRAPH_URL || 'https://graph.facebook.com').replace(/\/$/, '');
/** Meta's error, said plainly (an expired or wrong token is the usual one). */
function metaError(status: number, e: any) {
  const code = Number(e?.code), sub = Number(e?.error_subcode);
  if (code === 190) return new HttpError(400, 'Token Meta không hợp lệ hoặc đã hết hạn. Quản trị viên hãy dán token mới trong tab Cài đặt.');
  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80004) return new HttpError(429, 'Meta đang giới hạn số lần gọi cho tài khoản này. Thử lại sau vài phút.');
  if (code === 10 || code === 200 || code === 294) return new HttpError(403, `Token không có quyền đọc tài khoản quảng cáo này (cần quyền ads_read). ${e?.message || ''}`.trim());
  if (code === 100 && /version/i.test(e?.message || '')) return new HttpError(400, `Phiên bản Graph API không dùng được: ${e.message}`);
  return new HttpError(status >= 500 ? 502 : 400, `Meta: ${e?.error_user_msg || e?.message || `lỗi ${status}`}${sub ? ` (${sub})` : ''}`);
}
async function graphFetch(url: string) {
  let r: Response;
  try { r = await fetch(url, { signal: AbortSignal.timeout(60000) }); } catch { throw new HttpError(502, 'Không kết nối được tới Meta. Thử lại sau.'); }
  const j: any = await r.json().catch(() => null);
  if (!r.ok || j?.error) throw metaError(r.status, j?.error);
  return j;
}
/** One Graph call, or every page of a list (at most `pages` pages). */
async function graph(cfg: AdsConfig, path: string, params: Record<string, string> = {}, pages = 1) {
  if (!cfg.metaToken) throw new HttpError(400, 'Chưa kết nối Meta Ads. Quản trị viên hãy dán access token trong tab Cài đặt của trang Báo cáo Ads.');
  const u = new URL(`${GRAPH()}/${cfg.metaVersion}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('access_token', cfg.metaToken);
  const first = await graphFetch(u.toString());
  if (pages <= 1 || !Array.isArray(first.data)) return first;
  const data = [...first.data];
  let next: string | undefined = first.paging?.next;
  for (let n = 1; next && n < pages; n++) { const j = await graphFetch(next); data.push(...(j.data || [])); next = j.paging?.next; }
  return { data };
}

const DAY = 864e5;
const dayOf = (s: string) => Date.parse(`${s}T00:00:00Z`);
function checkRange(since: string, until: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until) || isNaN(dayOf(since)) || isNaN(dayOf(until))) throw new HttpError(400, 'Ngày không hợp lệ (cần YYYY-MM-DD)');
  if (since > until) throw new HttpError(400, 'Ngày bắt đầu phải trước ngày kết thúc');
  if (dayOf(until) - dayOf(since) > 366 * DAY) throw new HttpError(400, 'Mỗi lần xem tối đa một năm');
}

// ------------------------------------------------------------------ reading Meta (kept a few minutes)
const FIELDS = 'campaign_id,campaign_name,objective,spend,impressions,reach,clicks,inline_link_clicks,actions';
const cache = new Map<string, { at: number; data: any }>();
async function cached<T>(key: string, fresh: boolean, ttl: number, f: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < ttl) return hit.data;
  const data = await f();
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return data;
}
const STATUS: Record<number, string> = { 1: 'Đang hoạt động', 2: 'Bị vô hiệu hoá', 3: 'Chưa thanh toán', 7: 'Đang xét duyệt', 8: 'Chờ thanh toán', 9: 'Trong thời gian ân hạn', 100: 'Chờ đóng', 101: 'Đã đóng', 201: 'Đang hoạt động', 202: 'Đã đóng' };
export async function accounts(cfg: AdsConfig, fresh: boolean) {
  return cached(`accounts|${cfg.metaToken}`, fresh, 10 * 60e3, async () => {
    // Business metadata requires business_management; reporting only needs the ad account's own fields.
    const j = await graph(cfg, 'me/adaccounts', { fields: 'account_id,name,currency,timezone_name,account_status', limit: '200' }, 10);
    return (j.data as any[]).map((a) => ({
      id: String(a.id), accountId: String(a.account_id), name: String(a.name || a.account_id), currency: String(a.currency || ''), timezone: String(a.timezone_name || ''),
      status: STATUS[Number(a.account_status)] || String(a.account_status ?? ''), active: [1, 9, 201].includes(Number(a.account_status)), business: '',
    })).sort((a, b) => +b.active - +a.active || a.name.localeCompare(b.name));
  });
}
const insights = (cfg: AdsConfig, act: string, level: 'account' | 'campaign', since: string, until: string, daily: boolean, campaignIds: string[] = []) =>
  graph(cfg, `${act}/insights`, {
    level, fields: level === 'account' ? FIELDS.replace('campaign_id,campaign_name,objective,', '') : FIELDS,
    time_range: JSON.stringify({ since, until }), ...(campaignIds.length ? { filtering: JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: campaignIds }]) } : {}), ...(daily ? { time_increment: '1' } : {}), limit: '500',
  }, 40).then((j) => (j.data as any[]).map(metaRow));

/** An account's period: totals against the period before, each day, and each campaign with its results. */
export async function accountReport(cfg: AdsConfig, act: string, since: string, until: string, fresh = false, campaignIds: string[] = []) {
  checkRange(since, until);
  const prev = previousRange(since, until);
  return cached(`report|${cfg.metaToken}|${act}|${since}|${until}|${[...campaignIds].sort().join(',')}`, fresh, 5 * 60e3, async () => {
    const [cur, before, days, camps, campsBefore] = await Promise.all([
      insights(cfg, act, 'account', since, until, false, campaignIds), insights(cfg, act, 'account', prev.since, prev.until, false, campaignIds),
      insights(cfg, act, 'account', since, until, true, campaignIds), insights(cfg, act, 'campaign', since, until, false, campaignIds), insights(cfg, act, 'campaign', prev.since, prev.until, false, campaignIds),
    ]);
    const current = totals(cur, cur[0]?.reach), previous = totals(before, before[0]?.reach);
    const campaigns = camps.map((c) => {
      const t = totals([c], c.reach), type = conversionOf(c), p = campsBefore.find((x) => x.campaignId === c.campaignId);
      const pr = p ? results(totals([p], p.reach), type) : null;
      return { id: c.campaignId, name: c.campaign, objective: c.objective, ...t, results: results(t, type), previousSpend: p?.spend ?? null, previousCostPerTotal: pr?.costPerTotal ?? null };
    }).sort((a, b) => b.spend - a.spend);
    // The account's results: each campaign's primary results by its own type (never leads + messages for one campaign), plus comments.
    const sumResults = (list: { results: { primary: number | null } }[], t: Totals) => {
      const primary = list.reduce((n, c) => n + (c.results.primary || 0), 0), total = primary + t.comments;
      return { primary, total, costPerTotal: total ? t.spend / total : null };
    };
    const prevCampaigns = campsBefore.map((c) => ({ results: results(totals([c], c.reach), conversionOf(c)) }));
    return {
      range: { since, until }, compare: prev,
      current: { ...current, ...sumResults(campaigns, current) }, previous: { ...previous, ...sumResults(prevCampaigns, previous) },
      daily: days.map((d) => ({ date: d.date, spend: d.spend, leads: d.leads, messages: d.messages, linkClicks: d.linkClicks, impressions: d.impressions, clicks: d.clicks })),
      campaigns, lastDataDate: days.filter((d) => d.spend || d.impressions).map((d) => d.date).sort().pop() || null,
    };
  });
}

// ------------------------------------------------------------------ routes
export function registerAds(api: Router) {
  // Every ad account the token can read.
  api.get('/api/ads/meta/accounts', async (req, res) => json(res, 200, await accounts(await config(), req.query.get('fresh') === '1')));
  api.get('/api/ads/meta/report', async (req, res) => {
    const act = String(req.query.get('account') || '');
    if (!/^act_\d{5,25}$/.test(act)) throw new HttpError(400, 'Tài khoản quảng cáo không hợp lệ');
    json(res, 200, await accountReport(await config(), act, String(req.query.get('since') || ''), String(req.query.get('until') || ''), req.query.get('fresh') === '1'));
  });

  // Settings (company admins: changes go through the admin-only /api/settings/ rule; reading is checked here).
  const mustAdmin = async (req: any) => { if ((await currentUser(req))?.role !== 'admin') throw new HttpError(403, 'Chỉ quản trị viên mới xem được cài đặt này'); };
  api.get('/api/settings/ads', async (req, res) => {
    await mustAdmin(req);
    const c = await config();
    json(res, 200, { metaToken: masked(c.metaToken), metaConnected: !!c.metaToken, metaVersion: c.metaVersion });
  });
  // A new token is checked with Meta before it is kept: whose it is and how many ad accounts it reads.
  api.put('/api/settings/ads', async (req, res) => {
    const b = await readJson(req), c = await config();
    const version = b.metaVersion !== undefined ? String(b.metaVersion).trim() || DEFAULT_VERSION : c.metaVersion;
    if (!/^v\d{1,3}\.\d$/.test(version)) throw new HttpError(400, 'Phiên bản Graph API có dạng v26.0');
    const token = b.metaToken !== undefined ? String(b.metaToken).trim() : c.metaToken;
    if (token && !/^[A-Za-z0-9_|-]{20,600}$/.test(token)) throw new HttpError(400, 'Access token không hợp lệ');
    const next = { metaToken: token, metaVersion: version };
    let who: { name: string; accounts: number } | null = null;
    if (token) {
      const me = await graph(next, 'me', { fields: 'id,name' });
      cache.clear();
      who = { name: String(me.name || me.id), accounts: (await accounts(next, true)).length };
    }
    await setSetting('ads_config', next);
    json(res, 200, { metaToken: masked(token), metaConnected: !!token, metaVersion: version, who });
  });
}

/**
 * A period of one ad account as kept inside a client report (what the HTML shows, frozen when it was taken): the
 * account, totals against the period before, each day and each campaign with its results.
 */
export async function metaSnapshot(act: string, since: string, until: string) {
  if (!/^act_\d{5,25}$/.test(act)) throw new HttpError(400, 'Tài khoản quảng cáo không hợp lệ');
  const cfg = await config();
  const a = (await accounts(cfg, false)).find((x) => x.id === act);
  if (!a) throw new HttpError(404, 'Token Meta không đọc được tài khoản quảng cáo này');
  const r = await accountReport(cfg, act, since, until, true);
  const ids = r.campaigns.map((c) => c.id).filter(Boolean);
  const warnings: string[] = [];
  const filtering = JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: ids }]);
  const readSetup = async (edge: string, fields: string) => {
    if (!ids.length) return [];
    try { return (await graph(cfg, `${act}/${edge}`, { fields, filtering, limit: '100' }, 5)).data || []; }
    catch { warnings.push(edge === 'adsets' ? 'Token chưa đọc được cấu hình ad set và đối tượng.' : 'Token chưa đọc được caption, headline và liên kết quảng cáo.'); return null; }
  };
  const [adsets, ads] = await Promise.all([
    readSetup('adsets', 'id,name,campaign_id,destination_type,optimization_goal,billing_event,start_time,end_time,targeting'),
    readSetup('ads', 'id,name,adset_id,creative{id,name,body,title,object_url,object_story_spec,asset_feed_spec}'),
  ]);
  return {
    account: { id: a.id, name: a.name, currency: a.currency || 'USD' },
    setup: { adsets, ads }, warnings,
    data: {
      compare: r.compare, current: r.current, previous: r.previous, lastDataDate: r.lastDataDate,
      daily: r.daily.map((d) => ({ date: d.date, spend: d.spend, leads: d.leads, messages: d.messages, linkClicks: d.linkClicks })),
      campaigns: r.campaigns.slice(0, 40).map((c) => ({
        name: c.name, type: c.results.type, kpi: c.results.kpi, spend: c.spend, primary: c.results.primary, comments: c.comments, total: c.results.total,
        costPerTotal: c.results.costPerTotal, previousCostPerTotal: c.previousCostPerTotal, ctr: c.ctr, impressions: c.impressions, clicks: c.clicks, linkClicks: c.linkClicks,
      })),
    },
  };
}
