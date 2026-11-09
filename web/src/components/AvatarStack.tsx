import type { ReactNode } from 'react';

type Person = { id: string; name: string };
/** People as a row of avatars. Past `max`, the first ones stay and the rest fold into ⋮ (or `+N` with `count`);
 *  hovering (or focusing) the row opens all of them over what is around it, so the layout never moves. `align` is the
 *  side the open row grows from. */
export function AvatarStack<P extends Person>({ people, max = 3, render, align = 'left', focusable = true, className = '', count = false, expandOnHover = true }: {
  people: P[]; max?: number; render: (p: P) => ReactNode; align?: 'left' | 'right'; focusable?: boolean; className?: string; count?: boolean; expandOnHover?: boolean;
}) {
  if (people.length <= max) return <span className={`av-stack ${className}`}>{people.map(render)}</span>;
  const names = people.map((p) => p.name).join(', ');
  return (
    <span className={`av-stack folded ${align} ${className}`} title={names} aria-label={names} tabIndex={focusable ? 0 : undefined}>
      {people.slice(0, max - 1).map(render)}
      <span className={'av-dots' + (count ? ' count' : '')} aria-hidden="true" title={count ? people.slice(max - 1).map((p) => p.name).join(', ') : undefined}>{count ? `+${people.length - max + 1}` : '⋮'}</span>
      {expandOnHover && <span className="av-all" aria-hidden="true">{people.map(render)}</span>}
    </span>
  );
}
