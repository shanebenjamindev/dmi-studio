const DAY = 86400000;
/** Civil dates in Vietnam represented at UTC midnight; arithmetic stays independent of the browser zone. */
export function calendarDay(timestamp: number): number {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(timestamp);
  const part = (key: string) => Number(parts.find((p) => p.type === key)!.value);
  return Date.UTC(part('year'), part('month') - 1, part('day'));
}
export const addDays = (day: number, count: number) => day + count * DAY;
export const monthStart = (day: number) => { const d = new Date(day); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
export const shiftMonth = (day: number, count: number) => { const d = new Date(day); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + count, 1); };
export const weekStart = (day: number) => addDays(day, -new Date(day).getUTCDay());
export function monthDays(day: number) {
  const start = weekStart(monthStart(day)), next = shiftMonth(day, 1);
  const length = Math.ceil((next - start) / DAY / 7) * 7;
  return Array.from({ length }, (_, i) => addDays(start, i));
}
export function scheduleSpan(start: number | null, end: number | null): [number, number] | null {
  if (start === null && end === null) return null;
  const a = calendarDay(start ?? end!), b = calendarDay(end ?? start!);
  return [Math.min(a, b), Math.max(a, b)];
}
export function clippedSpan(span: [number, number], days: number[]): { left: number; width: number } | null {
  if (!days.length || span[1] < days[0] || span[0] > days[days.length - 1]) return null;
  const left = Math.max(0, (span[0] - days[0]) / DAY);
  const end = Math.min(days.length, (span[1] - days[0]) / DAY + 1);
  return { left, width: end - left };
}
