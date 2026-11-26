import { Card } from '@/lib/ui';

import type { ReactElement, ReactNode } from 'react';

/** One fact of a case: its label, plain or a glossary term that opens its definition, and its value. */
export type Fact = Readonly<{ key: string; term: ReactNode; details: ReactNode }>;

/** The one fact of `value` when there is one, written by `write`, and none otherwise. */
export function factOf<T>(
  head: Readonly<{ key: string; term: ReactNode }>,
  value: T | null,
  write: (shown: T) => ReactElement | string,
): readonly Fact[] {
  return value === null ? [] : [{ ...head, details: write(value) }];
}

/**
 * The facts of a part of a case, laid out as the design system's definition list lays
 * out a record (IHM-60): each label above its value on a phone, beside it on a wide
 * screen, with values that wrap. A label may be a glossary term, which the definition
 * list does not take (IHM-15).
 */
export function Facts({ facts }: Readonly<{ facts: readonly Fact[] }>): ReactNode {
  return (
    <dl className="flex flex-col gap-3">
      {facts.map((fact) => (
        <div
          key={fact.key}
          className="flex flex-col gap-0.5 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-4"
        >
          <dt className="text-sm font-medium text-ink-muted sm:text-base">{fact.term}</dt>
          <dd className="flex min-w-0 flex-col gap-1">{fact.details}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A part of the case block, a region named by its heading, which screen readers jump to (IHM-61). */
export function Part({
  name,
  children,
}: Readonly<{ name: string; children: ReactNode }>): ReactNode {
  return <section aria-label={name}>{children}</section>;
}

/** The heading of a part whose label is a glossary term, styled as a card's title (IHM-15, IHM-61). */
export function TermHeading({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  return <h2 className="text-lg leading-snug font-semibold">{children}</h2>;
}

/** The heading of a group inside a part whose label is a glossary term. */
export function TermSubheading({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  return <h3 className="text-base leading-snug font-semibold">{children}</h3>;
}

/** A part of the case block titled by a plain label: a card in a region of the same name (IHM-61). */
export function NamedCard({
  title,
  children,
}: Readonly<{ title: string; children: ReactNode }>): ReactNode {
  return (
    <Part name={title}>
      <Card title={title}>{children}</Card>
    </Part>
  );
}
