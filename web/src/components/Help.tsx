// Trợ giúp, like Bizfly's help centre: the groups of articles down the left (found by a search over titles and text),
// the article on the right with where it sits, and the one before and after. Each article has its own address
// (#help/<slug>), so a link to it can be shared or opened from a page (Tự động hoá's "Hướng dẫn" buttons).
import { useEffect, useMemo, useRef, useState } from 'react';
import { openLink } from '../store';
import { Icon } from './ui';
import { helpFor } from '../help';
import { langPref } from '../i18n';

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
/** Trợ giúp is written in both languages: the page shows the interface's own (and keeps the app's word-by-word
 *  translation out of it). */
const EN = langPref() === 'en';
const { articles: ARTICLES, groups: GROUPS } = await helpFor(EN ? 'en' : 'vi');
const T = EN
  ? { help: 'Help', sub: 'How to use DMI Workspace', find: 'Search the guide…', clear: 'Clear search', none: 'No article found.', contents: 'Contents', where: 'Where you are', prev: 'Previous', next: 'Next' }
  : { help: 'Trợ giúp', sub: 'Hướng dẫn sử dụng DMI Workspace', find: 'Tìm trong hướng dẫn…', clear: 'Xoá tìm kiếm', none: 'Không tìm thấy bài nào.', contents: 'Mục lục', where: 'Vị trí', prev: 'Bài trước', next: 'Bài tiếp' };
const slugOf = () => decodeURIComponent(location.hash.replace(/^#help\/?/, '').split(/[?#]/)[0] || '');

export function HelpPage() {
  const [slug, setSlug] = useState(slugOf), [q, setQ] = useState(''), [menu, setMenu] = useState(false);
  const main = useRef<HTMLElement>(null);
  useEffect(() => { const on = () => { setSlug(slugOf()); setMenu(false); }; window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  const at = Math.max(0, ARTICLES.findIndex((a) => a.slug === slug)), a = ARTICLES[at];
  useEffect(() => { main.current?.scrollTo(0, 0); }, [a.slug]);
  const plain = useMemo(() => new Map(ARTICLES.map((x) => [x.slug, fold(text(x.html))])), []);
  const words = fold(q).split(/\s+/).filter(Boolean);
  const hits = words.length ? ARTICLES.filter((x) => words.every((w) => fold(x.title).includes(w) || plain.get(x.slug)!.includes(w))) : [];
  const snippet = (slugX: string) => { const t = text(ARTICLES.find((x) => x.slug === slugX)!.html), i = fold(t).indexOf(words[0] || ''); return (i > 40 ? '…' : '') + t.slice(Math.max(0, i - 40), i + 110) + '…'; };
  const go = (s: string) => { setQ(''); openLink(`#help/${s}`); };
  const prev = ARTICLES[at - 1], next = ARTICLES[at + 1];
  return (
    <div className="hp no-i18n" lang={EN ? 'en' : 'vi'}>
      <aside className={'hp-side' + (menu ? ' open' : '')}>
        <header><h1><Icon name="info" size={18} />{T.help}</h1><p>{T.sub}</p></header>
        <label className="hp-search"><Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={T.find} aria-label={T.find} />{q && <button type="button" onClick={() => setQ('')} aria-label={T.clear}><Icon name="x" size={12} /></button>}</label>
        {words.length ? (
          <ul className="hp-hits">{hits.length ? hits.map((x) => (
            <li key={x.slug}><button type="button" onClick={() => go(x.slug)}><b>{x.title}</b><small>{x.cat}</small><span>{snippet(x.slug)}</span></button></li>
          )) : <li className="hp-none">{T.none}</li>}</ul>
        ) : (
          <nav className="hp-nav">{GROUPS.map((g) => (
            <section key={g.title}>
              <h2>{g.title}</h2>
              <ul>{g.articles.map((x) => <li key={x.slug}><a href={`#help/${x.slug}`} aria-current={x.slug === a.slug ? 'page' : undefined}>{x.title}</a></li>)}</ul>
            </section>
          ))}</nav>
        )}
      </aside>
      <main className="hp-main" ref={main}>
        <button type="button" className="hp-menu" onClick={() => setMenu(!menu)} aria-expanded={menu}><Icon name="lines" size={16} />{T.contents}</button>
        <nav className="hp-crumbs" aria-label={T.where}><a href="#help">{T.help}</a><Icon name="right" size={12} /><span>{a.cat}</span></nav>
        <article className="hp-article">
          <h1>{a.title}</h1>
          <div dangerouslySetInnerHTML={{ __html: a.html }} />
        </article>
        <footer className="hp-pager">
          {prev ? <a href={`#help/${prev.slug}`}><small>{T.prev}</small><b>‹ {prev.title}</b></a> : <span />}
          {next ? <a href={`#help/${next.slug}`} className="next"><small>{T.next}</small><b>{next.title} ›</b></a> : <span />}
        </footer>
      </main>
    </div>
  );
}
