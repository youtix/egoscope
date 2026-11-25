import { describe, expect, it } from 'vitest';

import { leaguePlayerId } from '@/lib/testing';
import { toEpochMs } from '@/lib/time';

import { hasSameValues, profileReasons, verdictOf, versionInstant, viewOf } from './profile-rows';

import type { CaseScope, JobWrite, TrackedCaseTiming } from './profile-rows';
import type { EpochMs } from '@/lib/time';

// 2025-01-10 at noon UTC, the job's instant; the cases are dated by the hour around it.
const JOB_AT = toEpochMs(1_736_510_400_000);
const HOUR_MS = 3_600_000;
const at = (hours: number): EpochMs => toEpochMs(JOB_AT + hours * HOUR_MS);
const TYPE = 'media-storm';
const OTHER_TYPE = 'trade-rumor';
const PLAYER = leaguePlayerId('p01');
const OTHER_PLAYER = leaguePlayerId('p02');
// His profile of the type, and the type's trend, of every player.
const PAIR = { playerId: PLAYER, eventTypeId: TYPE };
const TREND = { playerId: null, eventTypeId: TYPE };

/** A job's write at `JOB_AT`, replacing the versions from `trackedCases` when given. */
function jobWith(trackedCases?: readonly TrackedCaseTiming[]): JobWrite {
  return {
    computedAt: JOB_AT,
    parameterSnapshotId: 1,
    causeOf: () => 'recalculation',
    versions: trackedCases === undefined ? { kind: 'append' } : { kind: 'replace', trackedCases },
  };
}

describe('the rows of profiles and trends', () => {
  it('[CL-SEN-16] refuses a profile or trend that is not whole, and a profile with a dominant player', () => {
    const views = [{ view: 'all_cases' as const }, { view: 'historical_only' as const }];

    expect(viewOf(views, 'historical_only')).toBe(views[1]);
    expect(() => viewOf(views, 'tracked_only')).toThrow(
      'A profile or a trend is written whole, and the view tracked_only is missing.',
    );
    expect(profileReasons(['high_dispersion', 'fragile_verdict'])).toStrictEqual([
      'high_dispersion',
      'fragile_verdict',
    ]);
    expect(() => profileReasons(['fragile_verdict', 'dominant_player'])).toThrow(
      'A profile has no dominant player: only a general trend does.',
    );
  });

  it('[SEN-36] [CL-SEN-16] compares the values of two rows, whatever the order of their keys, their computation aside', () => {
    const written = {
      validCount: 3,
      tallyReasons: { awaitingGame: { pending: 1 }, excluded: {} },
      confidenceStepDownReasons: ['high_dispersion'],
      computedAt: new Date(JOB_AT),
      parameterSnapshotId: 2,
    };
    const stored = {
      id: 7,
      parameterSnapshotId: 1,
      computedAt: new Date(at(-1)),
      confidenceStepDownReasons: ['high_dispersion'],
      tallyReasons: { excluded: {}, awaitingGame: { pending: 1 } },
      validCount: 3,
    };

    expect(hasSameValues(stored, written)).toBe(true);
    expect(hasSameValues({ ...stored, validCount: 4 }, written)).toBe(false);
    expect(hasSameValues({ ...stored, confidenceStepDownReasons: [] }, written)).toBe(false);
    expect(hasSameValues({ ...stored, tallyReasons: { excluded: {} } }, written)).toBe(false);
  });

  it('[SEN-37] reads the verdict and the profile confidence of a row', () => {
    const rows = [
      { verdictLevel: 'possible', verdictDirection: 'decrease', profileConfidence: 'medium' },
      { verdictLevel: 'inconclusive', verdictDirection: null, profileConfidence: 'low' },
    ] as const;

    expect(rows.map((row) => verdictOf(row))).toStrictEqual([
      { verdict: { level: 'possible', direction: 'decrease' }, profileConfidence: 'medium' },
      { verdict: { level: 'inconclusive', direction: null }, profileConfidence: 'low' },
    ]);
  });

  it('[CL-SEN-18] [CL-SUI-03] dates an appended version at the job instant, and the replacing one at the creation of the earliest tracked case of the pair, or of the type for a trend, whose game has not started', () => {
    // The tracked cases by the hours of their creation and of their game's start, from the job's instant.
    type Case = readonly [number, number | null, string?, typeof PLAYER?];
    const replacementAt = (scope: CaseScope, cases: readonly Case[]) =>
      versionInstant(
        scope,
        jobWith(
          cases.map(([created, start, eventTypeId = TYPE, playerId = PLAYER]) => ({
            playerId,
            eventTypeId,
            createdAt: at(created),
            gameStartAt: start === null ? null : at(start),
          })),
        ),
      );
    const cases: readonly Case[] = [
      [-30, -1],
      [-20, 0],
      [-10, null],
      [-5, 2],
      [-40, null, OTHER_TYPE],
    ];
    const otherPlayerCases: readonly Case[] = [
      [-5, 2],
      [-15, 3, TYPE, OTHER_PLAYER],
    ];

    expect(versionInstant(PAIR, jobWith())).toBe(JOB_AT);
    expect([
      replacementAt(PAIR, []),
      replacementAt(PAIR, cases),
      replacementAt(PAIR, [
        [-5, 2],
        [-3, null],
      ]),
      replacementAt(PAIR, [[-30, -1]]),
      replacementAt(PAIR, otherPlayerCases),
      replacementAt(TREND, otherPlayerCases),
      replacementAt(TREND, cases),
    ]).toStrictEqual([JOB_AT, at(-10), at(-5), JOB_AT, at(-5), at(-15), at(-10)]);
  });
});
