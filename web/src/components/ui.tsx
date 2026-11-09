// Small Apple-style UI kit: SF-Symbols-like icons, segmented control, switch, grouped lists, pop-up button.
import { useEffect, useRef, useState, type ReactNode } from 'react';

const P: Record<string, ReactNode> = {
  edit:<path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14Z"/>,
  underline: <path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14" />,
  strike: <path d="M4 12h16M16.5 7.5A3.8 3.8 0 0 0 12.5 5h-1a3.5 3.5 0 0 0-1 6.9M8 16.5A3.9 3.9 0 0 0 11.8 19h.8a3.5 3.5 0 0 0 3.3-4.6" />,
  quote: <path d="M5 17.5c2.5-1 3.5-3 3.5-5.5H5V6.5h5V12c0 3.6-1.6 6.1-4.4 7ZM14 17.5c2.5-1 3.5-3 3.5-5.5H14V6.5h5V12c0 3.6-1.6 6.1-4.4 7Z" />,
  align: <path d="M4 6h16M4 10.5h10M4 15h16M4 19.5h10" />,
  alignCenter: <path d="M4 6h16M7 10.5h10M4 15h16M7 19.5h10" />,
  alignRight: <path d="M4 6h16M10 10.5h10M4 15h16M10 19.5h10" />,
  alignJustify: <path d="M4 6h16M4 10.5h16M4 15h16M4 19.5h16" />,
  link: <path d="M10.5 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M13.5 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  clear: <path d="M6 5h12M12 5l-3 14M15 15l5 5M20 15l-5 5" />,
  note: <><path d="M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5l-6 6H5A1.5 1.5 0 0 1 3.5 19V6A1.5 1.5 0 0 1 5 4.5Z" /><path d="M14.5 20.5v-4.5a1.5 1.5 0 0 1 1.5-1.5h4.5M7.5 9h9M7.5 12.5h5" /></>,
  bold: <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7Zm0 7h7a3.5 3.5 0 0 1 0 7H7Z" />,
  italic: <path d="M10 5h8M6 19h8M14 5l-4 14" />,
  code: <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 6l-3 12" />,
  olist: <path d="M10 7h10M10 12h10M10 17h10M4 6l1.5-1v4M3.8 13.2a1.2 1.2 0 1 1 2 1L3.8 16h2.4" />,
 bell:<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
  mail:<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/></>,
  phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92Z" />,
  chat: <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />,
  messenger: <path d="M12 2C6.477 2 2 6.145 2 11.258c0 2.914 1.455 5.518 3.734 7.135-.147.88-.707 2.673-1.935 3.766a.35.35 0 0 0 .285.584c2.25 0 4.295-1.12 5.377-1.802.822.228 1.688.355 2.539.355 5.523 0 10-4.145 10-9.258C22 6.145 17.523 2 12 2zm1.18 12.355-2.668-2.846-5.205 2.846 5.727-6.079 2.734 2.846 5.139-2.846-5.727 6.079z" fill="currentColor" stroke="none" />,
  minus: <path d="M5 12h14" />,
  play: <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor" stroke="none" />,
  pause: <><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none" /><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none" /></>,
  back: <><path d="M11 7 6 12l5 5" /><path d="M18 7l-5 5 5 5" /></>,
  fwd: <><path d="m13 7 5 5-5 5" /><path d="m6 7 5 5-5 5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  sparkle: <path d="M12 3.5c.5 3.9 2.6 6 6.5 6.5-3.9.5-6 2.6-6.5 6.5-.5-3.9-2.6-6-6.5-6.5 3.9-.5 6-2.6 6.5-6.5ZM18.5 15.5c.2 1.4.9 2.1 2.3 2.3-1.4.2-2.1.9-2.3 2.3-.2-1.4-.9-2.1-2.3-2.3 1.4-.2 2.1-.9 2.3-2.3Z" fill="currentColor" stroke="none" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
  folder: <path d="M3.5 7.5a2 2 0 0 1 2-2h3.6l2 2.2h7.4a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />,
  share: <><path d="M12 15V3.5M8 7.5l4-4 4 4" /><path d="M7 10.5H6a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6.5a2 2 0 0 0-2-2h-1" /></>,
  trash: <><path d="M4.5 6.5h15M9.5 6.5V4.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3v1.7" /><path d="m6.5 6.5.8 12.2a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8l.8-12.2" /></>,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2.2" /><path d="M15.5 8.5V6.7a2.2 2.2 0 0 0-2.2-2.2H6.7a2.2 2.2 0 0 0-2.2 2.2v6.6c0 1.2 1 2.2 2.2 2.2h1.8" /></>,
  up: <path d="m6 14 6-6 6 6" />,
  down: <path d="m6 10 6 6 6-6" />,
  more: <><circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none" /></>,
  left: <path d="m14.5 6-6 6 6 6" />,
  right: <path d="m9.5 6 6 6-6 6" />,
  chevron: <path d="m7 10 5 5 5-5" />,
  send: <path d="M12 19V5M6 11l6-6 6 6" />,
  cc: <><rect x="3" y="5.5" width="18" height="13" rx="3" /><path d="M10.5 10.3a2.3 2.3 0 1 0 0 3.4M17 10.3a2.3 2.3 0 1 0 0 3.4" /></>,
  music: <><path d="M9 18V6.5l11-2V16" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></>,
  badge: <><path d="M12 3.5 14.3 5l2.7-.1.9 2.6 2.2 1.6-.8 2.6.8 2.6-2.2 1.6-.9 2.6-2.7-.1L12 20.5 9.7 19l-2.7.1-.9-2.6-2.2-1.6.8-2.6-.8-2.6 2.2-1.6.9-2.6 2.7.1Z" /><path d="m9 12 2 2 4-4" /></>,
  film: <><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M7.5 4.5v15M16.5 4.5v15M3.5 9.5h4M3.5 14.5h4M16.5 9.5h4M16.5 14.5h4" /></>,
  photo: <><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><circle cx="9" cy="10" r="1.8" /><path d="m20.5 16-5-5-8.5 8.5" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  wand: <><path d="m4 20 11-11M14 4v3M19.5 9.5h-3M17.7 6.3l-2.1 2.1M11 3.5v1.5M20 13v1.5" /><path d="m13 7 4 4" /></>,
  text: <><path d="M5 6.5V5h14v1.5M12 5v14M9 19h6" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2" /></>,
  download: <><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>,
  moon: <path d="M19.5 14.2A7.8 7.8 0 0 1 9.8 4.5a7.8 7.8 0 1 0 9.7 9.7Z" />,
  monitor: <><rect x="3" y="4.5" width="18" height="12" rx="2" /><path d="M9 20h6M12 16.5V20" /></>,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1.6" /><rect x="13" y="4" width="7" height="7" rx="1.6" /><rect x="4" y="13" width="7" height="7" rx="1.6" /><rect x="13" y="13" width="7" height="7" rx="1.6" /></>,
  car: <><path d="M5 16.5v-4l1.8-4.6A2 2 0 0 1 8.7 6.5h6.6a2 2 0 0 1 1.9 1.4L19 12.5v4" /><path d="M3.5 12.5h17v4h-17Z" /><circle cx="7.5" cy="17.5" r="1.6" /><circle cx="16.5" cy="17.5" r="1.6" /></>,
  refresh: <><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 4.5v4h-4" /></>,
  layers: <><path d="m12 4 8.5 4.5L12 13 3.5 8.5Z" /><path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5" /></>,
  // Workspace boards and cards
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  comment: <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V16.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5Z" />,
  clip: <path d="m20 11.5-7.8 7.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />,
  checklist: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
  tag: <><path d="M3.5 12.6V5a1.5 1.5 0 0 1 1.5-1.5h7.6a1.5 1.5 0 0 1 1 .4l7 7a1.5 1.5 0 0 1 0 2.1l-7.6 7.6a1.5 1.5 0 0 1-2.1 0l-7-7a1.5 1.5 0 0 1-.4-1Z" /><circle cx="8" cy="8" r="1.4" /></>,
  user: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 19.5a7 7 0 0 1 14 0" /></>,
  eye: <><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></>,
  eyeOff: <><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /><path d="M4 4l16 16" /></>,
  archive: <><rect x="3.5" y="4.5" width="17" height="4" rx="1" /><path d="M5 8.5v9.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V8.5M10 12.5h4" /></>,
  filter: <path d="M4 5.5h16l-6.2 7.3v5.4l-3.6 1.8v-7.2Z" />,
  cover: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M3.5 10h17" /></>,
  lines: <path d="M5 7h14M5 12h14M5 17h9" />,
  activity: <path d="M5 6.5h14M5 12h14M5 17.5h14M3 6.5h.01M3 12h.01M3 17.5h.01" />,
  star: <path d="m12 3.8 2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.8l-5.1 2.7 1-5.7-4.1-4 5.7-.8Z" />,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 8h.01" /></>,
  card: <><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M7 9.5h6M7 13h9" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  expand: <path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" />,
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  inbox: <><rect x="3.5" y="4" width="17" height="16" rx="2.5" /><path d="M3.5 13.5h4.8l1.4 2.5h4.6l1.4-2.5h4.8" /></>,
  boards: <><rect x="3.5" y="4" width="17" height="16" rx="2.5" /><path d="M9.5 4v16M15 4v10" /></>,
  collapse: <path d="M9 5 4 12l5 7M15 5l5 7-5 7" />,
  users: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3 19.5a6 6 0 0 1 12 0M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14a6 6 0 0 1 3.5 5.5" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" /></>,
  list: <path d="M8.5 6.5H20M8.5 12H20M8.5 17.5H20M4 6.5h.01M4 12h.01M4 17.5h.01" />,
  // Files on Drive, by kind
  file: <><path d="M7 3.5h7l4.5 4.5v11.5a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 7 3.5Z" /><path d="M13.5 3.5v5h5" /></>,
  doc: <><path d="M7 3.5h7l4.5 4.5v11.5a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 7 3.5Z" /><path d="M13.5 3.5v5h5M8.5 12.5h7M8.5 16h7" /></>,
  sheet: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 9.5h16M4 14.5h16M10 9.5V20" /></>,
  slides: <><rect x="3.5" y="5" width="17" height="12" rx="1.5" /><path d="M12 17v3.5M8.5 20.5h7" /></>,
  zip: <><path d="M7 3.5h7l4.5 4.5v11.5a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 7 3.5Z" /><path d="M11 3.5v2M11 7.5v2M11 11.5v2M10 15.5h2v2.5h-2Z" /></>,
};

export function Icon({ name, size = 18, className = '' }: { name: keyof typeof P | string; size?: number; className?: string }) {
  return (
    <svg className={'ico ' + className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name]}
    </svg>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, full, small, ariaLabel }: {
  value: T; options: [T, ReactNode][]; onChange: (v: T) => void; full?: boolean; small?: boolean; ariaLabel?: string;
}) {
  const idx = Math.max(0, options.findIndex(([v]) => v === value));
  return (
    <div className={'segmented' + (full ? ' full' : '') + (small ? ' small' : '')} role="radiogroup" aria-label={ariaLabel}
      style={{ ['--n' as any]: options.length, ['--i' as any]: idx }}>
      <span className="seg-thumb" />
      {options.map(([v, label]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; id?: string }) {
  return (
    <label className="switch-row">
      {label && <span>{label}</span>}
      <span className="switch">
        <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="knob" />
      </span>
    </label>
  );
}

export function Group({ title, action, children, footer, className = '' }: { title?: ReactNode; action?: ReactNode; children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <section className={'group ' + className}>
      {(title || action) && <header className="group-h"><span>{title}</span>{action}</header>}
      <div className="group-body">{children}</div>
      {footer && <p className="group-foot">{footer}</p>}
    </section>
  );
}

export function Row({ label, icon, children, stacked }: { label: ReactNode; icon?: string; children: ReactNode; stacked?: boolean }) {
  return (
    <div className={'row-item' + (stacked ? ' stacked' : '')}>
      <span className="row-label">{icon && <Icon name={icon} size={16} />}{label}</span>
      <div className="row-ctl">{children}</div>
    </div>
  );
}

/** Native <select> dressed as a macOS pop-up button. */
export function Popup({ value, onChange, children, title, id, className = '', disabled }: { value: string | number; onChange: (v: string) => void; children: ReactNode; title?: string; id?: string; className?: string; disabled?: boolean }) {
  return (
    <span className={'popup ' + className}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} title={title} disabled={disabled}>{children}</select>
      <Icon name="chevron" size={14} />
    </span>
  );
}

export function IconButton({ icon, label, onClick, disabled, active, danger, size = 18, className = '', id }: {
  icon: string; label: string; onClick?: () => void; disabled?: boolean; active?: boolean; danger?: boolean; size?: number; className?: string; id?: string;
}) {
  return (
    <button id={id} type="button" className={'icon-btn' + (active ? ' active' : '') + (danger ? ' danger' : '') + ' ' + className} onClick={onClick} disabled={disabled} title={label} aria-label={label} aria-pressed={active}>
      <Icon name={icon} size={size} />
    </button>
  );
}

export interface MenuItem { label: string; icon?: string; onClick?: () => void; href?: string; danger?: boolean; hidden?: boolean }
/** "⋯" button with a macOS-style pop-up menu; secondary actions live here so each area keeps one visible button. */
export function Menu({ items, label = 'Thêm', className = '', size = 17 }: { items: MenuItem[]; label?: string; className?: string; size?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: Event) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', off); document.addEventListener('keydown', off);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', off); };
  }, [open]);
  const shown = items.filter((i) => !i.hidden);
  if (!shown.length) return null;
  return (
    <div className={'menu ' + className} ref={ref}>
      <IconButton icon="more" label={label} size={size} active={open} onClick={() => setOpen(!open)} />
      {open && (
        <div className="menu-pop" role="menu">
          {shown.map((i) => {
            const body = <>{i.icon && <Icon name={i.icon} size={15} />}{i.label}</>;
            const cls = i.danger ? 'danger' : '';
            return i.href
              ? <a key={i.label} role="menuitem" className={cls} href={i.href} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>{body}</a>
              : <button key={i.label} role="menuitem" className={cls} onClick={() => { setOpen(false); i.onClick?.(); }}>{body}</button>;
          })}
        </div>
      )}
    </div>
  );
}
