import { eq } from 'drizzle-orm';
import { describe, expect, it, onTestFinished } from 'vitest';

import { createTestDatabase, seasons } from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';
import { toEpochMs } from '@/lib/time';

import { calendarWarnings, firstCoveredSeason } from './calendar-warnings';

import type { CalendarFacts } from './calendar-warnings';
import type { Database } from '@/lib/db';

const AT = toEpochMs(Date.UTC(2026, 10, 20, 8, 15));
const SOURCE = { statsSource: 'sportsdataverse_espn' } as const;
// A season whose games were read, with lines in the regular season, or without any line.
const READ_WITHOUT_LINES = { ...SOURCE, coverageFetchedAt: new Date(AT) };
const READ_WITH_LINES = { ...READ_WITHOUT_LINES, phasesWithLines: ['regular_season' as const] };

/** A fresh database, closed when the test ends. */
async function openDatabase(): Promise<Database> {
  const database = await createTestDatabase();
  onTestFinished(database.close);
  return database.db;
}

describe('the first covered season', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  it('[CL-STA-22] answers null while no season is stored', async () => {
    await expect(firstCoveredSeason(await openDatabase())).resolves.toBeNull();
  });

  it('[CL-STA-22] [CL-STA-12] names the earliest season met, pending until its games are read, before the seasons read', async () => {
    const db = await openDatabase();
    await db.insert(seasons).values([
      { season: '2024-25', ...READ_WITH_LINES },
      { season: '2025-26', ...SOURCE },
    ]);

    await expect(firstCoveredSeason(db)).resolves.toBe('2024-25');
    // The service sheet's first season, met as the app meets every covered season.
    await db.insert(seasons).values({ season: '1993-94', ...SOURCE });
    await expect(firstCoveredSeason(db)).resolves.toBe('1993-94');
  });

  it('[CL-STA-22] leaves out an ended season read without any line, and keeps the latest, which may not have ended', async () => {
    const db = await openDatabase();
    await db.insert(seasons).values([
      { season: '2010-11', ...READ_WITHOUT_LINES },
      { season: '2011-12', ...READ_WITH_LINES },
      { season: '2026-27', ...READ_WITHOUT_LINES },
    ]);

    await expect(firstCoveredSeason(db)).resolves.toBe('2011-12');
    await db.delete(seasons).where(eq(seasons.season, '2011-12'));
    await expect(firstCoveredSeason(db)).resolves.toBe('2026-27');
  });
});

/** The facts of a profile of `calendarDerivation`, his birthday recorded and his first game unknown, from 1993-94. */
function factsOf(calendarDerivation: CalendarFacts['calendarDerivation']): CalendarFacts {
  return {
    calendarDerivation,
    birthdayMonth: 10,
    firstNbaSeason: null,
    firstCoveredSeason: '1993-94',
  };
}

describe('the warnings of a calendar-derived profile', () => {
  it('[CL-JOU-18] [CL-STA-24] notes on a former-team profile the first covered season, with which its team history starts', () => {
    expect(calendarWarnings(factsOf('former_team'))).toStrictEqual([
      { kind: 'team_history_from', season: '1993-94' },
    ]);
    expect(calendarWarnings({ ...factsOf('former_team'), firstCoveredSeason: null })).toStrictEqual(
      [],
    );
  });

  it('[CL-STA-24] [CL-STA-12] counts birthday games from the first covered season while his first game is unknown or earlier, not once it is in a covered season', () => {
    const counted = [{ kind: 'birthday_counted_from', season: '1993-94' }];

    expect(calendarWarnings(factsOf('birthday'))).toStrictEqual(counted);
    expect(calendarWarnings({ ...factsOf('birthday'), firstNbaSeason: '1992-93' })).toStrictEqual(
      counted,
    );
    expect(calendarWarnings({ ...factsOf('birthday'), firstNbaSeason: '1993-94' })).toStrictEqual(
      [],
    );
    expect(calendarWarnings({ ...factsOf('birthday'), firstNbaSeason: '2004-05' })).toStrictEqual(
      [],
    );
  });

  it('[CL-JOU-16] warns of a birthday not recorded on a birthday profile alone, and of nothing on another type', () => {
    expect(calendarWarnings({ ...factsOf('birthday'), birthdayMonth: null })).toStrictEqual([
      { kind: 'birthday_not_recorded' },
    ]);
    expect(calendarWarnings({ ...factsOf('former_team'), birthdayMonth: null })).toStrictEqual([
      { kind: 'team_history_from', season: '1993-94' },
    ]);
    expect(calendarWarnings(factsOf(null))).toStrictEqual([]);
  });
});
