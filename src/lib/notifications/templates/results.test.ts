import { describe, expect, it } from 'vitest';

import { paths } from '@/lib/navigation';
import { toEpochMs, toIsoDate } from '@/lib/time';

import { trackedGameResult } from './results';

import type { TrackedGameResultData, TrackedResultContent } from './data';

const PARIS = 'Europe/Paris';
const MINUS = '\u{2212}';
const BASE = 'https://egoscope.example';
const linesOf = (text: string): readonly string[] => text.split('\n');

// Wednesday 18 November 2026, 01:30 in Paris: Tuesday evening in the US.
const WEDNESDAY_GAME = {
  scheduledStartAt: toEpochMs(Date.UTC(2026, 10, 18, 0, 30)),
  usDate: toIsoDate('2026-11-17'),
  opponentName: 'Team X',
};
const WEDNESDAY_TEXT =
  'Wednesday 18 November 2026, 01:30 Paris time — Tuesday evening in the US, against Team X';
const CONTENT: TrackedResultContent = {
  kind: 'final',
  normalizedGap: 1.07,
  gapStatus: 'provisional',
  indicativeComparison: null,
  category: 'confirmed',
  recordedAfterTipOff: false,
  lateForecast: false,
  profile: {
    validCount: 8,
    meanGap: 0.86,
    rangeLow: 0.15,
    rangeHigh: 1.57,
    verdictLevel: 'possible',
    direction: 'increase',
    verdictChanged: false,
  },
  noBacktestYet: false,
};
const RESULT: TrackedGameResultData = {
  kind: 'tracked_game_result',
  playerName: 'Player A',
  game: WEDNESDAY_GAME,
  result: CONTENT,
  statusReasonLabel: null,
  belowThreshold: null,
  targetUrl: `${BASE}${paths.alertSheet(14)}`,
  validationTableUrl: `${BASE}${paths.validationTable()}`,
};
// CL-TEL-16's player with no backtest: one tracked case, his profile values and SEN-31's label.
const NO_BACKTEST: TrackedGameResultData = {
  ...RESULT,
  playerName: 'Player D',
  result: {
    ...CONTENT,
    normalizedGap: -0.35,
    gapStatus: 'final',
    category: 'no_forecast',
    profile: {
      validCount: 1,
      meanGap: -0.35,
      rangeLow: -2.35,
      rangeHigh: 1.65,
      verdictLevel: 'inconclusive',
      direction: null,
      verdictChanged: false,
    },
    noBacktestYet: true,
  },
  belowThreshold: { validCount: 1, threshold: 5 },
  targetUrl: `${BASE}${paths.case(31)}`,
};

/** The lines of a result whose content differs from the first one's by `changes`. */
const withContent = (changes: Partial<TrackedResultContent>): readonly string[] =>
  linesOf(trackedGameResult({ ...RESULT, result: { ...CONTENT, ...changes } }, PARIS));

describe('the message of a tracked game result', () => {
  it('[TEL-13] [CL-TEL-16] writes a result with its gap, category, new profile values and verdict, then its two links', () => {
    expect(linesOf(trackedGameResult(RESULT, PARIS))).toStrictEqual([
      '<b>Egoscope · Results of 1 tracked game</b>',
      `Result for Player A, game of ${WEDNESDAY_TEXT}: +1.07, provisional.`,
      'Category: Confirmed.',
      'One case alone proves nothing.',
      'Profile: +0.86 over 8 valid cases, range +0.15 to +1.57, verdict unchanged',
      '<a href="https://egoscope.example/alerts/14">See the result</a>',
      '<a href="https://egoscope.example/validation">Validation table</a>',
    ]);
  });

  it('[TEL-13] writes a final gap without mention, and the new verdict when it changed', () => {
    const changed = withContent({
      gapStatus: 'final',
      category: 'refuted',
      profile: { ...CONTENT.profile, verdictLevel: 'probable', verdictChanged: true },
    });

    expect(changed.slice(1, 5)).toStrictEqual([
      `Result for Player A, game of ${WEDNESDAY_TEXT}: +1.07.`,
      'Category: Refuted.',
      'One case alone proves nothing.',
      'Profile: +0.86 over 8 valid cases, range +0.15 to +1.57, new verdict: probable, increase',
    ]);
    expect(withContent({ category: 'neutral' })[2]).toBe('Category: Neutral.');
  });

  it('[TEL-13] [CL-TEL-16] gives a player with no backtest his profile values, the SEN-31 label and the no-backtest mention', () => {
    expect(linesOf(trackedGameResult(NO_BACKTEST, PARIS)).slice(1, -2)).toStrictEqual([
      `Result for Player D, game of ${WEDNESDAY_TEXT}: ${MINUS}0.35.`,
      'Category: No forecast.',
      'One case alone proves nothing.',
      `Profile: ${MINUS}0.35 over 1 valid case, range ${MINUS}2.35 to +1.65, inconclusive for this player (1 valid case of the 5 needed)`,
      'no backtest yet: this case already counts in his profile, which rests only on his tracked cases',
    ]);
  });

  it('[TEL-13] [CA-TEL-21] marks a case recorded after tip-off and a late forecast', () => {
    expect(
      withContent({ recordedAfterTipOff: true, lateForecast: true }).slice(2, 4),
    ).toStrictEqual(['recorded after tip-off, does not count as a test', 'late forecast']);
  });

  it('[TEL-13] writes an indicative result with its comparison', () => {
    expect(
      withContent({
        kind: 'indicative',
        normalizedGap: null,
        gapStatus: null,
        indicativeComparison: 0.42,
      })[1],
    ).toBe(`Result for Player A, game of ${WEDNESDAY_TEXT}: +0.42, indicative.`);
  });

  it('[TEL-13] writes the reason in place of the measurement, without game and without category', () => {
    const excluded = trackedGameResult(
      {
        ...RESULT,
        game: null,
        result: { ...CONTENT, normalizedGap: null, category: null },
        statusReasonLabel: 'no game played within the window',
      },
      PARIS,
    );

    expect(linesOf(excluded).slice(1, 3)).toStrictEqual([
      'Result for Player A: no game played within the window.',
      'Profile: +0.86 over 8 valid cases, range +0.15 to +1.57, verdict unchanged',
    ]);
  });

  it('refuses a measured result that carries no gap, a bug of its composer', () => {
    expect(() => withContent({ normalizedGap: null })).toThrow(
      'A tracked result without a reason for its measurement needs its gap.',
    );
    expect(() => withContent({ kind: 'indicative', indicativeComparison: null })).toThrow(
      'A tracked result without a reason for its measurement needs its gap.',
    );
  });
});
