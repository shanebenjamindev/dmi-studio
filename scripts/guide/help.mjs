// Turns the user manual into the articles of the in-app Trợ giúp page (web/src/help/manual.ts), in Vietnamese
// (docs/huong-dan-dmi-workspace/nguon/so-tay.html) and English (en/source/user-manual.html), and their annotated
// screenshots into lighter pictures (web/public/help/img/[en/]*.jpg), each with the legend of its numbers. The two
// manuals have the same parts in the same order, so an English article takes the address of its Vietnamese one and
// switching language keeps the article open. Run again after editing a manual:  node scripts/guide/help.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SHOTS } from './shots.mjs';
import { SHOTS_EN } from './en.mjs';

const DOCS = 'docs/huong-dan-dmi-workspace';
const EDITIONS = {
  vi: { src: `${DOCS}/nguon/so-tay.html`, shots: `${DOCS}/anh`, img: 'web/public/help/img', url: '/help/img',
    shot: (id) => { const s = SHOTS.find((x) => x.id === id); return s && { title: s.title, notes: s.notes.map(([, t]) => t) }; },
    groups: { 'gioi-thieu': 'Bắt đầu', 'bat-dau': 'Bắt đầu', 'giao-dien': 'Bắt đầu', module: 'Hướng dẫn theo mục', 'quy-trinh': 'Việc thường làm', 'du-lieu': 'Dữ liệu, quyền, báo cáo', quyen: 'Dữ liệu, quyền, báo cáo', 'thong-ke': 'Dữ liệu, quyền, báo cáo', 'hoi-dap': 'Hỏi đáp', 'thuc-hanh': 'Hỏi đáp', 'thuat-ngu': 'Hỏi đáp' },
    split: new Set(['module', 'quy-trinh']) },
  en: { src: `${DOCS}/en/source/user-manual.html`, shots: `${DOCS}/en/images`, img: 'web/public/help/img/en', url: '/help/img/en',
    shot: (id) => SHOTS_EN[id],
    groups: { introduction: 'Getting started', 'getting-started': 'Getting started', layout: 'Getting started', features: 'Feature by feature', 'how-to': 'Common tasks', data: 'Data, access, reports', roles: 'Data, access, reports', statistics: 'Data, access, reports', faq: 'FAQ', 'good-practice': 'FAQ', glossary: 'FAQ' },
    split: new Set(['features', 'how-to']) },
};
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const strip = (s) => s.replace(/<[^>]+>/g, '').trim();

function build(ed, slugs) {
  const html = fs.readFileSync(ed.src, 'utf8').replace(/^[\s\S]*?<body[^>]*>/, '').replace(/<\/body>[\s\S]*$/, '');
  const parts = [...html.matchAll(/<h2([^>]*)>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2|$)/g)].filter(([, attrs]) => !/no-toc/.test(attrs));
  const articles = [];
  for (const [, attrs, title, body] of parts) {
    const id = attrs.match(/id="([^"]+)"/)?.[1] || slug(strip(title)), cat = ed.groups[id] || 'Khác';
    if (!ed.split.has(id)) { articles.push({ slug: id, cat, title: strip(title), html: body, ids: [id] }); continue; }
    for (const [, a2, t2, b2] of body.matchAll(/<h3([^>]*)>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3|$)/g)) {
      const id2 = a2.match(/id="([^"]+)"/)?.[1] || slug(strip(t2));
      articles.push({ slug: id2, cat, title: strip(t2), html: b2, ids: [id2] });
    }
  }
  if (slugs) { if (slugs.length !== articles.length) throw new Error('The two manuals no longer have the same parts'); articles.forEach((a, i) => { a.ids.push(a.slug); a.slug = slugs[i]; }); }
  // Anchors inside each article (h3, h4 ids) lead to it: a link "#menu-cot" becomes "#help/workspace".
  for (const a of articles) for (const [, id] of a.html.matchAll(/ id="([^"]+)"/g)) a.ids.push(id);
  const owner = (id) => articles.find((a) => a.ids.includes(id))?.slug;
  fs.mkdirSync(ed.img, { recursive: true });
  const used = new Set();
  const out = articles.map(({ slug: s, cat, title, html: body }) => ({
    slug: s, cat, title: title.replace(/^\d+(\.\d+)*\.\s*/, ''),
    html: body
      .replace(/<figure data-shot="([^"]+)"><\/figure>/g, (_, shot) => {
        const def = ed.shot(shot);
        if (!def || !fs.existsSync(path.join(ed.shots, `${shot}.png`))) return '';
        used.add(shot);
        return `<figure><img src="${ed.url}/${shot}.jpg" alt="${def.title}" loading="lazy"><figcaption><b>${def.title}</b><ol>${def.notes.map((t) => `<li>${t}</li>`).join('')}</ol></figcaption></figure>`;
      })
      .replace(/href="#([^"]+)"/g, (m, id) => (owner(id) ? `href="#help/${owner(id)}"` : m))
      .replace(/\n\s*\n/g, '\n').trim(),
  }));
  for (const shot of used) execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '72', '--resampleWidth', '1400', path.join(ed.shots, `${shot}.png`), '--out', path.join(ed.img, `${shot}.jpg`)], { stdio: 'ignore' });
  console.log(`${ed.src}: ${out.length} articles, ${used.size} pictures`);
  return out;
}
const vi = build(EDITIONS.vi), en = build(EDITIONS.en, vi.map((a) => a.slug));
const head = (lang) => `// Made by scripts/guide/help.mjs from the user manual (${lang}): edit the manual, then run it again.\nimport type { Article } from './types';\n\n`;
fs.writeFileSync('web/src/help/manual.ts', `${head('Vietnamese')}export const MANUAL: Article[] = ${JSON.stringify(vi, null, 1)};\n`);
fs.writeFileSync('web/src/help/manual-en.ts', `${head('English')}export const MANUAL_EN: Article[] = ${JSON.stringify(en, null, 1)};\n`);
