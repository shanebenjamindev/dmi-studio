import {all,get} from './db';
import {HttpError} from './http';

export async function customerStatuses() {
  return all<{id:string;name:string;color:string;pos:number;active:number}>('SELECT id,name,color,pos,active FROM customer_statuses ORDER BY pos,name');
}
export async function customerStatus(value:unknown,old:string|null=null):Promise<string|null> {
  if(value===undefined)return old;
  if(value===null||value==='')return null;
  if(typeof value!=='string'||!await get('SELECT 1 FROM customer_statuses WHERE id=? AND (active=1 OR id=?)',value,old))throw new HttpError(400,'Trạng thái không hợp lệ hoặc đã tắt');
  return value;
}
