import { Heading } from './heading';

import type { HeadingLevel } from './heading';
import type { ReactNode } from 'react';

export type EmptyStateProps = Readonly<{
  /** What is missing, such as "No player followed yet". */
  title: string;
  /** Why the list or the block is empty (IHM-56). */
  reason: string;
  /** The action that fills it, such as a link button to add a player (IHM-54 to IHM-56). */
  action?: ReactNode;
  /** The level of the title in the screen's outline. */
  headingLevel?: HeadingLevel;
}>;

/**
 * What a list or a block shows when it holds nothing: what is missing, why, and
 * the action that fills it, for an empty state always says both (IHM-56).
 */
export function EmptyState({
  title,
  reason,
  action,
  headingLevel = 'h2',
}: EmptyStateProps): ReactNode {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border-2 border-dashed border-line p-6">
      <Heading level={headingLevel} className="text-lg leading-snug font-semibold">
        {title}
      </Heading>
      <p className="text-ink-muted">{reason}</p>
      {action}
    </div>
  );
}
