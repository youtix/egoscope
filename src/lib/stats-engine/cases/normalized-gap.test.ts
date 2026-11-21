import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import engineParams from '@data/fixtures/stats-engine/engine-params.json';

import { seasonBaseline } from '../baseline/season-baseline';
import { normalizedGap } from './normalized-gap';

import type { BaselineGame, SeasonBaseline } from '../baseline/season-baseline';
import type { EngineParams } from '../types';
import type { GapBaseline } from './normalized-gap';

// The registry's defaults. JSON gives the baseline phase as a string, which the comparison
// narrows to a BaselinePhase (types.test.ts).
const DEFAULTS: EngineParams = {
  ...engineParams,
  games: {
    ...engineParams.games,
    postseasonBaseline:
      engineParams.games.postseasonBaseline === 'regular_season' ? 'regular_season' : 'postseason',
  },
};

const DAY = 86_400_000;
// Raw values compare within 1e-9 (CL-STA-09).
const RAW_DIGITS = 9;
// A gap is shown with two decimals, a baseline's mean and deviation with three (CL-STA-09).
const GAP_DIGITS = 2;
const BASELINE_DIGITS = 3;

// CA-STA-02: the ten usable games of a finished season, the measured game left out.
const CA_STA_02_INDICES = [0.42, 0.55, 0.61, 0.48, 0.7, 0.52, 0.66, 0.39, 0.58, 0.63];
const CA_STA_02_MEASURED_INDEX = 0.8;
const MEASURED_GAME_ID = 99;

/** A usable regular-season game of index `performanceIndex`, on day `id` of the season. */
const usable = (id: number, performanceIndex: number): BaselineGame => ({
  gameId: id,
  scheduledStartAt: id * DAY,
  phase: 'regular_season',
  classification: 'usable',
  performanceIndex,
});

/**
 * The baseline of CA-STA-02's finished season, its last game consolidated, without the game
 * `excludedGameId`.
 */
function caSta02Baseline(excludedGameId: number): SeasonBaseline {
  const others = CA_STA_02_INDICES.map((index, position) => usable(position + 1, index));
  const games = [...others, usable(MEASURED_GAME_ID, CA_STA_02_MEASURED_INDEX)];
  const phaseState = { finished: true, lastGameConsolidated: true };
  return seasonBaseline({ games, phase: 'regular_season', excludedGameId, phaseState }, DEFAULTS);
}

/** The final or provisional baseline that a gap is computed against, narrowed from `baseline`. */
function gapBaselineOf(baseline: SeasonBaseline): GapBaseline {
  if (baseline.status === 'final' || baseline.status === 'provisional') {
    return baseline;
  }
  throw new Error(`a ${baseline.status} baseline gives no gap`);
}

describe('normalizedGap', () => {
  it('[SEN-08] [CA-SEN-07] gives 1.16 for an index of 0.751 against a mean of 0.513 and a deviation of 0.205', () => {
    const gap = normalizedGap(0.751, { status: 'final', mean: 0.513, standardDeviation: 0.205 });

    expect(gap.normalizedGap).toBeCloseTo(1.16, GAP_DIGITS);
  });

  it('[SEN-09] never rounds the gap: (0.751 − 0.513) ÷ 0.205 stays 238 ÷ 205, 1.1609756…', () => {
    const gap = normalizedGap(0.751, { status: 'final', mean: 0.513, standardDeviation: 0.205 });

    expect(gap.normalizedGap).toBeCloseTo(238 / 205, RAW_DIGITS);
    expect(gap.normalizedGap).not.toBeCloseTo(1.16, 4);
  });

  it('[SEN-08] [CA-STA-02] [STA-16] [STA-17] [STA-19] [STA-20] gives 10 games, a mean of 0.554, a deviation of 0.102 and a final gap of 2.41 without the measured game', () => {
    const left = caSta02Baseline(MEASURED_GAME_ID);
    const gap = normalizedGap(CA_STA_02_MEASURED_INDEX, gapBaselineOf(left));

    expect(left.gameCount).toBe(10);
    expect(left.mean).toBeCloseTo(0.554, BASELINE_DIGITS);
    expect(left.standardDeviation).toBeCloseTo(0.102, BASELINE_DIGITS);
    expect(gap.normalizedGap).toBeCloseTo(2.41, GAP_DIGITS);
    expect(gap.gapStatus).toBe('final');
  });

  it('[SEN-08] [CA-STA-02] [STA-16] [STA-17] [STA-19] [STA-20] would give 0.576, 0.122 and only 1.83 if the measured game were kept', () => {
    // A game id that is none of the season's keeps the measured game in its own baseline.
    const kept = caSta02Baseline(0);
    const gap = normalizedGap(CA_STA_02_MEASURED_INDEX, gapBaselineOf(kept));

    expect(kept.gameCount).toBe(11);
    expect(kept.mean).toBeCloseTo(0.576, BASELINE_DIGITS);
    expect(kept.standardDeviation).toBeCloseTo(0.122, BASELINE_DIGITS);
    expect(gap.normalizedGap).toBeCloseTo(1.83, GAP_DIGITS);
  });

  it.each([
    ['provisional', 'provisional'],
    ['final', 'final'],
  ] as const)('[SEN-09] gives a %s gap against a %s baseline', (gapStatus, status) => {
    const gap = normalizedGap(0.5, { status, mean: 0.6, standardDeviation: 0.2 });

    expect(gap.normalizedGap).toBeCloseTo(-0.5, RAW_DIGITS);
    expect(gap.gapStatus).toBe(gapStatus);
  });

  it('[SEN-08] [SEN-09] measures the index from the mean in deviations, above as below it, unrounded', () => {
    const baseline = fc.record({
      status: fc.constantFrom<GapBaseline['status']>('final', 'provisional'),
      mean: fc.double({ min: 0, max: 3, noNaN: true }),
      standardDeviation: fc.double({ min: 0.01, max: 2, noNaN: true }),
    });

    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 3, noNaN: true }),
        baseline,
        (performanceIndex, { status, mean, standardDeviation }) => {
          const gap = normalizedGap(performanceIndex, { status, mean, standardDeviation });

          expect(gap.normalizedGap * standardDeviation).toBeCloseTo(
            performanceIndex - mean,
            RAW_DIGITS,
          );
          expect(Math.sign(gap.normalizedGap)).toBe(Math.sign(performanceIndex - mean));
          expect(gap.gapStatus).toBe(status);
        },
      ),
    );
  });
});
