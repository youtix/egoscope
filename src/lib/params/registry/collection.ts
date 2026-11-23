import { entriesOf } from '../entry';
import { integer, timesOfDay } from '../kinds';
import {
  ATTEMPTS,
  CHARACTERS,
  DAYS,
  DAYS_PER_MONTH,
  DAYS_PER_QUARTER,
  DAYS_PER_YEAR,
  HOURS,
  MINUTES_PER_HOUR,
  noun,
} from '../units';

import type { FamilyEntries } from '../entry';

// The defaults and bounds of 03 News collection (module map §6, CL-TRV-16).
const COLLECTION_TIMES = ['16:30', '23:00'] as const;
const MOST_TIMES = 6;
const READ_ATTEMPTS = 3;
const MOST_READ_ATTEMPTS = 5;
const MAX_ARTICLE_AGE_DAYS = 3;
const OLDEST_ARTICLE_DAYS = 14;
const TITLE_DEDUP_HOURS = 6;
const LONGEST_TITLE_DEDUP_HOURS = 72;
const EXCERPT_LENGTH = 500;
const SHORTEST_EXCERPT = 100;
const LONGEST_EXCERPT = 1000;
const NOT_RELEVANT_RETENTION_DAYS = 30;
const LONGEST_NOT_RELEVANT_RETENTION_DAYS = 180;
const DEDUP_TRACE_RETENTION_DAYS = 180;
const SHORTEST_DEDUP_TRACE_RETENTION_DAYS = 7;
const FAILED_RUNS = 2;
const MOST_FAILED_RUNS = 10;
const SILENCE_DAYS = 3;
const INDICATOR_DAYS = 30;

const entry = entriesOf(2);

/** The parameters of 03 News collection (COL-11 to COL-42), read in Lot 2 only. */
export const COLLECTION = {
  'collection.times': entry({
    label: 'Collection times',
    sentence:
      'The times of day, in your time zone, when the news is collected and read for events.',
    unit: 'local times',
    kind: timesOfDay({ min: 1, max: MOST_TIMES, gapMinutes: MINUTES_PER_HOUR }),
    defaultValue: COLLECTION_TIMES,
    requirement: 'COL-12',
    source: 'ADR 0019',
    movesSchedule: true,
  }),
  'collection.readAttempts': entry({
    label: 'Read attempts per run',
    sentence: 'How many times a run tries to read a source before that read counts as failed.',
    unit: 'attempts per run',
    kind: integer(1, MOST_READ_ATTEMPTS, ATTEMPTS),
    defaultValue: READ_ATTEMPTS,
    requirement: 'COL-13',
    source: 'H-COL-04',
  }),
  'collection.maxArticleAgeDays': entry({
    label: 'Maximum article age',
    sentence: 'An article published longer ago than this is not collected.',
    unit: 'days',
    kind: integer(1, OLDEST_ARTICLE_DAYS, DAYS),
    defaultValue: MAX_ARTICLE_AGE_DAYS,
    requirement: 'COL-24',
    source: 'H-COL-02',
    boundsNote: ', at most the dedup trace retention',
  }),
  'collection.titleDedupWindowHours': entry({
    label: 'Title dedup window',
    sentence: 'Two articles with the same title within this window count as one.',
    unit: 'hours',
    kind: integer(1, LONGEST_TITLE_DEDUP_HOURS, HOURS),
    defaultValue: TITLE_DEDUP_HOURS,
    requirement: 'COL-30',
    source: 'H-COL-02',
  }),
  'collection.excerptMaxLength': entry({
    label: 'Excerpt length',
    sentence: 'The longest excerpt of an article that is kept.',
    unit: 'characters',
    kind: integer(SHORTEST_EXCERPT, LONGEST_EXCERPT, CHARACTERS),
    defaultValue: EXCERPT_LENGTH,
    requirement: 'COL-27',
    source: 'H-COL-03',
  }),
  'collection.notRelevantRetentionDays': entry({
    label: 'Not-relevant article retention',
    sentence: 'How long an article found not relevant is kept, and when the excerpts are erased.',
    unit: 'days (also the excerpt erasure term)',
    kind: integer(1, LONGEST_NOT_RELEVANT_RETENTION_DAYS, DAYS),
    defaultValue: NOT_RELEVANT_RETENTION_DAYS,
    requirement: 'COL-36',
    source: 'H-COL-04',
  }),
  'collection.dedupTraceRetentionDays': entry({
    label: 'Dedup trace retention',
    sentence: 'How long the traces that recognize an article already seen are kept.',
    unit: 'days',
    kind: integer(SHORTEST_DEDUP_TRACE_RETENTION_DAYS, DAYS_PER_YEAR, DAYS),
    defaultValue: DEDUP_TRACE_RETENTION_DAYS,
    requirement: 'COL-34',
    source: 'H-COL-04',
    boundsNote: ', at least the maximum article age',
  }),
  'collection.failedRunsBeforeDown': entry({
    label: 'Failed runs before "down"',
    sentence: 'After this many consecutive failed runs, a source shows as down.',
    unit: 'consecutive failed runs',
    kind: integer(1, MOST_FAILED_RUNS, noun('run', 'runs')),
    defaultValue: FAILED_RUNS,
    requirement: 'COL-41',
    source: 'H-COL-04',
  }),
  'collection.silencePeriodDays': entry({
    label: 'Silence period (default for each source)',
    sentence:
      'A source that publishes nothing for this long is reported as silent, unless it sets its own period.',
    unit: 'days, overridable per source',
    kind: integer(1, DAYS_PER_MONTH, DAYS),
    defaultValue: SILENCE_DAYS,
    requirement: 'COL-42',
    source: 'H-COL-04',
  }),
  'collection.indicatorWindowDays': entry({
    label: 'Source indicator period',
    sentence: "The rolling period over which each source's indicators are counted.",
    unit: 'days, rolling',
    kind: integer(1, DAYS_PER_QUARTER, DAYS),
    defaultValue: INDICATOR_DAYS,
    requirement: 'COL-11',
    source: 'H-COL-04',
  }),
} as const satisfies FamilyEntries<'collection'>;
