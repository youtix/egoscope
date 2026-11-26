'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import { Badge } from '@/lib/ui';
import { formatCount, sentence } from '@/lib/wording';

import type { NavigationEntry, NavigationLink } from './entries';
import type { ReactNode } from 'react';

export type NavigationBarProps = Readonly<{
  /** The entries that the active lot serves, from `navigationEntries()`. */
  entries: readonly NavigationLink<NavigationEntry>[];
  /** The number of items to do, which the Home entry carries; null while unknown. */
  todoCount: number | null;
  /**
   * The Server Action that gives the number of items to do now, or none, which the bar
   * calls once each time the owner moves to another screen (IHM-16). Without it, the bar
   * keeps `todoCount`.
   */
  readTodoCount?: (() => Promise<number | null>) | undefined;
}>;

type EntryListProps = Readonly<{
  entries: NavigationBarProps['entries'];
  todoCount: number | null;
  currentHref: string | null;
}>;

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

/** The count that `read` gives, or none when the call fails, offline for instance. */
async function countOrNone(read: () => Promise<number | null>): Promise<number | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

/**
 * The number of items to do on the screen at `pathname`: the server's `todoCount` on the
 * screen that it was read with, then the one that `readTodoCount` gives once after each
 * move to another screen, never on a timer (IHM-16, module map section 3.1); a call that
 * fails leaves none, and the answer of a call that a later move outran is dropped. A new
 * count from the server, after an action, wins over a read one.
 */
function useCountOfScreen(
  pathname: string,
  todoCount: number | null,
  readTodoCount: NavigationBarProps['readTodoCount'],
): number | null {
  /** A count read after a move to another screen, over the count that the server gave. */
  type FreshCount = Readonly<{ count: number | null; over: number | null }>;
  const [fresh, setFresh] = useState<FreshCount | null>(null);
  const readForRef = useRef(pathname);
  useEffect(() => {
    let isLatest = true;
    const read = async (action: () => Promise<number | null>) => {
      const count = await countOrNone(action);
      if (isLatest) {
        setFresh({ count, over: todoCount });
      }
    };
    if (readTodoCount !== undefined && readForRef.current !== pathname) {
      readForRef.current = pathname;
      void read(readTodoCount);
    }
    return () => {
      isLatest = false;
    };
  }, [pathname, readTodoCount, todoCount]);
  return fresh !== null && fresh.over === todoCount ? fresh.count : todoCount;
}

/** The entries, the one of the screen shown marked, once the address is known. */
function CurrentEntryList({ entries, todoCount, readTodoCount }: NavigationBarProps): ReactNode {
  const pathname = usePathname();
  const count = useCountOfScreen(pathname, todoCount, readTodoCount);
  const current = entries.find(({ href }) => isCurrent(href, pathname));
  return <EntryList entries={entries} todoCount={count} currentHref={current?.href ?? null} />;
}

/**
 * The permanent navigation bar (IHM-16): at the bottom of the screen on a phone, within a
 * thumb's reach, and on the side on a large screen (IHM-01). The entry of the current
 * screen says so to screen readers and stands out by its weight and its bar, not by its
 * color alone (IHM-61); the Home entry carries the number of items to do, read again at
 * each move to another screen when `readTodoCount` is given. A screen whose address is
 * only known at request time shows the entries unmarked until it is.
 */
export function NavigationBar({
  entries,
  todoCount,
  readTodoCount,
}: NavigationBarProps): ReactNode {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:inset-y-0 lg:right-auto lg:w-56 lg:border-t-0 lg:border-r lg:pb-0">
      <Suspense fallback={<EntryList entries={entries} todoCount={todoCount} currentHref={null} />}>
        <CurrentEntryList entries={entries} todoCount={todoCount} readTodoCount={readTodoCount} />
      </Suspense>
    </nav>
  );
}
