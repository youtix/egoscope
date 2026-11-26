import { describe, expect, it } from 'vitest';

import registryKeys from '@data/fixtures/params/registry-keys.json';
import engineParams from '@data/fixtures/stats-engine/engine-params.json';

import { isBelowThreshold, isConfidenceNearThreshold, isSmallTrend } from './caveat-thresholds';

import type { ProfileConfidence } from '../profiles/confidence';
import type { CaveatProfile, CaveatThresholds, CaveatTrend } from './caveat-thresholds';

/** The registry's default of a parameter that is no calculation parameter. */
function registryDefault(key: string): number {
  const entry = registryKeys.find((candidate) => candidate.key === key);
  if (typeof entry?.default !== 'number') {
    throw new TypeError(`The registry fixture gives ${key} no number default.`);
  }
  return entry.default;
}

// The registry's defaults: 5 valid cases, 3 players, 70 points and a margin of 10, so a
// confidence below 80 is near the threshold.
const DEFAULTS: CaveatThresholds = {
  minValidCases: engineParams.sensitivity.minValidCases,
  trendMinPlayers: engineParams.sensitivity.trendMinPlayers,
  detectionThreshold: registryDefault('detection.threshold'),
  confidenceVigilanceMargin: registryDefault('alerts.confidenceVigilanceMargin'),
};

// A raised set, which an owner may choose: 8 valid cases, 4 players, 80 points and a margin
// of 5, so a confidence below 85 is near the threshold.
const RAISED: CaveatThresholds = {
  minValidCases: 8,
  trendMinPlayers: 4,
  detectionThreshold: 80,
  confidenceVigilanceMargin: 5,
};

/** A decided, complete and current profile on `validCount` valid cases. */
function profile(validCount: number): CaveatProfile {
  return {
    validCount,
    verdict: { level: 'possible', direction: 'increase' },
    profileConfidence: 'medium',
    isIncomplete: false,
    earlierVersionCaseCount: 0,
  };
}

/** A general trend on `validCount` valid cases of `playerCount` players. */
function trend(
  validCount: number,
  playerCount: number,
  profileConfidence: ProfileConfidence = 'medium',
): CaveatTrend {
  return { validCount, playerCount, profileConfidence };
}

describe('isBelowThreshold', () => {
  it('[ALE-16] [CL-ALE-05] compares the valid cases of a profile with the threshold it is given', () => {
    const rows = [
      { validCount: 7, raised: true, defaults: false },
      { validCount: 8, raised: false, defaults: false },
      { validCount: 4, raised: true, defaults: true },
    ];

    expect(
      rows.map(({ validCount }) => ({
        validCount,
        raised: isBelowThreshold(profile(validCount), RAISED),
        defaults: isBelowThreshold(profile(validCount), DEFAULTS),
      })),
    ).toStrictEqual(rows);
  });
});

describe('isSmallTrend', () => {
  it('[ALE-16] [CL-ALE-05] compares the valid cases and players of a general trend with the thresholds it is given', () => {
    const rows = [
      { trend: trend(7, 4), raised: true, defaults: false },
      { trend: trend(8, 3), raised: true, defaults: false },
      { trend: trend(8, 4), raised: false, defaults: false },
      { trend: trend(8, 4, 'low'), raised: true, defaults: true },
      { trend: null, raised: true, defaults: true },
    ];

    expect(
      rows.map((row) => ({
        trend: row.trend,
        raised: isSmallTrend(row.trend, RAISED),
        defaults: isSmallTrend(row.trend, DEFAULTS),
      })),
    ).toStrictEqual(rows);
  });
});

describe('isConfidenceNearThreshold', () => {
  it('[ALE-16] [H-ALE-06] compares a detection confidence with the threshold and margin it is given, never an owner classification', () => {
    const rows = [
      { confidence: 84, raised: true, defaults: false },
      { confidence: 85, raised: false, defaults: false },
      { confidence: 79, raised: true, defaults: true },
      { confidence: null, raised: false, defaults: false },
    ];

    expect(
      rows.map(({ confidence }) => ({
        confidence,
        raised: isConfidenceNearThreshold(confidence, RAISED),
        defaults: isConfidenceNearThreshold(confidence, DEFAULTS),
      })),
    ).toStrictEqual(rows);
  });
});
