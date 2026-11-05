import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ADS_SUMMARY_COLUMNS} from '../shared/ads-summary.ts';
import {summaryRow,emptySummary,shiftDay} from '../server/ads-summary-math.ts';
import {totals} from '../server/meta.ts';
const service={id:'s',clientId:'C01',client:'Client',channel:'Meta',service:'Coating',serviceStatus:'Active',currency:'USD',monthlyBudget:1000,primaryKpi:'Auto',kpiTarget:15,notes:'',campaignOwner:'Owner',conversionType:'LeadForm',reportingKey:'C01|Meta|Coating|LeadForm',accountId:'act_111111',campaignIds:[]};
const t=(spend,leads,messages=0,linkClicks=0)=>totals([{date:'',campaignId:'',campaign:'',objective:'',spend,leads,messages,linkClicks,impressions:1000,reach:800,clicks:20,comments:3}]);
test('summary exports exactly the requested 33 columns in order',()=>{
 assert.equal(ADS_SUMMARY_COLUMNS.length,33);
 assert.equal(new Set(ADS_SUMMARY_COLUMNS.map(([key])=>key)).size,33);
 assert.deepEqual(ADS_SUMMARY_COLUMNS.map(([,label])=>label),['Client ID','Client','Channel','Service','Service Status','Currency','Monthly Budget','Spend 30D','Spend % Budget','Leads / Conv 30D','Messages 30D','Impressions 30D','Clicks 30D','CTR 30D','CPC 30D','CPL / CPA 30D','CPMe 30D','Primary KPI','KPI Target','KPI Status','Spend 7D','Leads / Conv 7D','CPL / CPA 7D','7D vs Prev 7D','Last Data Date','Notes','Campaign Owner','Conversion Type','Primary Results 30D','Cost / Primary Result 30D','Primary Results 7D','Cost / Primary Result 7D','Reporting Key']);
});
test('summary compares primary result cost, uses proper targets and does not add comments to primary results',()=>{
 const row=summaryRow(service,t(300,30),t(60,10),t(100,10),'2026-11-03');
 assert.equal(row.spendBudgetPct,30);assert.equal(row.primary30,30);assert.equal(row.costPrimary30,10);assert.equal(row.primaryKpi,'CPL');assert.equal(row.kpiStatus,'On target');
 assert.equal(row.primary7,10);assert.equal(row.costPrimary7,6);assert.equal(row.costChange7,-40);assert.equal(row.ctr30,2);assert.equal(row.cpc30,15);assert.equal(row.lastDataDate,'2026-11-03');
 const msg=summaryRow({...service,conversionType:'Messages',kpiTarget:2},t(90,1,30),t(30,1,10),t(20,1,10),null);
 assert.equal(msg.primary30,30);assert.equal(msg.primaryKpi,'CPMe');assert.equal(msg.kpiStatus,'Off target');assert.equal(msg.costChange7,50);
 const traffic=summaryRow({...service,conversionType:'Traffic',primaryKpi:'CTR',kpiTarget:1.5},t(50,0,0,25),t(10,0,0,10),t(10,0,0,5),null);
 assert.equal(traffic.primary30,25);assert.equal(traffic.costPrimary30,2);assert.equal(traffic.kpiStatus,'On target');
});
test('zero denominators, missing targets, failed accounts and date windows stay explicit',()=>{
 const empty=summaryRow({...service,monthlyBudget:0,kpiTarget:null},totals([]),totals([]),totals([]),null);
 assert.equal(empty.spend30,0);assert.equal(empty.primary30,0);assert.equal(empty.costPrimary30,null);assert.equal(empty.spendBudgetPct,null);assert.equal(empty.costChange7,null);assert.equal(empty.kpiStatus,'No target');
 const row=emptySummary(service,'Token expired');assert.equal(row.spend30,null);assert.equal(row.kpiStatus,'Data error');assert.equal(row.error,'Token expired');
 assert.equal(summaryRow({...service,conversionType:'Engagement'},t(5,0),t(5,0),t(5,0),null).primary30,null);
 assert.equal(shiftDay('2026-11-03',-29),'2026-10-05');assert.equal(shiftDay('2026-11-03',-6),'2026-10-28');assert.equal(shiftDay('2026-11-03',-13),'2026-10-21');
});
