import type {ReactNode} from 'react';
import {useRef} from 'react';
import {Icon} from './ui';

/** Shared navigation for list-and-reading views; `vertical`: a column of sections (Outlook-like), moved through with ↑ ↓. */
export function ReadingTabs<T extends string>({label,value,items,onChange,className='',vertical=false}:{label:string;value:T;items:{value:T;label:string;icon?:string}[];onChange:(value:T)=>void;className?:string;vertical?:boolean}) {
 const nav=useRef<HTMLElement>(null);
 const active=items.some(i=>i.value===value)?value:items[0]?.value;
 return <nav ref={nav} className={'reading-tabs '+className} role="tablist" aria-label={label} aria-orientation={vertical?'vertical':'horizontal'}>{items.map((item,i)=><button type="button" key={item.value} role="tab" title={item.label} aria-label={item.label} aria-selected={value===item.value} tabIndex={active===item.value?0:-1} onClick={()=>onChange(item.value)} onKeyDown={e=>{
  const fwd=vertical?'ArrowDown':'ArrowRight',back=vertical?'ArrowUp':'ArrowLeft';
  const next=e.key===fwd?(i+1)%items.length:e.key===back?(i-1+items.length)%items.length:e.key==='Home'?0:e.key==='End'?items.length-1:-1;
  if(next<0)return;e.preventDefault();onChange(items[next].value);const button=nav.current?.querySelectorAll('button')[next];button?.focus();button?.scrollIntoView({block:'nearest',inline:'nearest'});
 }}>{item.icon&&<Icon name={item.icon} size={14}/>}<span>{item.label}</span></button>)}</nav>;
}
export function ReadingHeader({label,onClose,actions}:{label:string;onClose:()=>void;actions?:ReactNode}) {
 return <header className="reading-header"><span>{label}</span><div>{actions}<button type="button" className="bd-icon" onClick={onClose} aria-label={`Đóng ${label.toLocaleLowerCase('vi')}`} title="Về danh sách"><Icon name="x" size={18}/></button></div></header>;
}
