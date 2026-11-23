import type { ReactNode } from 'react';

/** One fact of a record: its term, and its value as the screen wrote it. */
export type DefinitionItem = Readonly<{ term: string; details: ReactNode }>;

export type DefinitionListProps = Readonly<{
  /** The facts, each term once. */
  items: readonly DefinitionItem[];
}>;

/**
 * The facts of a record page, such as a player's or an event's: each term above
 * its value on a phone, beside it on a wide screen, with values that wrap and are
 * never cut (IHM-60).
 */
export function DefinitionList({ items }: DefinitionListProps): ReactNode {
  return (
    <dl className="flex flex-col gap-3">
      {items.map((item) => (
        <div
          key={item.term}
          className="flex flex-col gap-0.5 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-4"
        >
          <dt className="text-sm font-medium text-ink-muted sm:text-base">{item.term}</dt>
          <dd className="min-w-0">{item.details}</dd>
        </div>
      ))}
    </dl>
  );
}
