export type TextPart={text:string;href?:string};
/** Produce safe links from plain text, without interpreting HTML. */
export function textLinks(text:string):TextPart[]{
 const pattern=/\b(?:https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|mailto:[\w.+%-]+@[\w.-]+\.[a-z]{2,}|[\w.+%-]+@[\w.-]+\.[a-z]{2,}|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|org|net|io|dev|app|co|vn|edu|gov|cloud|ai)(?:\/[^\s<>"']*)?)/gi;
 const out:TextPart[]=[];let start=0;
 for(const match of text.matchAll(pattern)){
  const index=match.index!;let label=match[0].replace(/[.,;:!?]+$/,'');
  while(/[)\]}]$/.test(label)){
   const end=label.at(-1)!,open=({')':'(',']':'[','}':'{'} as Record<string,string>)[end];
   if(label.split(end).length<=label.split(open).length)break;
   label=label.slice(0,-1);
  }
  const href=/^mailto:/i.test(label)?label:/^[\w.+%-]+@/.test(label)?`mailto:${label}`:/^https?:\/\//i.test(label)?label:`https://${label}`;
  try{const url=new URL(href);if(!['http:','https:','mailto:'].includes(url.protocol))continue;}catch{continue;}
  if(index>start)out.push({text:text.slice(start,index)});
  out.push({text:label,href});start=index+label.length;
 }
 if(start<text.length)out.push({text:text.slice(start)});
 return out;
}
