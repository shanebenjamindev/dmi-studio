export type SummaryConversion = 'LeadForm' | 'Messages' | 'Traffic' | 'Engagement';
export type SummaryKpi = 'Auto' | 'CPL' | 'CPA' | 'CPMe' | 'CPLC' | 'CPC' | 'CTR' | 'Primary Results';
export interface AdsService {
  id: string; clientId: string; client: string; channel: string; service: string; serviceStatus: string; currency: string;
  monthlyBudget: number | null; primaryKpi: SummaryKpi; kpiTarget: number | null; notes: string; campaignOwner: string;
  conversionType: SummaryConversion; reportingKey: string; accountId: string; campaignIds: string[];
}
export interface AdsSummaryRow extends Omit<AdsService, 'primaryKpi'> {
  primaryKpi: string;
  spend30: number | null; spendBudgetPct: number | null; leads30: number | null; messages30: number | null; impressions30: number | null;
  clicks30: number | null; ctr30: number | null; cpc30: number | null; cpl30: number | null; cpme30: number | null;
  kpiStatus: string; spend7: number | null; leads7: number | null; cpl7: number | null; costChange7: number | null;
  lastDataDate: string | null; primary30: number | null; costPrimary30: number | null; primary7: number | null; costPrimary7: number | null;
  error: string | null;
}
export const ADS_SUMMARY_COLUMNS = [
  ['clientId','Client ID'], ['client','Client'], ['channel','Channel'], ['service','Service'], ['serviceStatus','Service Status'],
  ['currency','Currency'], ['monthlyBudget','Monthly Budget'], ['spend30','Spend 30D'], ['spendBudgetPct','Spend % Budget'],
  ['leads30','Leads / Conv 30D'], ['messages30','Messages 30D'], ['impressions30','Impressions 30D'], ['clicks30','Clicks 30D'],
  ['ctr30','CTR 30D'], ['cpc30','CPC 30D'], ['cpl30','CPL / CPA 30D'], ['cpme30','CPMe 30D'], ['primaryKpi','Primary KPI'],
  ['kpiTarget','KPI Target'], ['kpiStatus','KPI Status'], ['spend7','Spend 7D'], ['leads7','Leads / Conv 7D'], ['cpl7','CPL / CPA 7D'],
  ['costChange7','7D vs Prev 7D'], ['lastDataDate','Last Data Date'], ['notes','Notes'], ['campaignOwner','Campaign Owner'],
  ['conversionType','Conversion Type'], ['primary30','Primary Results 30D'], ['costPrimary30','Cost / Primary Result 30D'],
  ['primary7','Primary Results 7D'], ['costPrimary7','Cost / Primary Result 7D'], ['reportingKey','Reporting Key'],
] as const satisfies readonly (readonly [keyof AdsSummaryRow,string])[];
export interface AdsSummary {
  until: string; since30: string; since7: string; previous7: { since: string; until: string }; rows: AdsSummaryRow[];
}
