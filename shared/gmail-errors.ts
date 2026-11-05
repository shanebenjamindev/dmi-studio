export interface GmailIssue {code:string;message:string;helpUrl?:string}
export const gmailEnableUrl=(project='')=>`https://console.cloud.google.com/apis/library/gmail.googleapis.com${/^\d+$/.test(project)?`?project=${project}`:''}`;
export function gmailIssue(status:number,body:any):GmailIssue{
 const e=body?.error||{},details=Array.isArray(e.details)?e.details:[];
 const reasons=[...(Array.isArray(e.errors)?e.errors:[]).map((x:any)=>x.reason),...details.map((x:any)=>x.reason)].join(' ');
 const consumer=details.map((x:any)=>x.metadata?.consumer||'').join(' ');
 const project=consumer.match(/projects\/(\d+)/)?.[1]||String(e.message||'').match(/project (\d+)/)?.[1]||'';
 if(/SERVICE_DISABLED|accessNotConfigured|API_DISABLED/.test(reasons))return {code:'API_DISABLED',message:'Gmail API chưa được bật trong Google Cloud project của ứng dụng. Bấm “Bật Gmail API”, chọn Enable rồi thử gửi lại; không cần đổi tài khoản Drive.',helpUrl:gmailEnableUrl(project)};
 if(/insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT/.test(reasons))return {code:'SCOPE_REQUIRED',message:'Tài khoản chưa cấp quyền gửi Gmail. Bấm “Kết nối lại Gmail” và cho phép gửi email.'};
 if(/domainPolicy/.test(reasons))return {code:'DOMAIN_POLICY',message:'Chính sách Google Workspace đang chặn ứng dụng sử dụng Gmail. Nhờ quản trị Google Workspace cho phép ứng dụng.'};
 if(/rateLimitExceeded|userRateLimitExceeded|dailyLimitExceeded/.test(reasons)||status===429)return {code:'RATE_LIMIT',message:'Gmail đang giới hạn gửi thư. Hệ thống sẽ thử lại sau.'};
 if(status===401)return {code:'AUTH_EXPIRED',message:'Phiên Gmail đã hết hạn. Hãy kết nối lại tài khoản gửi.'};
 return {code:'GMAIL_ERROR',message:`Gmail chưa gửi được thông báo (${status}). Kiểm tra Gmail đã hoạt động cho tài khoản này và quyền gửi email.`};
}
