import { LinkButton } from './link-button';

import type { Href } from './link-button';
import type { ReactNode } from 'react';

/** A link to a neighboring slice of a list. */
export type PageLink<T extends string> = Readonly<{ href: Href<T>; label: string }>;

export type PaginationProps<P extends string, N extends string> = Readonly<{
  /** What the links move through, which names their navigation for screen readers. */
  label: string;
  /** Where the list stands, as the wording module wrote it, such as "Page 2 of 5". */
  status: string;
  /** The previous slice; none on the first. */
  previous?: PageLink<P>;
  /** The next slice; none on the last. */
  next?: PageLink<N>;
}>;

/**
 * The move between the slices of a long list (IHM-18): links to the previous and
 * the next slice around where the list stands. Each keeps its place when the
 * other is missing, so the page does not move between slices, and the three wrap
 * under one another when the text is large (IHM-60).
 */
export function Pagination<P extends string, N extends string>({
  label,
  status,
  previous,
  next,
}: PaginationProps<P, N>): ReactNode {
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-touch">
        {previous !== undefined && <LinkButton href={previous.href} label={previous.label} />}
      </div>
      <p className="text-center text-ink-muted">{status}</p>
      <div className="min-w-touch">
        {next !== undefined && <LinkButton href={next.href} label={next.label} />}
      </div>
    </nav>
  );
}
