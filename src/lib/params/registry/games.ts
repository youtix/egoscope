import { entriesOf } from '../entry';
import { choice, decimal, integer } from '../kinds';
import {
  DAYS,
  DAYS_PER_MONTH,
  DAYS_PER_YEAR,
  GAMES,
  HOURS,
  HOURS_PER_DAY,
  MINUTES,
  PERCENT,
  QUARTER_HOUR,
  SEASON_GAMES,
  WHOLE,
} from '../units';

import type { FamilyEntries } from '../entry';

// The defaults and bounds of 07 Game statistics (module map §6, CL-TRV-16).
const MINUTES_FLOOR = 15;
const REGULATION_MINUTES = 48;
const AVERAGE_SHARE = 50;
const MIN_BASELINE_GAMES = 10;
const PARTIAL_BASELINE_SHARE = 20;
const DAILY_UPDATE_DELAY_HOURS = 3;
const LONGEST_UPDATE_DELAY_HOURS = 12;
const CORRECTION_WINDOW_DAYS = 7;
const BOX_SCORE_UNAVAILABLE_DAYS = 30;
const RETRY_FIRST_DELAY_HOURS = 1;
const RETRY_INTERVAL_HOURS = 4;
const INCIDENT_AFTER_HOURS = 12;
const LONGEST_INCIDENT_DELAY_HOURS = 72;
const QUOTA_RESERVE_SHARE = 10;
const LARGEST_QUOTA_RESERVE_SHARE = 50;

const entry = entriesOf(1);

/** The baselines a play-in or playoff game may be measured against (STA-18). */
const BASELINE_PHASES = [
  ['postseason', 'postseason'],
  ['regular_season', 'regular season'],
] as const;

/** The parameters of 07 Game statistics (STA-14 to STA-39): all affect calculations. */
export const GAMES_FAMILY = {
  'games.minutesFloor': entry({
    label: 'Playing-time floor',
    sentence: 'A game in which the player played fewer minutes than this is not usable.',
    unit: 'minutes',
    kind: integer(0, REGULATION_MINUTES, MINUTES),
    defaultValue: MINUTES_FLOOR,
    requirement: 'STA-14',
    source: 'H-STA-03',
    affectsCalculations: true,
  }),
  'games.minutesAverageShare': entry({
    label: 'Share of average minutes',
    sentence:
      "A game is not usable either when the player's minutes fall below this share of his season average.",
    unit: "% of the season's average minutes per regular-season game played",
    kind: integer(0, WHOLE, PERCENT),
    defaultValue: AVERAGE_SHARE,
    requirement: 'STA-14',
    source: 'H-STA-03',
    affectsCalculations: true,
  }),
  'games.minBaselineGames': entry({
    label: 'Minimum baseline size',
    sentence: 'A baseline with fewer usable games than this gives no measure.',
    unit: 'usable games, measured game excluded',
    kind: integer(2, SEASON_GAMES, GAMES),
    defaultValue: MIN_BASELINE_GAMES,
    requirement: 'STA-19',
    source: 'H-STA-07',
    affectsCalculations: true,
  }),
  'games.postseasonBaseline': entry({
    label: 'Baseline for play-in and playoff games',
    sentence: 'Which games a play-in or playoff game is compared with.',
    unit: 'choice',
    kind: choice(BASELINE_PHASES),
    defaultValue: 'postseason',
    requirement: 'STA-18',
    source: 'H-STA-06',
    affectsCalculations: true,
  }),
  'games.partialBaselineShare': entry({
    label: 'Partial baseline threshold',
    sentence:
      'A baseline is marked partial when more than this share of its played games has no index.',
    unit: '% of played games without an index',
    kind: integer(0, WHOLE, PERCENT),
    defaultValue: PARTIAL_BASELINE_SHARE,
    requirement: 'STA-24',
    source: 'H-STA-10',
    affectsCalculations: true,
  }),
  'games.dailyUpdateDelayHours': entry({
    label: 'Delay after the last tip-off',
    sentence: "The daily statistics update waits this long after the day's last tip-off.",
    unit: 'hours after the last scheduled tip-off of the past competition day',
    kind: integer(1, LONGEST_UPDATE_DELAY_HOURS, HOURS),
    defaultValue: DAILY_UPDATE_DELAY_HOURS,
    requirement: 'STA-32',
    source: 'H-STA-12',
    affectsCalculations: true,
    movesSchedule: true,
  }),
  'games.correctionWindowDays': entry({
    label: 'Correction window',
    sentence: 'For this long after a game, corrections of its statistics are taken in.',
    unit: 'days after the game',
    kind: integer(1, DAYS_PER_MONTH, DAYS),
    defaultValue: CORRECTION_WINDOW_DAYS,
    requirement: 'STA-33',
    source: 'H-STA-13',
    affectsCalculations: true,
    boundsNote: ', at most the delay before a box score is unavailable',
  }),
  'games.boxScoreUnavailableAfterDays': entry({
    label: 'Delay before a box score is unavailable',
    sentence: 'A box score still missing this long after its game is marked unavailable.',
    unit: "days after the game, excluding the days when the stats source's incidents or quota were open (CL-STA-11)",
    kind: integer(1, DAYS_PER_YEAR, DAYS),
    defaultValue: BOX_SCORE_UNAVAILABLE_DAYS,
    requirement: 'STA-35',
    source: 'H-STA-13',
    affectsCalculations: true,
    boundsNote: ', at least the correction window',
  }),
  'games.retryFirstDelayHours': entry({
    label: 'Retry delays — first retry',
    sentence: 'How long after a failed fetch of statistics the first retry comes.',
    unit: 'hours',
    kind: decimal({ min: QUARTER_HOUR, max: HOURS_PER_DAY, step: QUARTER_HOUR }, HOURS),
    defaultValue: RETRY_FIRST_DELAY_HOURS,
    requirement: 'STA-36',
    source: 'H-STA-14',
    affectsCalculations: true,
    movesSchedule: true,
  }),
  'games.retryIntervalHours': entry({
    label: 'Retry delays — interval',
    sentence: 'The interval between the later retries of a failed fetch of statistics.',
    unit: 'hours',
    kind: decimal({ min: 1, max: HOURS_PER_DAY, step: QUARTER_HOUR }, HOURS),
    defaultValue: RETRY_INTERVAL_HOURS,
    requirement: 'STA-36',
    source: 'H-STA-14',
    affectsCalculations: true,
    movesSchedule: true,
  }),
  'games.incidentAfterHours': entry({
    label: 'Delay before an incident',
    sentence: 'After this long of continuous failure to fetch statistics, an incident opens.',
    unit: 'hours of continuous failure',
    kind: integer(1, LONGEST_INCIDENT_DELAY_HOURS, HOURS),
    defaultValue: INCIDENT_AFTER_HOURS,
    requirement: 'STA-37',
    source: 'H-STA-14',
    affectsCalculations: true,
  }),
  'games.quotaReserveShare': entry({
    label: 'Quota reserve',
    sentence: "The share of each of the stats source's limits kept for the most urgent fetches.",
    unit: '% of each limit kept for STA-40 levels 1 and 2',
    kind: integer(0, LARGEST_QUOTA_RESERVE_SHARE, PERCENT),
    defaultValue: QUOTA_RESERVE_SHARE,
    requirement: 'STA-39',
    source: 'H-STA-15',
    affectsCalculations: true,
  }),
} as const satisfies FamilyEntries<'games'>;
