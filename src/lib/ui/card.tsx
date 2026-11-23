import { Heading } from './heading';

import type { HeadingLevel } from './heading';
import type { ReactNode } from 'react';

export type CardProps = Readonly<{
  title?: string;
  /** The level of the title in the screen's outline. */
  headingLevel?: HeadingLevel;
  children: ReactNode;
  /** The card's actions, under its content. */
  actions?: ReactNode;
}>;

/**
 * A block of related content on a raised surface, such as one block of a player's
 * page (IHM-22), titled so that screen readers can jump between blocks (IHM-61).
 */
export function Card({ title, headingLevel = 'h2', children, actions }: CardProps): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-xl border border-line bg-surface p-4 sm:p-6">
      {title !== undefined && (
        <Heading level={headingLevel} className="text-lg leading-snug font-semibold">
          {title}
        </Heading>
      )}
      {children}
      {actions !== undefined && <div className="flex flex-wrap gap-3">{actions}</div>}
    </div>
  );
}
