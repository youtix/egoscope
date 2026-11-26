import { LinkButton } from '@/lib/ui';

import type { MoreMenuEntry, NavigationLink } from '@/lib/navigation';
import type { ReactNode } from 'react';

export type MoreMenuProps = Readonly<{
  /** The entries that the active lot serves, from `moreMenuEntries()`. */
  entries: readonly NavigationLink<MoreMenuEntry>[];
}>;

/** The More menu: one link per screen that the navigation bar does not hold (IHM-16). */
export function MoreMenu({ entries }: MoreMenuProps): ReactNode {
  return (
    <ul className="flex flex-col gap-3">
      {entries.map(({ entry, href, label }) => (
        <li key={entry} className="flex flex-col">
          <LinkButton href={href} label={label} />
        </li>
      ))}
    </ul>
  );
}
