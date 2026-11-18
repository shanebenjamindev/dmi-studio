// A short fingerprint of a text (FNV-1a, 32 bits), the same in the browser and on the server: a quick note's save says
// which version it was typed over, so a change made meanwhile on another computer is not overwritten.
export function textHash(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
