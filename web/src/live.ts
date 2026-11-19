// What changed on the server, asked with one small request (GET /api/live, server/live.ts) instead of a poll per panel.
// Each panel listens to its area and reloads only when that area's stamp moves. Asked every 10 s while the page is in
// view, every 3 s for a minute after a chat moved (a conversation going on), at once on coming back to the tab, and
// never while it is hidden.
import {api} from './api';
import {quietly} from './loading';

export type LiveArea='chat'|'work'|'notes'|'notifications';
const subs=new Map<LiveArea,Set<()=>void>>();
let last:Record<string,number|string>|null=null,timer:ReturnType<typeof setTimeout>|undefined,asking=false,fastUntil=0,askedAt=0;

async function ask(){
 if(asking||document.visibilityState!=='visible')return;
 asking=true;askedAt=Date.now();
 try{
  const now=await quietly(api.live);
  const moved=last?(Object.keys(now) as LiveArea[]).filter(k=>now[k]!==last![k]):[];
  last=now;
  if(moved.includes('chat'))fastUntil=Date.now()+60e3;
  for(const k of moved)subs.get(k)?.forEach(fn=>quietly(fn));
 }catch{/* the next turn asks again */}
 finally{asking=false;schedule();}
}
function schedule(){clearTimeout(timer);if(subs.size)timer=setTimeout(ask,Date.now()<fastUntil?3000:10000);}
// Coming back to the tab (or the window) asks at once, but not twice in a row.
const back=()=>{if(document.visibilityState==='visible'&&Date.now()-askedAt>2000)void ask();};

/** Calls `fn` whenever `area` changes on the server; returns the unsubscribe. */
export function onLive(area:LiveArea,fn:()=>void){
 if(!subs.size){document.addEventListener('visibilitychange',back);window.addEventListener('focus',back);void ask();}
 const set=subs.get(area)||new Set();set.add(fn);subs.set(area,set);
 return()=>{
  set.delete(fn);if(!set.size)subs.delete(area);
  if(!subs.size){clearTimeout(timer);document.removeEventListener('visibilitychange',back);window.removeEventListener('focus',back);last=null;}
 };
}
