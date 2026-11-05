// One activity signal for API calls; concurrent requests share a single indicator.
const listeners=new Set<()=>void>();
let count=0,visible=false;
let timer:ReturnType<typeof setTimeout>|undefined;
const emit=()=>listeners.forEach(fn=>fn());
export const loadingState={subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},snapshot:()=>visible};
export function beginLoading(){
 if(count++===0)timer=setTimeout(()=>{if(count){visible=true;emit();}},350);
 let finished=false;
 return()=>{if(finished)return;finished=true;if(--count===0){clearTimeout(timer);visible=false;emit();}};
}
