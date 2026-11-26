'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense } from 'react';

import { Badge } from '@/lib/ui';
import { formatCount, sentence } from '@/lib/wording';

import type { NavigationEntry, NavigationLink } from './entries';
import type { ReactNode } from 'react';

export type NavigationBarProps = Readonly<{
  /** The entries that the active lot serves, from `navigationEntries()`. */
  entries: readonly NavigationLink<NavigationEntry>[];
  /** The number of items to do, which the Home entry carries; null while unknown. */
  todoCount: number | null;
}>;

type EntryListProps = NavigationBarProps & Readonly<{ currentHref: string | null }>;

const HOME = '/';

/** Whether the screen at `pathname` belongs to the entry that leads to `href`. */
function isCurrent(href: string, pathname: string): boolean {
  return href === HOME ? pathname === HOME : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The count on the Home entry, which screen readers say in words after the entry's label,
 * a space apart (IHM-16, IHM-61).
 */
function TodoBadge({ count }: Readonly<{ count: number }>): ReactNode {
  const written = formatCount(count);
  return (
    <>
      {' '}
      <Badge label={written} spokenLabel={sentence('interface.todoCount', { n: written })} />
    </>
  );
}

/** The entries of the bar, the one that leads to `currentHref`, if any, marked as current. */
function EntryList({ entries, todoCount, currentHref }: EntryListProps): ReactNode {
  return (
    <ul className="flex lg:flex-col lg:gap-1 lg:p-3">
      {entries.map(({ entry, href, label }) => {
        const isCurrentEntry = href === currentHref;
        return (
          <li key={entry} className="min-w-0 flex-1 lg:flex-none">
            <Link
              href={href}
              aria-current={isCurrentEntry ? 'page' : undefined}
              className={`flex min-h-touch flex-wrap items-center justify-center gap-1 border-t-4 px-1 py-2 text-center text-sm wrap-anywhere lg:justify-start lg:border-t-0 lg:border-l-4 lg:px-3 lg:text-left lg:text-base ${
                isCurrentEntry
                  ? 'border-accent font-semibold text-ink'
                  : 'border-transparent text-ink-muted'
              }`}
            >
              {label}
              {entry === 'home' && todoCount !== null && <TodoBadge count={todoCount} />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** The entries, the one of the screen shown marked, once the address is known. */
function CurrentEntryList({ entries, todoCount }: NavigationBarProps): ReactNode {
  const pathname = usePathname();
  const current = entries.find(({ href }) => isCurrent(href, pathname));
  return <EntryList entries={entries} todoCount={todoCount} currentHref={current?.href ?? null} />;
}

/**
 * The permanent navigation bar (IHM-16): at the bottom of the screen on a phone, within a
 * thumb's reach, and on the side on a large screen (IHM-01). The entry of the current
 * screen says so to screen readers and stands out by its weight and its bar, not by its
 * color alone (IHM-61); the Home entry carries the number of items to do. A screen whose
 * address is only known at request time shows the entries unmarked until it is.
 */
export function NavigationBar({ entries, todoCount }: NavigationBarProps): ReactNode {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:inset-y-0 lg:right-auto lg:w-56 lg:border-t-0 lg:border-r lg:pb-0">
      <Suspense fallback={<EntryList entries={entries} todoCount={todoCount} currentHref={null} />}>
        <CurrentEntryList entries={entries} todoCount={todoCount} />
      </Suspense>
    </nav>
  );
}
