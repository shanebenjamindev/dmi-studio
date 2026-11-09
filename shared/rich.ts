// Descriptions and comments written in the formatting editor are HTML; older ones (and imported ones) are plain text.
// Both stay readable: the app shows HTML through its sanitizer (web/src/components/RichText.tsx), and places that need
// words only (notification previews, search) take the text out of it here.
// The editor's HTML can also start with words ("text<div>next line</div>" once Enter is pressed after typing), so a
// closing tag, a line break, a picture or an escaped character anywhere marks it too.
export const isRich = (s: string | null | undefined) => /^\s*<(p|div|h[1-3]|ul|ol|blockquote|pre|b|strong|i|em|u|s|strike|span|font|a|br|code|sub|sup|img)\b/i.test(s || '')
  || /<\/(p|div|h[1-3]|ul|ol|li|blockquote|pre|b|strong|i|em|u|s|strike|span|font|a|code|sub|sup)>|<(br|img)\b[^>]*>|&(nbsp|amp|lt|gt|quot|#39);/i.test(s || '');
/** The words of a text, formatted or not. */
export function richToText(s: string | null | undefined) {
  if (!isRich(s)) return s || '';
  return String(s).replace(/<img\b[^>]*>/gi, ' [ảnh] ').replace(/<\/?(br|p|div|li|h[1-3]|ul|ol|blockquote|pre)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
/** The most a description, result or comment may hold (a few pictures, made small by the editor). */
export const RICH_MAX = 600 * 1024;
export const RICH_TOO_LONG = 'Nội dung quá dài (tối đa khoảng 600 KB); hãy bớt ảnh hoặc chia nhỏ';
/** Nothing written (formatting with no words or pictures in it counts as nothing). */
export const isBlank = (s: string | null | undefined) => !richToText(s).trim() && !/<img\b/i.test(s || '');
