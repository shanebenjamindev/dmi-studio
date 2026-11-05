import { readTaskSheet, normName } from '../server/taskimport';
export interface CustomerImportRow { name: string; externalId: string; alias: string; notes: string; email: string; phone: string }
export function readCustomerImport(text: string): { headers: string[]; rows: string[][]; customers: CustomerImportRow[]; skipped: number } {
  const sheet=readTaskSheet(text), headers=sheet.headers.map(normName);
  const col=(names:string[])=>headers.findIndex(h=>names.includes(h));
  const name=col(['customer name','client name','customer','client','ten khach hang','khach hang','ten khach']);
  if(name<0)throw new Error('Không tìm thấy cột Customer Name / Tên khách hàng. Hãy chọn đúng sheet danh bạ.');
  const id=col(['customer id','client id','ma khach hang','ma khach']);
  const alias=col(['known alias project name','known alias / project name','alias','ten khac','ten du an']);
  const notes=col(['notes','note','ghi chu']),email=col(['email','e mail']),phone=col(['phone','phone number','so dien thoai','dien thoai']);
  const val=(row:string[],i:number)=>i<0?'':String(row[i]||'').trim();
  const customers=sheet.rows.filter(r=>val(r,name)).map(r=>({name:val(r,name),externalId:val(r,id),alias:val(r,alias),notes:val(r,notes),email:val(r,email),phone:val(r,phone)}));
  if(!customers.length)throw new Error('Sheet chưa có dòng khách hàng.');
  if(customers.length>2000)throw new Error('Mỗi lần nhập tối đa 2.000 khách hàng.');
  if(customers.some(c=>c.name.length>200))throw new Error('Tên khách hàng không được quá 200 ký tự.');
  return {headers:sheet.headers,rows:sheet.rows,customers,skipped:sheet.rows.length-customers.length};
}
