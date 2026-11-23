import { entriesOf } from '../entry';
import { decimal, integer, timeOfDay } from '../kinds';
import {
  DAYS_PER_WEEK,
  HOURS,
  HOURS_PER_DAY,
  MINUTES,
  MINUTES_PER_HOUR,
  noun,
  QUARTER_HOUR,
} from '../units';

import type { FamilyEntries } from '../entry';

// The defaults and bounds of the scheduled tasks of 14 Cross-cutting requirements
// (module map §6, CL-TRV-16, CL-TRV-23).
const STATS_UPDATE_TIME = '15:00';
const STATS_UPDATE_CUTOFF = '20:00';
const PROBE_INTERVAL_MINUTES = 60;
const SHORTEST_PROBE_INTERVAL_MINUTES = 15;
const LONGEST_PROBE_INTERVAL_MINUTES = 120;
const LATE_DAYS = 2;
const PURGE_TIME = '04:00';
const MISSED_RUN_MARGIN_HOURS = 2;
const TICK_INTERVAL_MINUTES = 5;

const entry = entriesOf(1);

/** The parameters of the scheduled tasks (TRV-25, TRV-31, CL-TRV-23). */
export const SCHEDULER = {
  'scheduler.statsUpdateTime': entry({
    label: 'Statistics update start',
    sentence: 'The time of day, in your time zone, when the daily statistics update starts.',
    unit: 'local time',
    kind: timeOfDay('any time of day'),
    defaultValue: STATS_UPDATE_TIME,
    requirement: 'TRV-25',
    source: 'CL-TRV-23',
    movesSchedule: true,
    boundsNote: ', at least one hour before the cut-off',
  }),
  'scheduler.statsUpdateCutoff': entry({
    label: 'Statistics update cut-off',
    sentence:
      'When the source has not refreshed by this time of day, the update fetches what is published.',
    unit: 'local time',
    kind: timeOfDay('any time of day'),
    defaultValue: STATS_UPDATE_CUTOFF,
    requirement: 'TRV-25',
    source: 'CL-TRV-23',
    movesSchedule: true,
    boundsNote: ', at least one hour after the start',
  }),
  'scheduler.statsProbeIntervalMinutes': entry({
    label: 'Probe interval while waiting for the source',
    sentence: "How often the waiting update checks whether the source's daily refresh has landed.",
    unit: 'minutes',
    kind: integer(SHORTEST_PROBE_INTERVAL_MINUTES, LONGEST_PROBE_INTERVAL_MINUTES, MINUTES),
    defaultValue: PROBE_INTERVAL_MINUTES,
    requirement: 'TRV-25',
    source: 'CL-TRV-23',
    movesSchedule: true,
  }),
  'scheduler.statsLateDaysBeforeIncident': entry({
    label: 'Late days before the incident',
    sentence: 'After this many consecutive competition days with a late source, an incident opens.',
    unit: 'consecutive late competition days',
    kind: integer(1, DAYS_PER_WEEK, noun('late day', 'late days')),
    defaultValue: LATE_DAYS,
    requirement: 'TRV-45',
    source: 'CL-TRV-23',
  }),
  'scheduler.purgeTime': entry({
    label: 'Purge time',
    sentence: 'The time of day, in your time zone, when data past its retention is deleted.',
    unit: 'local time',
    kind: timeOfDay('any time of day'),
    defaultValue: PURGE_TIME,
    requirement: 'TRV-25',
    source: 'H-TRV-07',
    movesSchedule: true,
  }),
  'scheduler.missedRunMarginHours': entry({
    label: 'Margin before "task not run"',
    sentence:
      'A task that has not run this long after its due time opens the incident "Task not run".',
    unit: 'hours',
    kind: decimal({ min: QUARTER_HOUR, max: HOURS_PER_DAY, step: QUARTER_HOUR }, HOURS),
    defaultValue: MISSED_RUN_MARGIN_HOURS,
    requirement: 'TRV-31',
    source: 'H-TRV-07',
  }),
  'scheduler.expectedTickIntervalMinutes': entry({
    label: 'Expected trigger interval',
    sentence: 'The trigger service shows as degraded when no tick came for twice this interval.',
    unit: "minutes, the primary trigger service's interval (monitoring only; no rule counts ticks)",
    kind: integer(1, MINUTES_PER_HOUR, MINUTES),
    defaultValue: TICK_INTERVAL_MINUTES,
    requirement: 'TRV-03',
    source: 'scheduler sheet',
    engineeringBounds: true,
  }),
} as const satisfies FamilyEntries<'scheduler'>;
