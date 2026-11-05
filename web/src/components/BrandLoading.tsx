import {useEffect,useState,useSyncExternalStore} from 'react';
import {loadingState} from '../loading';
export function BrandLoading({label='Đang tải…',compact=false}:{label?:string;compact?:boolean}){
 return <div className={'brand-loading'+(compact?' compact':'')} role="status" aria-live="polite"><img src="/brand/mark.png" alt=""/><span>{label}</span></div>;
}
export function NetworkLoading({busy}:{busy?:string|null}){
 const network=useSyncExternalStore(loadingState.subscribe,loadingState.snapshot);
 const visible=network||!!busy;
 const[slow,setSlow]=useState(false);
 useEffect(()=>{setSlow(false);if(!visible)return;const t=setTimeout(()=>setSlow(true),8000);return()=>clearTimeout(t);},[visible]);
 return visible?<div className="network-loading"><BrandLoading compact label={busy||(slow?'Đang xử lý, vui lòng chờ…':'Đang tải…')}/></div>:null;
}
