// Meta Ads numbers in the reporting fields, checked against rows of the agency's sheets (the model the page follows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metaRow, conversionOf, totals, results, previousRange } from '../server/meta.ts';

const close = (a, b, d = 1e-3) => assert.ok(a !== null && Math.abs(a - b) < d, `${a} ≈ ${b}`);

test('Meta: an Insights row becomes the sheet row (07_META_RAW, Portland Pro Detail 2026-06-26)', () => {
  const r = metaRow({
    date_start: '2026-06-26', campaign_id: '120246768334870784', campaign_name: 'DMI_LeadForm_20260626', objective: 'OUTCOME_LEADS',
    spend: '22.22', impressions: '632', reach: '468', clicks: '17', inline_link_clicks: '9',
    actions: [{ action_type: 'lead', value: '1' }, { action_type: 'link_click', value: '9' }, { action_type: 'onsite_conversion.lead_grouped', value: '1' }],
  });
  assert.deepEqual([r.spend, r.impressions, r.reach, r.clicks, r.linkClicks, r.leads, r.messages, r.comments], [22.22, 632, 468, 17, 9, 1, 0, 0]);
  const t = totals([r], r.reach);
  close(t.ctr, 2.69, 0.01); // the sheet keeps 0.0269 as a fraction
  close(t.cpc, 1.307); close(t.cpm, 35.158); close(t.frequency, 1.3504); close(t.cpl, 22.22);
  assert.equal(t.cpme, null, 'no messages: cost per message stays blank');
  assert.equal(conversionOf(r), 'LeadForm');
});

test('Meta: traffic results are link clicks, plus comments (LI Car Guys worked check)', () => {
  const t = totals([{ date: '', campaignId: '1', campaign: 'DMI | PPF | Traffic', objective: 'OUTCOME_TRAFFIC', spend: 701.85, impressions: 52000, reach: 30000, clicks: 1100, linkClicks: 799, leads: 0, messages: 8, comments: 3 }]);
  const type = conversionOf({ objective: 'OUTCOME_TRAFFIC', leads: 0, messages: 8, campaign: 'DMI | PPF | Traffic' });
  assert.equal(type, 'Traffic');
  const x = results(t, type);
  assert.equal(x.primary, 799); assert.equal(x.total, 802); assert.equal(x.kpi, 'CPLC');
  close(x.costPerPrimary, 0.8784, 1e-4); close(t.cpme, 87.73, 0.01);
});

test('Meta: a lead campaign with messages counts leads only; messages-only runs on messages; engagement has no KPI', () => {
  const lead = { objective: 'OUTCOME_LEADS', leads: 4, messages: 6, campaign: 'DMI | MessLead | Ceramic' };
  assert.equal(conversionOf(lead), 'LeadForm');
  assert.equal(results(totals([{ date: '', campaignId: '', spend: 100, impressions: 1, reach: 1, clicks: 1, linkClicks: 1, comments: 0, ...lead }]), 'LeadForm').primary, 4);
  assert.equal(conversionOf({ objective: 'OUTCOME_ENGAGEMENT', leads: 0, messages: 5, campaign: 'Summer | Messages' }), 'Messages');
  assert.equal(conversionOf({ objective: 'OUTCOME_ENGAGEMENT', leads: 0, messages: 0, campaign: 'Page likes' }), 'Engagement');
  const e = results(totals([]), 'Engagement');
  assert.equal(e.primary, null); assert.equal(e.total, null); assert.equal(e.kpi, '');
});

test('Meta: older accounts report leads in parts; zero denominators stay blank', () => {
  const r = metaRow({ spend: '50', impressions: '0', actions: [{ action_type: 'onsite_conversion.lead_grouped', value: '2' }, { action_type: 'offsite_conversion.fb_pixel_lead', value: '3' }, { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '4' }, { action_type: 'comment', value: '2' }] });
  assert.equal(r.leads, 5); assert.equal(r.messages, 4); assert.equal(r.comments, 2);
  const t = totals([r]);
  assert.equal(t.ctr, null); assert.equal(t.cpm, null); assert.equal(t.cpc, null); assert.equal(t.frequency, null);
  close(t.cpl, 10); close(t.cpme, 12.5);
});

test('Meta: the comparison is the same number of days just before', () => {
  assert.deepEqual(previousRange('2026-09-20', '2026-10-19'), { since: '2026-08-21', until: '2026-09-19' }); // the October report's window
  assert.deepEqual(previousRange('2026-09-14', '2026-09-20'), { since: '2026-09-07', until: '2026-09-13' }); // a week
  assert.deepEqual(previousRange('2026-03-01', '2026-03-01'), { since: '2026-02-28', until: '2026-02-28' });
});
