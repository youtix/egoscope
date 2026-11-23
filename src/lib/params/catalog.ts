import { OVERRIDABLE_PARAMETER_KEYS } from '@/lib/db';

import { ALERTS } from './registry/alerts';
import { AUTH } from './registry/auth';
import { BACKTESTS } from './registry/backtests';
import { BACKUPS } from './registry/backups';
import { COLLECTION } from './registry/collection';
import { DETECTION } from './registry/detection';
import { DISPLAY } from './registry/display';
import { EVENTS } from './registry/events';
import { GAMES_FAMILY } from './registry/games';
import { IMPORTS } from './registry/imports';
import { JOURNAL } from './registry/journal';
import { LANGUAGE_MODEL } from './registry/language-model';
import { NOTIFICATIONS } from './registry/notifications';
import { PLAYERS } from './registry/players';
import { QUOTAS } from './registry/quotas';
import { SCHEDULER } from './registry/scheduler';
import { SENSITIVITY } from './registry/sensitivity';
import { SWITCHED_OFF_CRITERION, SWITCHED_OFF_CRITERION_KEY } from './registry/taxonomy';
import { TRACKING } from './registry/tracking';

import type { EntryFacts, OverridableKey, RegistryEntry } from './entry';

/**
 * `registry` when it holds an entry for every key of the schema's list and no other:
 * a key on one side only does not compile (TRV-38, TRV-40).
 */
function complete<R extends Readonly<Record<OverridableKey, RegistryEntry<unknown>>>>(
  registry: R & Readonly<Record<Exclude<keyof R, OverridableKey>, never>>,
): R {
  return registry;
}

/**
 * The parameter registry, module map section 6, in its order: every key that holds a
 * value, from the families of the spec files 01 to 14 (TRV-38, TRV-39, TRV-40).
 */
const REGISTRY = complete({
  ...PLAYERS,
  ...COLLECTION,
  ...DETECTION,
  ...LANGUAGE_MODEL,
  ...BACKTESTS,
  ...IMPORTS,
  ...GAMES_FAMILY,
  ...SENSITIVITY,
  ...ALERTS,
  ...TRACKING,
  ...NOTIFICATIONS,
  ...DISPLAY,
  ...EVENTS,
  ...QUOTAS,
  ...SCHEDULER,
  ...JOURNAL,
  ...BACKUPS,
  ...AUTH,
});

type Registry = typeof REGISTRY;

/** Every key of the registry: those that hold a value and the per-type criterion switch. */
export type ParameterKey = OverridableKey | typeof SWITCHED_OFF_CRITERION_KEY;

/** The type of the values of `K`: `number` for `players.maxActive`, `boolean` for a switch. */
export type ParamValue<K extends OverridableKey> = Registry[K]['defaultValue'];

/** The values in force, read at once, each typed by its key (TRV-36). */
export type ParamReader = Readonly<{ get<K extends OverridableKey>(key: K): ParamValue<K> }>;

/** The entry of each key, typed by its own values. */
export const ENTRIES: { readonly [K in OverridableKey]: RegistryEntry<ParamValue<K>> } = REGISTRY;

/** The keys that hold a value, in the order of module map section 6. */
export const OVERRIDABLE_KEYS: readonly OverridableKey[] = OVERRIDABLE_PARAMETER_KEYS;

/** Whether `key` is one of the registry's keys that hold a value. */
export const isOverridable = (key: string): key is OverridableKey => Object.hasOwn(REGISTRY, key);

// The parameter of 08 that section 6 follows with the per-type criterion switch.
const BEFORE_SWITCH: OverridableKey = 'sensitivity.opponentMinGames';

/** The facts of every key in the order of section 6, the switch among the parameters of 08. */
export const ALL_FACTS: readonly (readonly [ParameterKey, EntryFacts])[] = OVERRIDABLE_KEYS.flatMap(
  (key) => {
    const facts = [key, ENTRIES[key]] as const;
    return key === BEFORE_SWITCH
      ? [facts, [SWITCHED_OFF_CRITERION_KEY, SWITCHED_OFF_CRITERION] as const]
      : [facts];
  },
);

/**
 * The keys whose values the calculations read (CL-TRV-17): those of files 07, 08 and 10,
 * the switch apart, which holds no value of its own.
 */
export const CALCULATION_KEYS: readonly OverridableKey[] = OVERRIDABLE_KEYS.filter(
  (key) => ENTRIES[key].affectsCalculations,
);
