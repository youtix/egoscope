import { activeLot } from '@/lib/env';
import { sentence } from '@/lib/wording';

import { paths } from './paths';

import type { Lot } from '@/lib/env';
import type { Route } from 'next';

/** An entry of the navigation bar, by its code value in the glossary (IHM-16). */
export type NavigationEntry = 'home' | 'players' | 'alerts' | 'types' | 'more';

/** An entry of the More menu, by its code value in the glossary (IHM-16, CL-IHM-25). */
export type MoreMenuEntry =
  | 'backtest_requests'
  | 'profiles'
  | 'settings'
  | 'app_status'
  | 'activity_journal'
  | 'method_and_limits'
  | 'help'
  | 'detected_events'
  | 'validation_table'
  | 'collection_and_detection';

/** A link of the navigation: which entry it is, where it leads and what it says. */
export type NavigationLink<E extends string> = Readonly<{ entry: E; href: Route; label: string }>;

type Planned<E extends string> = NavigationLink<E> & Readonly<{ lot: Lot }>;

// In the order of IHM-16: Alerts comes in Lot 2, between Players and Types.
const NAVIGATION_BAR: readonly Planned<NavigationEntry>[] = [
  { entry: 'home', lot: 1, href: paths.home(), label: sentence('interface.home') },
  { entry: 'players', lot: 1, href: paths.players(), label: sentence('interface.players') },
  { entry: 'alerts', lot: 2, href: paths.alerts(), label: sentence('interface.alerts') },
  { entry: 'types', lot: 1, href: paths.types(), label: sentence('interface.types') },
  { entry: 'more', lot: 1, href: paths.more(), label: sentence('interface.more') },
];

// In the order of IHM-16, Profiles second (CL-IHM-25), then the three entries of Lot 2.
const MORE_MENU: readonly Planned<MoreMenuEntry>[] = [
  {
    entry: 'backtest_requests',
    lot: 1,
    href: paths.backtestRequests(),
    label: sentence('interface.backtestRequests'),
  },
  { entry: 'profiles', lot: 1, href: paths.profiles(), label: sentence('interface.profiles') },
  { entry: 'settings', lot: 1, href: paths.settings(), label: sentence('interface.settings') },
  { entry: 'app_status', lot: 1, href: paths.status(), label: sentence('interface.appStatus') },
  {
    entry: 'activity_journal',
    lot: 1,
    href: paths.journal(),
    label: sentence('interface.activityJournal'),
  },
  {
    entry: 'method_and_limits',
    lot: 1,
    href: paths.method(),
    label: sentence('interface.methodAndLimits'),
  },
  { entry: 'help', lot: 1, href: paths.help(), label: sentence('interface.help') },
  {
    entry: 'detected_events',
    lot: 2,
    href: paths.detectedEvents(),
    label: sentence('interface.detectedEvents'),
  },
  {
    entry: 'validation_table',
    lot: 2,
    href: paths.validationTable(),
    label: sentence('interface.validationTable'),
  },
  {
    entry: 'collection_and_detection',
    lot: 2,
    href: paths.collection(),
    label: sentence('interface.collectionAndDetection'),
  },
];

/** The links of `planned` that `lot` serves, in their order, without their lot. */
function servedBy<E extends string>(
  planned: readonly Planned<E>[],
  lot: Lot,
): readonly NavigationLink<E>[] {
  return planned
    .filter((link) => link.lot <= lot)
    .map(({ entry, href, label }) => ({ entry, href, label }));
}

/**
 * The entries of the navigation bar that `lot`, the active lot by default, serves (IHM-16):
 * Home, Players, Types and More in Lot 1; Home, Players, Alerts, Types and More in Lot 2.
 */
export function navigationEntries(
  lot: Lot = activeLot(),
): readonly NavigationLink<NavigationEntry>[] {
  return servedBy(NAVIGATION_BAR, lot);
}

/**
 * The entries of the More menu that `lot`, the active lot by default, serves (IHM-16,
 * CL-IHM-25): Backtest requests, Profiles, Settings, App status, Activity journal, Method
 * and limits and Help, then in Lot 2 Detected events, Validation table and Collection and
 * detection.
 */
export function moreMenuEntries(lot: Lot = activeLot()): readonly NavigationLink<MoreMenuEntry>[] {
  return servedBy(MORE_MENU, lot);
}
