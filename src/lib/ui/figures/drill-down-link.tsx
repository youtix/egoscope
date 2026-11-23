import { formatGap } from '@/lib/wording';

import { TextLink } from '../link-button';

import type { Href } from '../link-button';
import type { ReactNode } from 'react';

export type DrillDownLinkProps<T extends string> = Readonly<{
  /** A normalized gap or a mean gap. */
  gap: number;
  /** The screen of the numbers it is made of: a case's page for a gap, the case list for a mean. */
  href: Href<T>;
}>;

/**
 * A gap written with its sign and two decimals, as a link to the numbers it is made
 * of, from which the owner goes on to the sources of the event (IHM-52, D-05).
 */
export function DrillDownLink<T extends string>({ gap, href }: DrillDownLinkProps<T>): ReactNode {
  return (
    <span className="tabular-nums">
      <TextLink href={href} label={formatGap(gap)} />
    </span>
  );
}
