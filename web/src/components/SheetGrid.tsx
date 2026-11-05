import {TextLinks} from './TextLinks';
/** The same grid renders source-file previews and persisted sheet pages. */
export function SheetGrid({headers,rows,start=0,titleColumn=-1,taskIds,onOpen}:{headers:string[];rows:string[][];start?:number;titleColumn?:number;taskIds?:(string|null)[];onOpen?:(id:string)=>void}) {
  return <div className="tk-source-scroll" tabIndex={0} role="region" aria-label="Bảng theo file sheet">
    <table className="tk-source-table"><thead><tr><th scope="col">#</th>{headers.map((header,i)=><th key={i} scope="col">{header||`Cột ${i+1}`}</th>)}</tr></thead>
      <tbody>{rows.map((row,i)=><tr key={start+i}><th scope="row">{start+i+1}</th>{headers.map((_,j)=><td key={j}><div>{j===titleColumn&&taskIds?.[i]&&onOpen?<button className="tk-source-open" onClick={()=>onOpen(taskIds[i]!)}>{row[j]||'Mở công việc'}</button>:<TextLinks text={row[j]??''}/>}</div></td>)}</tr>)}</tbody>
    </table>
  </div>;
}
