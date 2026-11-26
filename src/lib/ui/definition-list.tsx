import type { ReactNode } from 'react';

/**
 * One fact of a record: its term, and its value as the screen wrote it. A term that is
 * not a text, such as the GlossaryTerm of a term's first label on the screen (IHM-15),
 * comes with the text that keys it.
 */
export type DefinitionItem =
  | Readonly<{ term: string; details: ReactNode }>
  | Readonly<{ term: ReactNode; key: string; details: ReactNode }>;

export type DefinitionListProps = Readonly<{
  /** The facts, each term once. */
  items: readonly DefinitionItem[];
}>;

/** The key of a fact: its term, or the text that keys a term that is not a text. */
const keyOf = (item: DefinitionItem): string => ('key' in item ? item.key : item.term);

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
          key={keyOf(item)}
          className="flex flex-col gap-0.5 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-4"
        >
          <dt className="text-sm font-medium text-ink-muted sm:text-base">{item.term}</dt>
          <dd className="min-w-0">{item.details}</dd>
        </div>
      ))}
    </dl>
  );
}
