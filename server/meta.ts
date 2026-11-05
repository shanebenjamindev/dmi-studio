// Meta Ads numbers in the agency's reporting fields (the model: PAID_ADS_MASTER_V2's 07_META_RAW and the Report
// Center's KPIs): one Insights row as spend, impressions, reach, clicks, link clicks, leads, messages and comments; ratios
// recomputed from totals (blank when the denominator is 0); results by conversion type. No I/O here (see ads.ts).

export interface MetaRow {
  date: string; campaignId: string; campaign: string; objective: string;
  spend: number; impressions: number; reach: number; clicks: number; linkClicks: number; leads: number; messages: number; comments: number;
}
const num = (x: any) => (Number.isFinite(Number(x)) ? Number(x) : 0);
/** Leads as Meta counts them ("lead" sums form and website leads; older accounts report the parts). */
function leadsOf(acts: Map<string, number>) {
  if (acts.has('lead')) return acts.get('lead')!;
  return (acts.get('onsite_conversion.lead_grouped') || acts.get('leadgen_grouped') || 0) + (acts.get('offsite_conversion.fb_pixel_lead') || 0);
}
/** One row of Insights (any level) in the reporting fields. */
export function metaRow(x: any): MetaRow {
  const acts = new Map<string, number>((x.actions || []).map((a: any) => [String(a.action_type), num(a.value)]));
  return {
    date: String(x.date_start || ''), campaignId: String(x.campaign_id || ''), campaign: String(x.campaign_name || ''), objective: String(x.objective || ''),
    spend: num(x.spend), impressions: num(x.impressions), reach: num(x.reach), clicks: num(x.clicks), linkClicks: num(x.inline_link_clicks),
    leads: leadsOf(acts), messages: acts.get('onsite_conversion.messaging_conversation_started_7d') || 0, comments: acts.get('comment') || 0,
  };
}
export type ConversionType = 'LeadForm' | 'Messages' | 'Traffic' | 'Engagement';
/** What a campaign is for, from its objective and what it got (a lead objective with messages but no leads runs on messages). */
export function conversionOf(r: Pick<MetaRow, 'objective' | 'leads' | 'messages' | 'campaign'>): ConversionType {
  const o = r.objective.toUpperCase(), name = r.campaign.toLowerCase();
  if (/LINK_CLICKS|TRAFFIC/.test(o)) return 'Traffic';
  if (/MESSAGES/.test(o) || /\bmess(age|ages)?\b|tin nhắn/.test(name) && !r.leads) return 'Messages';
  if (/LEAD|CONVERSIONS|SALES/.test(o)) return r.leads || !r.messages ? 'LeadForm' : 'Messages';
  return r.messages && !r.leads ? 'Messages' : 'Engagement';
}
const PRIMARY: Record<ConversionType, { kpi: string; of: (r: Totals) => number | null }> = {
  LeadForm: { kpi: 'CPL', of: (r) => r.leads },
  Messages: { kpi: 'CPMe', of: (r) => r.messages },
  Traffic: { kpi: 'CPLC', of: (r) => r.linkClicks },
  Engagement: { kpi: '', of: () => null },
};
const ratio = (a: number, b: number, k = 1) => (b ? (a / b) * k : null);
export interface Totals {
  spend: number; impressions: number; reach: number; clicks: number; linkClicks: number; leads: number; messages: number; comments: number;
  ctr: number | null; cpc: number | null; cpm: number | null; cpl: number | null; cpme: number | null; cplc: number | null; frequency: number | null;
}
/** Sums and the ratios recomputed from them. Reach adds up only within one row (Meta dedupes it per query), so it comes from `reach` when given. */
export function totals(rows: MetaRow[], reach?: number): Totals {
  const s = { spend: 0, impressions: 0, reach: 0, clicks: 0, linkClicks: 0, leads: 0, messages: 0, comments: 0 };
  for (const r of rows) for (const k of Object.keys(s) as (keyof typeof s)[]) s[k] += r[k];
  if (reach !== undefined) s.reach = reach;
  s.spend = Math.round(s.spend * 100) / 100;
  return {
    ...s, ctr: ratio(s.clicks, s.impressions, 100), cpc: ratio(s.spend, s.clicks), cpm: ratio(s.spend, s.impressions, 1000),
    cpl: ratio(s.spend, s.leads), cpme: ratio(s.spend, s.messages), cplc: ratio(s.spend, s.linkClicks), frequency: ratio(s.impressions, s.reach),
  };
}
/** A campaign's (or a whole account's) results: primary by conversion type, plus comments. */
export function results(t: Totals, type: ConversionType) {
  const primary = PRIMARY[type].of(t);
  const total = (primary || 0) + t.comments;
  return { type, kpi: PRIMARY[type].kpi, primary, total: primary === null && !t.comments ? null : total, costPerPrimary: primary ? t.spend / primary : null, costPerTotal: total ? t.spend / total : null };
}

// ------------------------------------------------------------------ dates
const DAY = 864e5;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const dayOf = (s: string) => Date.parse(`${s}T00:00:00Z`);
/** The same number of days just before [since, until]. */
export function previousRange(since: string, until: string) {
  const n = Math.round((dayOf(until) - dayOf(since)) / DAY) + 1;
  return { since: isoDay(dayOf(since) - n * DAY), until: isoDay(dayOf(since) - DAY) };
}
