import { entriesOf } from '../entry';
import { decimal, integer, toggle } from '../kinds';
import {
  CASES,
  DAYS,
  GAMES,
  GAP_BOUNDS,
  noun,
  PERCENT,
  SEASON_GAMES,
  VALID_CASES,
  WHOLE,
} from '../units';

import type { FamilyEntries } from '../entry';

// The defaults and bounds of 08 Sensitivity and verdict (module map §6, CL-TRV-16).
const MAX_ATTACHMENT_DAYS = 10;
const LONGEST_ATTACHMENT_DAYS = 60;
const INJURY_MIN_GAMES_MISSED = 4;
const INJURY_FIRST_GAMES = 2;
const MOST_INJURY_FIRST_GAMES = 10;
const OPPONENT_LOW_SHARE = 25;
const HIGHEST_LOW_SHARE = 49;
const OPPONENT_HIGH_SHARE = 75;
const LOWEST_HIGH_SHARE = 51;
const OPPONENT_MIN_GAMES = 10;
const MIN_VALID_CASES = 5;
const POSSIBLE_SIGNAL_TO_NOISE = 2;
const PROBABLE_SIGNAL_TO_NOISE = 3;
const TENTH = 0.1;
const LOWEST_SIGNAL_TO_NOISE = 0.5;
const HIGHEST_RATIO = 10;
const SIGNAL_TO_NOISE_BOUNDS = { min: LOWEST_SIGNAL_TO_NOISE, max: HIGHEST_RATIO, step: TENTH };
const POSSIBLE_MEAN_GAP = 0.25;
const PROBABLE_MEAN_GAP = 0.4;
const MEDIUM_FROM_CASES = 8;
const MOST_MEDIUM_FROM_CASES = 200;
const HIGH_FROM_CASES = 15;
const MOST_HIGH_FROM_CASES = 500;
const DISPERSION_DROP = 1.5;
const DISPERSION_DROP_BOUNDS = { min: TENTH, max: HIGHEST_RATIO, step: TENTH };
const DOUBTFUL_SHARE_DROP = 30;
const TREND_MIN_PLAYERS = 3;
const MOST_TREND_MIN_PLAYERS = 30;
const TREND_MAX_TOP_SHARE = 50;
const COUNTS_BELOW_CASES = 20;
const MOST_COUNTS_BELOW_CASES = 200;

const entry = entriesOf(1);
const NOISE_MULTIPLES = noun('times the expected noise', 'times the expected noise');

/** The parameters of 08 Sensitivity and verdict (SEN-04 to SEN-39): all affect calculations. */
export const SENSITIVITY = {
  'sensitivity.maxAttachmentDays': entry({
    label: 'Attachment window',
    sentence: 'A game played more than this long after an event is not attached to it.',
    unit: 'days after the reference instant',
    kind: integer(1, LONGEST_ATTACHMENT_DAYS, DAYS),
    defaultValue: MAX_ATTACHMENT_DAYS,
    requirement: 'SEN-04',
    source: 'H-SEN-03',
    affectsCalculations: true,
  }),
  'sensitivity.coOccurringCasesDoubtful': entry({
    label: 'Treat co-occurring cases as doubtful',
    sentence: 'Whether two cases measured on the same game are both set aside as doubtful.',
    unit: 'on / off',
    kind: toggle(),
    defaultValue: false,
    requirement: 'SEN-06',
    source: 'H-SEN-04',
    affectsCalculations: true,
  }),
  'sensitivity.injuryReturnMinGamesMissed': entry({
    label: 'Absence length (return from injury)',
    sentence:
      'After this many consecutive team games missed, the next games count as a return from injury.',
    unit: 'consecutive team games missed',
    kind: integer(1, SEASON_GAMES, GAMES),
    defaultValue: INJURY_MIN_GAMES_MISSED,
    requirement: 'SEN-13',
    source: 'H-SEN-05',
    affectsCalculations: true,
  }),
  'sensitivity.injuryReturnFirstGames': entry({
    label: 'Games after an absence (return from injury)',
    sentence: 'How many games after such an absence count as a return from injury.',
    unit: 'games played after the absence',
    kind: integer(1, MOST_INJURY_FIRST_GAMES, GAMES),
    defaultValue: INJURY_FIRST_GAMES,
    requirement: 'SEN-13',
    source: 'H-SEN-05',
    affectsCalculations: true,
  }),
  'sensitivity.allPlayoffGamesUnusualStakes': entry({
    label: 'Treat every playoff game as unusual stakes',
    sentence: 'Whether every playoff game counts as a game of unusual stakes.',
    unit: 'on / off',
    kind: toggle(),
    defaultValue: false,
    requirement: 'SEN-14',
    source: 'H-SEN-06',
    affectsCalculations: true,
  }),
  'sensitivity.opponentWinShareLow': entry({
    label: 'Opponent strength bounds — low',
    sentence: 'An opponent that won less than this share of its games counts as weak.',
    unit: '%, strictly below',
    kind: integer(0, HIGHEST_LOW_SHARE, PERCENT),
    defaultValue: OPPONENT_LOW_SHARE,
    requirement: 'SEN-15',
    source: 'H-SEN-07',
    affectsCalculations: true,
  }),
  'sensitivity.opponentWinShareHigh': entry({
    label: 'Opponent strength bounds — high',
    sentence: 'An opponent that won more than this share of its games counts as strong.',
    unit: '%, strictly above',
    kind: integer(LOWEST_HIGH_SHARE, WHOLE, PERCENT),
    defaultValue: OPPONENT_HIGH_SHARE,
    requirement: 'SEN-15',
    source: 'H-SEN-07',
    affectsCalculations: true,
  }),
  'sensitivity.opponentMinGames': entry({
    label: 'Opponent minimum games',
    sentence: "An opponent's strength is judged only once it has played this many games.",
    unit: 'games, measured game excluded',
    kind: integer(1, SEASON_GAMES, GAMES),
    defaultValue: OPPONENT_MIN_GAMES,
    requirement: 'SEN-15',
    source: 'H-SEN-07',
    affectsCalculations: true,
  }),
  'sensitivity.minValidCases': entry({
    label: 'Valid cases for a player verdict',
    sentence: 'A player gets a verdict for a type only from this many valid cases.',
    unit: 'valid cases',
    kind: integer(2, WHOLE, VALID_CASES),
    defaultValue: MIN_VALID_CASES,
    requirement: 'SEN-23',
    source: 'ADR 0021',
    affectsCalculations: true,
  }),
  'sensitivity.possibleSignalToNoise': entry({
    label: 'Verdict thresholds — signal-to-noise for "possible"',
    sentence: 'The signal-to-noise ratio from which a verdict can be "possible".',
    unit: 'multiples of the expected noise',
    kind: decimal(SIGNAL_TO_NOISE_BOUNDS, NOISE_MULTIPLES),
    defaultValue: POSSIBLE_SIGNAL_TO_NOISE,
    requirement: 'SEN-23',
    source: 'ADR 0021',
    affectsCalculations: true,
    boundsNote: '; at most the "probable" value',
  }),
  'sensitivity.possibleMeanGap': entry({
    label: 'Verdict thresholds — mean gap for "possible"',
    sentence: 'The mean normalized gap from which a verdict can be "possible".',
    unit: 'normalized gap',
    kind: decimal(GAP_BOUNDS),
    defaultValue: POSSIBLE_MEAN_GAP,
    requirement: 'SEN-23',
    source: 'ADR 0021',
    affectsCalculations: true,
    boundsNote: '; at most the "probable" value',
  }),
  'sensitivity.probableSignalToNoise': entry({
    label: 'Verdict thresholds — signal-to-noise for "probable"',
    sentence: 'The signal-to-noise ratio from which a verdict can be "probable".',
    unit: 'multiples of the expected noise',
    kind: decimal(SIGNAL_TO_NOISE_BOUNDS, NOISE_MULTIPLES),
    defaultValue: PROBABLE_SIGNAL_TO_NOISE,
    requirement: 'SEN-23',
    source: 'ADR 0021',
    affectsCalculations: true,
    boundsNote: '; at least the "possible" value',
  }),
  'sensitivity.probableMeanGap': entry({
    label: 'Verdict thresholds — mean gap for "probable"',
    sentence: 'The mean normalized gap from which a verdict can be "probable".',
    unit: 'normalized gap',
    kind: decimal(GAP_BOUNDS),
    defaultValue: PROBABLE_MEAN_GAP,
    requirement: 'SEN-23',
    source: 'ADR 0021',
    affectsCalculations: true,
    boundsNote: '; at least the "possible" value',
  }),
  'sensitivity.confidenceMediumFromCases': entry({
    label: 'Profile confidence thresholds — medium from',
    sentence: 'From this many valid cases, a profile confidence can be medium.',
    unit: 'valid cases',
    kind: integer(1, MOST_MEDIUM_FROM_CASES, VALID_CASES),
    defaultValue: MEDIUM_FROM_CASES,
    requirement: 'SEN-25',
    source: 'H-SEN-11',
    affectsCalculations: true,
    boundsNote: ', below high',
  }),
  'sensitivity.confidenceHighFromCases': entry({
    label: 'Profile confidence thresholds — high from',
    sentence: 'From this many valid cases, a profile confidence can be high.',
    unit: 'valid cases',
    kind: integer(2, MOST_HIGH_FROM_CASES, VALID_CASES),
    defaultValue: HIGH_FROM_CASES,
    requirement: 'SEN-25',
    source: 'H-SEN-11',
    affectsCalculations: true,
    boundsNote: ', above medium',
  }),
  'sensitivity.confidenceDispersionDrop': entry({
    label: 'Profile confidence thresholds — dispersion drop',
    sentence: 'Above this observed dispersion, the profile confidence drops one level.',
    unit: 'observed dispersion',
    kind: decimal(DISPERSION_DROP_BOUNDS),
    defaultValue: DISPERSION_DROP,
    requirement: 'SEN-25',
    source: 'H-SEN-11',
    affectsCalculations: true,
  }),
  'sensitivity.confidenceDoubtfulShareDrop': entry({
    label: 'Profile confidence thresholds — doubtful-share drop',
    sentence: 'Above this share of doubtful cases, the profile confidence drops one level.',
    unit: '% excluded ÷ (valid + excluded)',
    kind: integer(0, WHOLE, PERCENT),
    defaultValue: DOUBTFUL_SHARE_DROP,
    requirement: 'SEN-25',
    source: 'H-SEN-11',
    affectsCalculations: true,
  }),
  'sensitivity.trendMinPlayers': entry({
    label: 'Minimum players for a trend',
    sentence: 'A general trend needs valid cases from at least this many players.',
    unit: 'distinct players',
    kind: integer(1, MOST_TREND_MIN_PLAYERS, noun('player', 'players')),
    defaultValue: TREND_MIN_PLAYERS,
    requirement: 'SEN-29',
    source: 'H-SEN-13',
    affectsCalculations: true,
  }),
  'sensitivity.trendMaxTopShare': entry({
    label: 'Maximum share of one player in a trend',
    sentence:
      'A general trend whose valid cases come above this share from one player is not shown as one.',
    unit: '% of the valid cases from one player',
    kind: integer(1, WHOLE, PERCENT),
    defaultValue: TREND_MAX_TOP_SHARE,
    requirement: 'SEN-29',
    source: 'H-SEN-13',
    affectsCalculations: true,
  }),
  'sensitivity.countsBelowCases': entry({
    label: 'Counts instead of percentages below',
    sentence: 'Below this many cases, shares are shown as counts rather than percentages.',
    unit: 'cases',
    kind: integer(1, MOST_COUNTS_BELOW_CASES, CASES),
    defaultValue: COUNTS_BELOW_CASES,
    requirement: 'SEN-39',
    source: 'H-SEN-14',
    affectsCalculations: true,
  }),
} as const satisfies FamilyEntries<'sensitivity'>;
