import type { AdsService, AdsSummaryRow } from '../shared/ads-summary';
import type { Totals } from './meta';
export const shiftDay = (day:string, delta:number) => new Date(Date.parse(`${day}T00:00:00Z`)+delta*86400000).toISOString().slice(0,10);
export function summaryUntil() {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const part=(type:string)=>parts.find(p=>p.type===type)!.value;
  return shiftDay(`${part('year')}-${part('month')}-${part('day')}`,-1);
}
export const defaultKpi = (type: AdsService['conversionType']) => ({LeadForm:'CPL',Messages:'CPMe',Traffic:'CPLC',Engagement:''})[type];
const primary = (t:Totals,type:AdsService['conversionType']) => type==='LeadForm'?t.leads:type==='Messages'?t.messages:type==='Traffic'?t.linkClicks:null;
const cost = (spend:number,n:number|null) => n ? spend/n : null;
export function emptySummary(s:AdsService,error:string|null=null):AdsSummaryRow {
  return {...s,primaryKpi:s.primaryKpi==='Auto'?defaultKpi(s.conversionType):s.primaryKpi,
    spend30:null,spendBudgetPct:null,leads30:null,messages30:null,impressions30:null,clicks30:null,ctr30:null,cpc30:null,cpl30:null,cpme30:null,
    kpiStatus:error?'Data error':'No data',spend7:null,leads7:null,cpl7:null,costChange7:null,lastDataDate:null,primary30:null,costPrimary30:null,primary7:null,costPrimary7:null,error};
}
export function summaryRow(s:AdsService,t30:Totals,t7:Totals,prev7:Totals,lastDataDate:string|null):AdsSummaryRow {
  const row=emptySummary(s), p30=primary(t30,s.conversionType),p7=primary(t7,s.conversionType),pPrev=primary(prev7,s.conversionType);
  const c30=cost(t30.spend,p30),c7=cost(t7.spend,p7),before=cost(prev7.spend,pPrev);
  const kpi=row.primaryKpi==='CPL'||row.primaryKpi==='CPA'?t30.cpl:row.primaryKpi==='CPMe'?t30.cpme:row.primaryKpi==='CPLC'?t30.cplc:row.primaryKpi==='CPC'?t30.cpc:row.primaryKpi==='CTR'?t30.ctr:row.primaryKpi==='Primary Results'?p30:null;
  const status=s.kpiTarget===null?'No target':kpi===null?'No data':(row.primaryKpi==='CTR'||row.primaryKpi==='Primary Results'?kpi>=s.kpiTarget:kpi<=s.kpiTarget)?'On target':'Off target';
  return {...row,spend30:t30.spend,spendBudgetPct:s.monthlyBudget?t30.spend/s.monthlyBudget*100:null,leads30:t30.leads,messages30:t30.messages,
    impressions30:t30.impressions,clicks30:t30.clicks,ctr30:t30.ctr,cpc30:t30.cpc,cpl30:t30.cpl,cpme30:t30.cpme,kpiStatus:status,
    spend7:t7.spend,leads7:t7.leads,cpl7:t7.cpl,costChange7:c7===null||before===null||before===0?null:(c7/before-1)*100,
    lastDataDate,primary30:p30,costPrimary30:c30,primary7:p7,costPrimary7:c7};
}
