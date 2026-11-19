// One activity signal for API calls; concurrent requests share a single indicator.
const listeners=new Set<()=>void>();
let count=0,visible=false;
let timer:ReturnType<typeof setTimeout>|undefined;
const emit=()=>listeners.forEach(fn=>fn());
export const loadingState={subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},snapshot:()=>visible};
// Background refreshes (polls) show no indicator: requests started while `fn` runs are left out. The first request of
// an async `fn` starts before its first await, so it is covered; later ones are not.
let quiet=0;
export function quietly<T>(fn:()=>T):T{quiet++;try{return fn();}finally{quiet--;}}
export function beginLoading(){
 if(quiet)return()=>{};
 if(count++===0)timer=setTimeout(()=>{if(count){visible=true;emit();}},350);
 let finished=false;
 return()=>{if(finished)return;finished=true;if(--count===0){clearTimeout(timer);visible=false;emit();}};
}
