import {useCustomerStatuses} from './useCustomerStatuses';
import type {CSSProperties} from 'react';

export function CustomerStages({status,onChange,disabled=false}:{status:string;onChange:(status:string)=>void;disabled?:boolean}) {
 const statuses=useCustomerStatuses();
 const choices=statuses.filter(s=>s.active||s.id===status);
 if(status&&!choices.some(s=>s.id===status))choices.push({id:status,name:status,color:'#64748b',pos:0,active:false});
 return <div className="crm-stage-field"><div className="crm-stage-label"><span>Trạng thái</span><button type="button" className="crm-stage-clear" aria-pressed={!status} disabled={disabled} onClick={()=>onChange('')}>Chưa đặt</button></div><div className="crm-stages" role="group" aria-label="Trạng thái khách hàng">{choices.map(({id,name,color,active},i)=><button type="button" key={id} className={'crm-stage'+(status===id?' selected':'')} style={{'--stage-color':color} as CSSProperties} aria-pressed={status===id} disabled={disabled||(!active&&status!==id)} onClick={()=>onChange(id)}><span className="crm-stage-number" aria-hidden="true">{i+1}</span><span>{name}</span></button>)}</div></div>;
}
