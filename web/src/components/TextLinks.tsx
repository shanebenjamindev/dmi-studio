import {textLinks} from '../../../shared/text-links';
export function TextLinks({text}:{text:string}){return <>{textLinks(text).map((p,i)=>p.href?<a key={i} href={p.href} target={p.href.startsWith('mailto:')?undefined:'_blank'} rel="noopener noreferrer" onClick={e=>e.stopPropagation()}>{p.text}</a>:p.text)}</>;}
