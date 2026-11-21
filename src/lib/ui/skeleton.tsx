import type { ReactNode } from 'react';

// The widths of the placeholder lines, from the first: uneven, as text is, and
// each its own, so that it also names its line.
const LINE_WIDTHS = ['w-full', 'w-11/12', 'w-4/5', 'w-5/6', 'w-3/4', 'w-2/3'] as const;

/** How many lines of text the placeholder stands for. */
export type SkeletonLines = 1 | 2 | 3 | 4 | 5 | 6;

export type SkeletonProps = Readonly<{
  /** What is loading, which screen readers say, such as "Loading the players". */
  label: string;
  lines?: SkeletonLines;
}>;

/**
 * The placeholder of content that is loading: lines of the height of text, which
 * grow with the phone's text size, so the content takes their place without moving
 * the page (IHM-60). Screen readers say what is loading.
 */
export function Skeleton({ label, lines = 3 }: SkeletonProps): ReactNode {
  return (
    <div role="status" className="flex flex-col gap-2">
      <span className="sr-only">{label}</span>
      {LINE_WIDTHS.slice(0, lines).map((width) => (
        <span
          key={width}
          aria-hidden="true"
          className={`block h-[1lh] animate-pulse rounded-md bg-surface-muted ${width}`}
        />
      ))}
    </div>
  );
}
