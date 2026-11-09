import {useEffect,useState} from 'react';
import {api} from '../api';
import {toast} from '../store';
import type {CustomerStatusOption} from '../types';
export type {CustomerStatusOption} from '../types';
// One list for every part of the page that shows statuses: loaded once when the first one appears (again on focus or
// when statuses change), and shared, rather than a request from each.
let cache:CustomerStatusOption[]|null=null,pending:Promise<void>|null=null;
const subs=new Set<(s:CustomerStatusOption[])=>void>();
const refresh=()=>pending||=api.customerStatuses().then(s=>{cache=s;subs.forEach(f=>f(s));},e=>toast(e.message,true)).finally(()=>{pending=null;});
export function useCustomerStatuses() {
 const [statuses,setStatuses]=useState<CustomerStatusOption[]>(cache||[]);
 useEffect(()=>{
  subs.add(setStatuses);
  if(subs.size===1){void refresh();window.addEventListener('focus',refresh);window.addEventListener('dms:customer-statuses',refresh);}
  else if(cache)setStatuses(cache);
  return()=>{subs.delete(setStatuses);if(!subs.size){window.removeEventListener('focus',refresh);window.removeEventListener('dms:customer-statuses',refresh);}};
 },[]);
 return statuses;
}
