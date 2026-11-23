import { ENTRIES } from './catalog';
import { minutesOf } from './kinds';
import { MINUTES_PER_HOUR } from './units';

import type { ParamReader, ParamValue } from './catalog';
import type { OverridableKey } from './entry';

/**
 * A bound between two parameters (CL-TRV-16): `upper` is at least `gap` above `lower`,
 * both read on one scale, the minutes after midnight for times of day.
 */
type Relation = Readonly<{ lower: OverridableKey; upper: OverridableKey; gap: number }>;

/**
 * The bounds of CL-TRV-16 between two parameters, held whichever of the two changes,
 * so that a change of one never leaves the other outside its bounds.
 */
const RELATIONS: readonly Relation[] = [
  { lower: 'players.indicativeMin', upper: 'players.maxActive', gap: 0 },
  { lower: 'collection.maxArticleAgeDays', upper: 'collection.dedupTraceRetentionDays', gap: 0 },
  { lower: 'games.correctionWindowDays', upper: 'games.boxScoreUnavailableAfterDays', gap: 0 },
  {
    lower: 'sensitivity.possibleSignalToNoise',
    upper: 'sensitivity.probableSignalToNoise',
    gap: 0,
  },
  { lower: 'sensitivity.possibleMeanGap', upper: 'sensitivity.probableMeanGap', gap: 0 },
  // "High from, above medium": one case more at least.
  {
    lower: 'sensitivity.confidenceMediumFromCases',
    upper: 'sensitivity.confidenceHighFromCases',
    gap: 1,
  },
  // "The cut-off at least one hour after the start" (CL-TRV-23).
  {
    lower: 'scheduler.statsUpdateTime',
    upper: 'scheduler.statsUpdateCutoff',
    gap: MINUTES_PER_HOUR,
  },
];

/** A value on the scale of its relation: a number as it is, a time of day in minutes. */
const scaled = (value: unknown): number =>
  typeof value === 'number' ? value : Number(minutesOf(value));

/** `value` of `key` written for people, with its unit: "30 days", "on", "not set". */
export function writeValue<K extends OverridableKey>(key: K, value: ParamValue<K>): string {
  return ENTRIES[key].kind.write(value);
}

/** The other parameter of a relation that a new value breaks, and its value in force, written. */
export type BrokenRelation = Readonly<{ key: OverridableKey; written: string }>;

/** Whether `value`, a new value of `key`, breaks `relation` with the values in force. */
function isBrokenBy(
  relation: Relation,
  change: Readonly<{ key: OverridableKey; value: unknown }>,
  values: ParamReader,
): boolean {
  const valueOf = (side: OverridableKey): unknown =>
    side === change.key ? change.value : values.get(side);
  const isInvolved = relation.lower === change.key || relation.upper === change.key;
  return (
    isInvolved && scaled(valueOf(relation.upper)) - scaled(valueOf(relation.lower)) < relation.gap
  );
}

/**
 * The first relation of CL-TRV-16 that `value`, a new value of `key` within its own
 * bounds, breaks with the value in force of the other parameter.
 */
export function brokenRelation(
  key: OverridableKey,
  value: unknown,
  values: ParamReader,
): BrokenRelation | undefined {
  const relation = RELATIONS.find((candidate) => isBrokenBy(candidate, { key, value }, values));
  if (relation === undefined) {
    return undefined;
  }
  const other = relation.lower === key ? relation.upper : relation.lower;
  return { key: other, written: writeValue(other, values.get(other)) };
}

/**
 * The plain explanation of a value refused for `key` (TRV-35, CL-TRV-16): its allowed
 * values, and the value in force of the other parameter of a relation it breaks.
 */
export function refusalOf(key: OverridableKey, broken?: BrokenRelation): string {
  const bounds = `${ENTRIES[key].label} accepts ${ENTRIES[key].allowed}.`;
  return broken === undefined
    ? bounds
    : `${bounds} ${ENTRIES[broken.key].label} is ${broken.written}.`;
}
