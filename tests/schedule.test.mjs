import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarDay, monthDays, scheduleSpan, clippedSpan, addDays, weekStart, shiftMonth } from '../shared/schedule.ts';

test('calendar uses Vietnam civil days, complete weeks and year transitions', () => {
  assert.equal(calendarDay(Date.parse('2026-11-03T18:00:00Z')),Date.UTC(2026,10,4));
  const november=monthDays(Date.UTC(2026,10,4));
  assert.equal(november.length,35);
  assert.equal(november[0],Date.UTC(2026,10,1));
  assert.equal(november.at(-1),Date.UTC(2026,11,5));
  assert.equal(weekStart(Date.UTC(2026,10,4)),Date.UTC(2026,10,1));
  assert.equal(shiftMonth(Date.UTC(2026,11,31),1),Date.UTC(2027,0,1));
  assert.equal(monthDays(Date.UTC(2024,1,1)).includes(Date.UTC(2024,1,29)),true);
});
test('timeline clips ranges inclusively and retains undated / single-date cards', () => {
  const a=Date.UTC(2026,10,1);const days=Array.from({length:7},(_,i)=>addDays(a,i));
  assert.equal(scheduleSpan(null,null),null);
  assert.deepEqual(scheduleSpan(Date.parse('2026-11-04T10:00:00+07:00'),null),[addDays(a,3),addDays(a,3)]);
  assert.deepEqual(clippedSpan([addDays(a,-3),addDays(a,2)],days),{left:0,width:3});
  assert.deepEqual(clippedSpan([addDays(a,5),addDays(a,20)],days),{left:5,width:2});
  assert.equal(clippedSpan([addDays(a,7),addDays(a,8)],days),null);
});
