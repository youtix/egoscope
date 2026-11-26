import { describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { coverageContext, coverageOf, postseasonStateOf } from './stored-schedule';

import type { SeasonRead } from './stored-schedule';
import type { PhaseGame, PhaseSeries, SeasonSchedule, SeasonSpan } from '@/lib/stats-engine';
import type { EpochMs } from '@/lib/time';

// 1 November 2025 and 1 July 2025, noon in New York.
const IN_SEASON = toEpochMs(Date.UTC(2025, 10, 1, 16, 0));
const IN_SUMMER = toEpochMs(Date.UTC(2025, 6, 1, 16, 0));
const FIRST_COVERED = '2024-25';
const ENDED: SeasonSpan = {
  season: '2024-25',
  firstGameOn: '2024-10-22',
  lastGameOn: '2025-06-16',
};
// 2025-26 once its schedule is stored, before its first game.
const STORED: SeasonSpan = { season: '2025-26', firstGameOn: '2025-10-21', lastGameOn: null };
// 2025-26 as stored before its games are read.
const UNREAD: SeasonRead = { season: '2025-26', phasesWithLines: [], coverageFetchedAt: null };

/** The coverage of 2025-26, its games not read, at `at` with the spans `spans` stored. */
const unreadCoverageAt = (at: EpochMs, spans: readonly SeasonSpan[]) =>
  coverageOf(UNREAD, coverageContext({ at, firstCoveredSeason: FIRST_COVERED }, spans));

// The 2024-25 Finals between teams 1 and 3, one win needed, and its one game.
const FINALS: PhaseSeries = {
  phase: 'playoffs',
  round: 'finals',
  teamAId: 1,
  teamBId: 3,
  winsNeeded: 1,
};
const FINALS_GAME: PhaseGame = {
  id: 1,
  phase: 'playoffs',
  status: 'final',
  homeTeamId: 1,
  awayTeamId: 3,
  finalScore: { home: 101, away: 99 },
  scheduledStartAt: toEpochMs(Date.UTC(2025, 5, 16, 0, 30)),
  consolidatedAt: toEpochMs(Date.UTC(2025, 5, 19, 0, 30)),
};
const SCHEDULED_FINALS_GAME: PhaseGame = {
  ...FINALS_GAME,
  status: 'scheduled',
  finalScore: null,
  consolidatedAt: null,
};
const UNFINISHED = { finished: false, lastGameConsolidated: false };

const scheduleOf = (games: readonly PhaseGame[], series: readonly PhaseSeries[]) =>
  ({ games, series, hasLaterSeasonGame: false }) satisfies SeasonSchedule;

describe('the coverage of a season whose games are not read', () => {
  it('[STA-45] [CL-SEN-05] is pending while the season is in progress', () => {
    expect(unreadCoverageAt(IN_SEASON, [ENDED, STORED])).toBe('pending');
  });

  it('[STA-45] [CL-STA-30] [CL-SEN-05] is pending between seasons once the coming schedule is stored', () => {
    expect(unreadCoverageAt(IN_SUMMER, [ENDED, STORED])).toBe('pending');
  });

  it('[STA-45] [CL-STA-30] is covered for the coming season between seasons while its schedule is not published', () => {
    const context = coverageContext({ at: IN_SUMMER, firstCoveredSeason: FIRST_COVERED }, [ENDED]);
    expect(context).toStrictEqual({
      at: IN_SUMMER,
      firstCoveredSeason: FIRST_COVERED,
      spans: [ENDED],
      todayOn: '2025-07-01',
      coming: '2025-26',
    });
    expect(coverageOf(UNREAD, context)).toBe('covered');
  });

  it('[STA-45] [CL-STA-28] is pending when no stored span tells the season of the day', () => {
    expect(unreadCoverageAt(IN_SEASON, [])).toBe('pending');
  });
});

describe('the postseason state of a team', () => {
  it('[STA-20] [STA-22] finishes the postseason of a team that never entered it once the Finals are played', () => {
    const played = scheduleOf([FINALS_GAME], [FINALS]);
    expect(postseasonStateOf(played, 2)).toStrictEqual({
      finished: true,
      lastGameConsolidated: false,
    });
  });

  it('[STA-20] [STA-22] keeps it unfinished while the Finals go on or are not listed', () => {
    expect(postseasonStateOf(scheduleOf([SCHEDULED_FINALS_GAME], [FINALS]), 2)).toStrictEqual(
      UNFINISHED,
    );
    expect(postseasonStateOf(scheduleOf([], []), 2)).toStrictEqual(UNFINISHED);
  });

  it('[STA-20] gives a team of the Finals the state of its own games', () => {
    const played = scheduleOf([FINALS_GAME], [FINALS]);
    expect(postseasonStateOf(played, 3)).toStrictEqual({
      finished: true,
      lastGameConsolidated: true,
    });
  });
});
