import { z } from 'zod';

import { canonicalTimeZone, formatZoneName, parseTimeOfDay } from '@/lib/time';
import { formatCount, formatDecimal } from '@/lib/wording';

import { MINUTES_PER_DAY, MINUTES_PER_HOUR, NO_UNIT, noun } from './units';

import type { Unit } from './units';

/**
 * How the values of one parameter are checked and written (TRV-34, TRV-35, CL-TRV-16):
 * its type and its bounds, inclusive, in one check, so that a stored value is always
 * one the code that reads it accepts. Methods, so that an entry of any value type fits
 * where an entry of unknown values is expected.
 */
export type ValueKind<V> = Readonly<{
  /** The value, in its stored form, when `value` is of this kind and within bounds. */
  parse(value: unknown): V | undefined;
  /** The value written for people, with its unit: "30 days", "on", "16:30 and 23:00". */
  write(value: V): string;
  /** The allowed values, as the settings screen and a refusal state them: "1 to 90 days". */
  allowed: string;
}>;

// How far from a whole number of steps a double may fall and still be one.
const STEP_TOLERANCE = 1e-9;
const DECIMAL_BASE = 10;
const URL_MAX_LENGTH = 2000;
// Any one code point, a lone surrogate included, newlines too.
const CODE_POINT = /\P{Cs}/gu;
// A lowercase domain name of at least two labels, without scheme, port or path: the
// engineering reading of CL-TRV-16's "domain names, lowercase, without scheme or path".
const DOMAIN_NAME = /^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z][a-z\d-]{0,62}$/u;

const LIST = z.array(z.unknown());
const RANGE = z.strictObject({ start: z.string(), end: z.string() });

/** The items of `value` when it is a list. */
function itemsOf(value: unknown): readonly unknown[] | undefined {
  const parsed = LIST.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** The items of `items` written as people list them: "a", "a and b", "a, b and c". */
export function listed(items: readonly string[]): string {
  const last = items.at(-1) ?? '';
  return items.length < 2 ? last : `${items.slice(0, -1).join(', ')} and ${last}`;
}

const withUnit = (written: string, value: number, unit: Unit): string =>
  `${written}${value === 1 ? unit.one : unit.many}`;

/** A whole number from `min` to `max`, in `unit`. */
export function integer(min: number, max: number, unit: Unit = NO_UNIT): ValueKind<number> {
  return {
    parse: (value) =>
      typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
        ? value
        : undefined,
    write: (value) => withUnit(formatCount(value), value, unit),
    allowed: `${formatCount(min)} to ${formatCount(max)}${unit.many}`,
  };
}

/** The decimals that the step `step` allows: 2 for 0.25 or 0.01, 1 for 0.5 or 0.1. */
const decimalsOf = (step: number): number => String(step).split('.', 2)[1]?.length ?? 1;

/** A number from `min` to `max` that is a whole multiple of `step`, in `unit`. */
export function decimal(
  bounds: Readonly<{ min: number; max: number; step: number }>,
  unit: Unit = NO_UNIT,
): ValueKind<number> {
  const decimals = decimalsOf(bounds.step);
  const write = (value: number): string => formatDecimal(value, decimals);
  // The whole number of steps that `value` is, within the tolerance of a double, if any.
  const stepsOf = (value: number): number | undefined => {
    const steps = Math.round(value / bounds.step);
    return Math.abs(value / bounds.step - steps) < STEP_TOLERANCE ? steps : undefined;
  };
  // A whole number of steps as the value it is written, 2.00000000001 stored as 2: the
  // value in units of its last decimal is a whole number, divided back exactly.
  const lastDecimals = DECIMAL_BASE ** decimals;
  const onStep = (steps: number): number =>
    Math.round(steps * bounds.step * lastDecimals) / lastDecimals;
  return {
    parse: (value) => {
      const steps =
        typeof value === 'number' && value >= bounds.min && value <= bounds.max
          ? stepsOf(value)
          : undefined;
      return steps === undefined ? undefined : onStep(steps);
    },
    write: (value) => withUnit(write(value), value, unit),
    allowed: `${write(bounds.min)} to ${write(bounds.max)}${unit.many}, step ${write(bounds.step)}`,
  };
}

/** A switch, on or off. */
export function toggle(): ValueKind<boolean> {
  return {
    parse: (value) => (typeof value === 'boolean' ? value : undefined),
    write: (value) => (value ? 'on' : 'off'),
    allowed: 'on / off',
  };
}

/** One of the stored codes of `options`, `[code, label]` pairs, each written by its label. */
export function choice<const C extends string>(
  options: readonly (readonly [code: C, label: string])[],
): ValueKind<C> {
  const labels: ReadonlyMap<string, string> = new Map(options);
  return {
    parse: (value) => options.find(([code]) => code === value)?.[0],
    write: (value) => labels.get(value) ?? value,
    allowed: options.map(([, label]) => label).join(' / '),
  };
}

/** A time of day in the strict HH:MM form, with its minutes after midnight. */
type Clock = Readonly<{ time: string; minutes: number }>;

/** The time of day that `value` is, in the strict HH:MM form, if it is one. */
function clockOf(value: unknown): Clock | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const time = parseTimeOfDay(value);
  return time.ok ? { time: value, minutes: time.hour * MINUTES_PER_HOUR + time.minute } : undefined;
}

/** The minutes after midnight of a time of day in the strict HH:MM form, if it is one. */
export const minutesOf = (value: unknown): number | undefined => clockOf(value)?.minutes;

const isTimeOfDay = (value: unknown): value is string => clockOf(value) !== undefined;

/** A time of day in the owner's zone, HH:MM. */
export function timeOfDay(allowed: string): ValueKind<string> {
  return {
    parse: (value) => (isTimeOfDay(value) ? value : undefined),
    write: (value) => value,
    allowed,
  };
}

/** The minutes between two times of day, on the circle of the day. */
function apart(first: number, second: number): number {
  const gap = Math.abs(first - second);
  return Math.min(gap, MINUTES_PER_DAY - gap);
}

/**
 * From `min` to `max` distinct times of day, HH:MM, at least `gapMinutes` apart on the
 * circle of the day (the last of a day and the first of the next one included), stored
 * in the order of the day.
 */
export function timesOfDay(
  bounds: Readonly<{ min: number; max: number; gapMinutes: number }>,
): ValueKind<readonly string[]> {
  const isSpaced = (minutes: readonly number[]): boolean =>
    minutes.every((minute, index) =>
      minutes.slice(index + 1).every((other) => apart(minute, other) >= bounds.gapMinutes),
    );
  return {
    parse: (value) => {
      const items = itemsOf(value) ?? [];
      const times = items.flatMap((item) => clockOf(item) ?? []);
      const ordered = times.toSorted((left, right) => left.minutes - right.minutes);
      const isCounted = times.length === items.length && times.length >= bounds.min;
      return isCounted &&
        times.length <= bounds.max &&
        isSpaced(ordered.map(({ minutes }) => minutes))
        ? ordered.map(({ time }) => time)
        : undefined;
    },
    write: (value) => listed(value),
    allowed: `${formatCount(bounds.min)} to ${formatCount(bounds.max)} distinct times of day, at least ${formatCount(bounds.gapMinutes)} minutes apart`,
  };
}

/** A range of the day from one time to another, which may span midnight. */
export type TimeRange = Readonly<{ start: string; end: string }>;

/** A range of times of day, HH:MM to HH:MM; equal ends mean none. */
export function timeRange(): ValueKind<TimeRange> {
  return {
    parse: (value) => {
      const range = RANGE.safeParse(value);
      return range.success && isTimeOfDay(range.data.start) && isTimeOfDay(range.data.end)
        ? range.data
        : undefined;
    },
    write: (value) => (value.start === value.end ? 'none' : `${value.start} to ${value.end}`),
    allowed: 'any start and end; equal means none; may span midnight',
  };
}

/** From 1 to `maxCount` whole minutes, strictly increasing, each 1 to `eachMax`. */
export function increasingMinutes(
  bounds: Readonly<{ maxCount: number; eachMax: number }>,
): ValueKind<readonly number[]> {
  const each = integer(1, bounds.eachMax);
  return {
    parse: (value) => {
      const items = itemsOf(value) ?? [];
      const minutes = items.flatMap((item) => each.parse(item) ?? []);
      // Strictly increasing: the list is its own distinct values in order.
      const ordered = [...new Set(minutes)].toSorted((left, right) => left - right);
      const isIncreasing = String(ordered) === String(minutes);
      const isCounted = minutes.length === items.length && minutes.length > 0;
      return isCounted && isIncreasing && minutes.length <= bounds.maxCount ? minutes : undefined;
    },
    write: (value) => `${listed(value.map((minute) => formatCount(minute)))} minutes`,
    allowed: `1 to ${formatCount(bounds.maxCount)} values, strictly increasing, each 1 to ${formatCount(bounds.eachMax)} minutes`,
  };
}

const isDomain = (item: unknown): item is string =>
  typeof item === 'string' && DOMAIN_NAME.test(item);

/** Up to `max` distinct domain names, lowercase, without scheme or path, stored sorted. */
export function domainList(max: number): ValueKind<readonly string[]> {
  const unit = noun('domain', 'domains');
  return {
    parse: (value) => {
      const items = new Set(itemsOf(value));
      const domains = [...items].filter((item) => isDomain(item));
      const isList = itemsOf(value) !== undefined && domains.length === items.size;
      return isList && domains.length <= max
        ? domains.toSorted((left, right) => left.localeCompare(right, 'en'))
        : undefined;
    },
    write: (value) => withUnit(formatCount(value.length), value.length, unit),
    allowed: `0 to ${formatCount(max)} domain names, lowercase, without scheme or path`,
  };
}

/** The length of `text` in Unicode code points, as a person counts characters; it trims nothing. */
function codePointCount(text: string): number {
  return (text.match(CODE_POINT) ?? []).length;
}

/** A model identifier of a language-model provider: no space, at most `maxLength` characters. */
export function modelId(maxLength: number): ValueKind<string> {
  return {
    parse: (value) =>
      typeof value === 'string' && /^\S+$/u.test(value) && codePointCount(value) <= maxLength
        ? value
        : undefined,
    write: (value) => value,
    allowed: `a model identifier, without spaces, of at most ${formatCount(maxLength)} characters`,
  };
}

/** A zone of the IANA database, stored in the database's own spelling (IHM-14, CL-IHM-05). */
export function timeZone(): ValueKind<string> {
  return {
    parse: (value) => {
      const zone = typeof value === 'string' ? canonicalTimeZone(value) : undefined;
      return zone?.ok === true ? zone.zone : undefined;
    },
    write: (value) => formatZoneName(value),
    allowed: 'any zone of the IANA time-zone database',
  };
}

/** No address, or an https address of at most 2,000 characters (IHM-44). */
export function optionalHttpsAddress(): ValueKind<string> {
  return {
    parse: (value) => {
      if (typeof value !== 'string' || codePointCount(value) > URL_MAX_LENGTH) {
        return;
      }
      return value === '' || URL.parse(value)?.protocol === 'https:' ? value : undefined;
    },
    write: (value) => (value === '' ? 'none' : value),
    allowed: `empty, or an https address of at most ${formatCount(URL_MAX_LENGTH)} characters`,
  };
}

/** A quota limit: unset until the owner enters it, then a whole number of at least 1 (TRV-03). */
export function quotaLimit(unit: Unit): ValueKind<number | null> {
  const limit = integer(1, Number.MAX_SAFE_INTEGER, unit);
  return {
    parse: (value) => limit.parse(value),
    write: (value) => (value === null ? 'not set' : limit.write(value)),
    allowed:
      'empty until entered, then an integer of at least 1; an unset limit fails the installation check',
  };
}
