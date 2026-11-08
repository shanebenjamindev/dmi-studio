import {useEffect,useState} from 'react';
import {api} from '../api';
import {toast} from '../store';
import type {CustomerStatusOption} from '../types';
export type {CustomerStatusOption} from '../types';
export function useCustomerStatuses() {
 const [statuses,setStatuses]=useState<CustomerStatusOption[]>([]);
 useEffect(()=>{
  let active=true;
  const refresh=()=>api.customerStatuses().then(s=>{if(active)setStatuses(s);},e=>{if(active)toast(e.message,true);});
  void refresh();
  window.addEventListener('focus',refresh);window.addEventListener('dms:customer-statuses',refresh);
  return()=>{active=false;window.removeEventListener('focus',refresh);window.removeEventListener('dms:customer-statuses',refresh);};
 },[]);
 return statuses;
}
