import { Router, HttpError, json, readJson, type Req } from './http';
import { all, get, run, uid, now } from './db';
import { currentUser } from './auth';
import { accounts, config, accountReport } from './ads';
import { emptySummary, shiftDay, summaryRow, summaryUntil } from './ads-summary-math';
import type { AdsService, AdsSummaryRow } from '../shared/ads-summary';

const services = async () => (await all<any>('SELECT id,data FROM ads_services ORDER BY updated_at DESC')).map(x=>({...JSON.parse(x.data),id:x.id}) as AdsService);
const admin = async (req:Req) => {if((await currentUser(req))?.role!=='admin')throw new HttpError(403,'Chỉ quản trị viên được cấu hình dòng báo cáo');};
function input(b:any,id:string):AdsService {
  const text=(key:string,max:number,required=false)=>{const s=String(b[key]??'').trim();if((required&&!s)||s.length>max)throw new HttpError(400,`Trường ${key} không hợp lệ`);return s;};
  const number=(key:string)=>{const v=b[key];if(v===null||v===undefined||v==='')return null;if(typeof v!=='number'||!Number.isFinite(v)||v<0)throw new HttpError(400,`${key} phải là số không âm`);return v;};
  const clientId=text('clientId',100,true),client=text('client',200,true),service=text('service',200,true),accountId=text('accountId',40,true);
  if(!/^act_\d{5,25}$/.test(accountId))throw new HttpError(400,'Tài khoản quảng cáo không hợp lệ');
  const conversionType=b.conversionType||'LeadForm';
  if(!['LeadForm','Messages','Traffic','Engagement'].includes(conversionType))throw new HttpError(400,'Conversion Type không hợp lệ');
  const primaryKpi=b.primaryKpi||'Auto';
  if(!['Auto','CPL','CPA','CPMe','CPLC','CPC','CTR','Primary Results'].includes(primaryKpi))throw new HttpError(400,'Primary KPI không hợp lệ');
  if(!Array.isArray(b.campaignIds)||b.campaignIds.length>100||b.campaignIds.some((x:any)=>typeof x!=='string'||!/^\d{1,30}$/.test(x)))throw new HttpError(400,'Danh sách chiến dịch không hợp lệ');
  const currency=text('currency',3)||'USD';if(!/^[A-Z]{3}$/.test(currency))throw new HttpError(400,'Mã tiền tệ không hợp lệ');
  return {id,clientId,client,service,accountId,conversionType,primaryKpi,campaignIds:[...new Set<string>(b.campaignIds)].sort(),currency,
    channel:'Meta',serviceStatus:text('serviceStatus',80)||'Active',monthlyBudget:number('monthlyBudget'),kpiTarget:number('kpiTarget'),
    notes:text('notes',5000),campaignOwner:text('campaignOwner',200),reportingKey:text('reportingKey',500)||`${clientId}|Meta|${service}|${conversionType}`};
}
export function registerAdsSummary(api:Router) {
  api.get('/api/ads/services',async(_req,res)=>json(res,200,await services()));
  api.post('/api/ads/services',async(req,res)=>{
    await admin(req);const data=input(await readJson(req),uid('as_'));
    if(await get('SELECT 1 FROM ads_services WHERE reporting_key=?',data.reportingKey))throw new HttpError(409,'Reporting Key đã được dùng; hãy đặt key riêng cho dòng báo cáo');
    await run('INSERT INTO ads_services(id,reporting_key,data,updated_at) VALUES(?,?,?,?)',data.id,data.reportingKey,JSON.stringify(data),now());json(res,201,data);
  });
  api.put('/api/ads/services/:id',async(req,res)=>{
    await admin(req);const old:any=await get('SELECT data FROM ads_services WHERE id=?',req.params.id);if(!old)throw new HttpError(404,'Không tìm thấy dòng báo cáo');
    const data=input({...JSON.parse(old.data),...await readJson(req)},req.params.id);
    if(await get('SELECT 1 FROM ads_services WHERE reporting_key=? AND id<>?',data.reportingKey,data.id))throw new HttpError(409,'Reporting Key đã được dùng');
    await run('UPDATE ads_services SET reporting_key=?,data=?,updated_at=? WHERE id=?',data.reportingKey,JSON.stringify(data),now(),data.id);json(res,200,data);
  });
  api.delete('/api/ads/services/:id',async(req,res)=>{await admin(req);const r=await run('DELETE FROM ads_services WHERE id=?',req.params.id);if(!r.changes)throw new HttpError(404,'Không tìm thấy dòng báo cáo');json(res,200,{ok:true});});
  api.get('/api/ads/summary',async(req,res)=>{
    const until=req.query.get('until')||summaryUntil();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(until)||!Number.isFinite(Date.parse(`${until}T00:00:00Z`))||new Date(`${until}T00:00:00Z`).toISOString().slice(0,10)!==until)throw new HttpError(400,'Ngày báo cáo không hợp lệ');
    if(until>summaryUntil())throw new HttpError(400,'Chọn ngày đến hết hôm qua để dùng số liệu ngày đã kết thúc');
    const since30=shiftDay(until,-29),since7=shiftDay(until,-6),previous7={since:shiftDay(until,-13),until:shiftDay(until,-7)};
    const list=await services(),cfg=await config(),fresh=req.query.get('fresh')==='1';
    let adAccounts:Awaited<ReturnType<typeof accounts>>=[],accountError='';
    if(list.length)try{adAccounts=await accounts(cfg,fresh);}catch(e:any){accountError=e.message;}
    // Share identical requests between service rows; cap account workloads at two at a time.
    const pending=new Map<string,ReturnType<typeof accountReport>>();
    const report=(s:AdsService,since:string)=>{const key=JSON.stringify([s.accountId,s.campaignIds,since,until]);if(!pending.has(key))pending.set(key,accountReport(cfg,s.accountId,since,until,fresh,s.campaignIds));return pending.get(key)!;};
    const rows:AdsSummaryRow[]=new Array(list.length);let cursor=0;
    const work=async()=>{while(cursor<list.length){const i=cursor++,s=list[i];try{
      if(accountError)throw new Error(accountError);const account=adAccounts.find(a=>a.id===s.accountId);if(!account)throw new Error('Token không đọc được tài khoản quảng cáo đã chọn');
      const [r30,r7]=await Promise.all([report(s,since30),report(s,since7)]);
      rows[i]=summaryRow({...s,currency:account.currency||s.currency},r30.current,r7.current,r7.previous,r30.lastDataDate);
    }catch(e:any){rows[i]=emptySummary(s,e.message||'Không tải được số liệu');}}};
    await Promise.all([work(),work()]);json(res,200,{until,since30,since7,previous7,rows});
  });
}
