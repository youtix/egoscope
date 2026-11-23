import { entriesOf } from '../entry';
import { integer } from '../kinds';
import { ATTEMPTS, HOURS, HOURS_PER_DAY, POINTS, WHOLE } from '../units';

import type { FamilyEntries } from '../entry';

// The defaults and bounds of 04 Event detection (module map §6, CL-TRV-16).
const THRESHOLD = 70;
const BAND_WIDTH = 10;
const WIDEST_BAND = 50;
const CLASSIFICATION_ATTEMPTS = 2;
const MOST_CLASSIFICATION_ATTEMPTS = 5;
const GROUPING_HOURS = 72;
const PRIORITY_HORIZON_HOURS = 48;
const LONGEST_WINDOW_HOURS = 240;
const QUEUE_RESUME_HOURS = 6;

const entry = entriesOf(2);

/** The parameters of 04 Event detection (DET-09 to DET-29), read in Lot 2 only. */
export const DETECTION = {
  'detection.threshold': entry({
    label: 'Detection threshold',
    sentence:
      'An article classified with less confidence than this creates no event; a change is not retroactive.',
    unit: 'points; never retroactive and not a calculation parameter (CL-TRV-17)',
    kind: integer(1, WHOLE, POINTS),
    defaultValue: THRESHOLD,
    requirement: 'DET-24',
    source: 'H-DET-03',
  }),
  'detection.confidenceBandWidth': entry({
    label: 'Confidence band width',
    sentence: 'The width of each band of detection confidence that the detection journal counts.',
    unit: 'points per band of detection confidence in the detection journal (0–9, 10–19 …)',
    kind: integer(1, WIDEST_BAND, POINTS),
    defaultValue: BAND_WIDTH,
    requirement: 'DET-25',
    source: 'CL-DET-24',
  }),
  'detection.classificationAttempts': entry({
    label: 'Classification attempts',
    sentence: 'How many times an article is sent for classification before it is set aside.',
    unit: 'attempts (the second one on the next provider, or the same one when it is alone)',
    kind: integer(1, MOST_CLASSIFICATION_ATTEMPTS, ATTEMPTS),
    defaultValue: CLASSIFICATION_ATTEMPTS,
    requirement: 'DET-22',
    source: 'H-DET-03',
  }),
  'detection.groupingWindowHours': entry({
    label: 'Grouping window',
    sentence:
      "Articles about the same event within this window before an article's retained instant are grouped.",
    unit: "hours before the article's retained instant",
    kind: integer(1, LONGEST_WINDOW_HOURS, HOURS),
    defaultValue: GROUPING_HOURS,
    requirement: 'DET-29',
    source: 'H-DET-04',
  }),
  'detection.priorityHorizonHours': entry({
    label: 'Queue priority horizon',
    sentence: 'Articles about a player whose game starts within this horizon are classified first.',
    unit: 'hours before tip-off',
    kind: integer(1, LONGEST_WINDOW_HOURS, HOURS),
    defaultValue: PRIORITY_HORIZON_HOURS,
    requirement: 'DET-09',
    source: 'H-DET-05',
  }),
  'detection.queueResumeIntervalHours': entry({
    label: 'Queue resumption interval',
    sentence:
      'How long the classification queue waits before it resumes, unless the quota that stopped it resets first.',
    unit: 'hours; the queue resumes earlier when the quota that stopped the last run resets first',
    kind: integer(1, HOURS_PER_DAY, HOURS),
    defaultValue: QUEUE_RESUME_HOURS,
    requirement: 'DET-10',
    source: 'H-DET-05',
    movesSchedule: true,
  }),
} as const satisfies FamilyEntries<'detection'>;
