import {test} from 'node:test';
import assert from 'node:assert/strict';
const {flowMatch,FLOW_FILTERS}=await import('../shared/flow-filter.ts');
test('Tổng quan\'s numbers and the lists they open count the same tasks',()=>{
 const H=3600e3,D=24*H;
 // Noon in Vietnam (05:00 UTC), so "today" has hours left either side.
 const now=Date.UTC(2026,10,13,5);
 const t=(o)=>({dueAt:null,revision:0,submittedAt:null,...o});
 const late=t({stage:'execution',dueAt:now-D}), today=t({stage:'account',dueAt:now+3*H}), soon=t({stage:'execution',dueAt:now+3*D}), later=t({stage:'review',dueAt:now+20*D,submittedAt:now-30*H}), none=t({stage:'execution'}), redo=t({stage:'execution',revision:2,dueAt:now+3*D}), done=t({stage:'completed',dueAt:now-D,revision:1});
 const all=[late,today,soon,later,none,redo,done];
 const of=(f)=>all.filter((x)=>flowMatch(x,f,now));
 assert.deepEqual(of('overdue'),[late]);                    // a closed task is never late
 assert.deepEqual(of('due-today'),[today]);
 assert.deepEqual(of('due-week'),[soon,redo]);
 assert.deepEqual(of('due-later'),[later]);
 assert.deepEqual(of('no-due'),[none]);
 assert.deepEqual(of('waiting'),[later]);                   // in REVIEW for over 24 hours
 assert.deepEqual(of('redo'),[redo]);                        // sent back, still open
 assert.deepEqual(of('completed'),[done]);
 // Every open task falls in exactly one due bucket.
 for(const x of all.filter((x)=>x.stage!=='completed'))assert.equal(['overdue','due-today','due-week','due-later','no-due'].filter((f)=>flowMatch(x,f,now)).length,1);
 assert.equal(FLOW_FILTERS.length,12);
});
