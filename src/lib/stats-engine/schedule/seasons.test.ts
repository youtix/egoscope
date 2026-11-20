import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { seasonOfDate } from './seasons';

import type { SeasonSpan } from './seasons';

// Stored seasons, framed by their first regular-season game and their last playoff
// game: the 1998-99 lockout season started in February, the 2019-20 Finals ended in
// October and the 2020-21 season started in December.
const STORED: readonly SeasonSpan[] = [
  { season: '1997-98', firstGameOn: '1997-10-31', lastGameOn: '1998-06-14' },
  { season: '1998-99', firstGameOn: '1999-02-05', lastGameOn: '1999-06-25' },
  { season: '1999-00', firstGameOn: '1999-11-02', lastGameOn: '2000-06-19' },
  { season: '2000-01', firstGameOn: '2000-10-31', lastGameOn: '2001-06-15' },
  { season: '2019-20', firstGameOn: '2019-10-22', lastGameOn: '2020-10-11' },
  { season: '2020-21', firstGameOn: '2020-12-22', lastGameOn: '2021-07-20' },
  { season: '2021-22', firstGameOn: '2021-10-19', lastGameOn: '2022-06-16' },
];

// 2025-26 is in progress, so its last game is not known yet; then its Finals are over.
const IN_PROGRESS: readonly SeasonSpan[] = [
  { season: '2024-25', firstGameOn: '2024-10-22', lastGameOn: '2025-06-22' },
  { season: '2025-26', firstGameOn: '2025-10-21', lastGameOn: null },
];
const ENDED: readonly SeasonSpan[] = [
  { season: '2024-25', firstGameOn: '2024-10-22', lastGameOn: '2025-06-22' },
  { season: '2025-26', firstGameOn: '2025-10-21', lastGameOn: '2026-06-19' },
];

// The first seasons the source covers, newest first: no season before them is ever stored.
const FIRST_COVERED: readonly SeasonSpan[] = [
  { season: '1994-95', firstGameOn: '1994-11-04', lastGameOn: '1995-06-14' },
  { season: '1993-94', firstGameOn: '1993-11-05', lastGameOn: '1994-06-22' },
];

const withoutSeason = (season: string): readonly SeasonSpan[] =>
  STORED.filter((span) => span.season !== season);

describe('seasonOfDate', () => {
  it('[STA-48] [CA-STA-17] [CL-STA-28] files 12 August 2021, between the 2020-21 Finals and the first game of 2021-22, under 2021-22, its schedule stored or not', () => {
    expect(seasonOfDate('2021-08-12', STORED)).toBe('2021-22');
    expect(seasonOfDate('2021-08-12', withoutSeason('2021-22'))).toBe('2021-22');
  });

  it.each([
    ['the first regular-season game of 2020-21', '2020-12-22', '2020-21'],
    ['a day between', '2021-03-01', '2020-21'],
    ['the last playoff game of 2020-21', '2021-07-20', '2020-21'],
    ['the day after that game', '2021-07-21', '2021-22'],
    ['the day before the first game of 2020-21', '2020-12-21', '2020-21'],
    ['the last game of Finals played in October', '2020-10-11', '2019-20'],
    ['the day after those Finals', '2020-10-12', '2020-21'],
  ])(
    '[STA-48] [H-STA-17] files a date from the first regular-season game of a season to its last playoff game under that season, and an offseason date under the next: %s',
    (_, date, season) => {
      expect(seasonOfDate(date, STORED)).toBe(season);
    },
  );

  it.each([
    ['a fall day before the lockout season', '1998-10-01', '1998-99'],
    ['a winter day before it', '1999-01-20', '1998-99'],
    ['its first game', '1999-02-05', '1998-99'],
    ['the summer after it', '1999-08-01', '1999-00'],
  ])(
    '[STA-48] [H-STA-17] files the offseason before a season that starts late in the winter under that season: %s',
    (_, date, season) => {
      expect(seasonOfDate(date, STORED)).toBe(season);
    },
  );

  it('[CL-STA-28] gives a game its season from its day, never from the file that lists it', () => {
    // The 1999-2000 files also list games of February to May 1999.
    const listedIn1999Files = ['1999-02-05', '1999-03-15', '1999-05-05', '1999-11-02'];

    expect(listedIn1999Files.map((day) => seasonOfDate(day, STORED))).toStrictEqual([
      '1998-99',
      '1998-99',
      '1998-99',
      '1999-00',
    ]);
  });

  it('[STA-48] [CL-STA-28] writes a season by its first year and the last two digits of the second, across a century', () => {
    expect(seasonOfDate('2000-01-15', STORED)).toBe('1999-00');
    expect(seasonOfDate('2000-11-15', STORED)).toBe('2000-01');
    expect(seasonOfDate('2009-03-01', [])).toBe('2008-09');
  });

  it.each([
    ['a spring day', '2026-04-30', '2025-26'],
    ['a day after the Finals of most seasons', '2026-06-30', '2025-26'],
    ['a day of its first year', '2025-11-01', '2025-26'],
    ['the offseason before it', '2025-08-01', '2025-26'],
  ])(
    '[STA-48] [CL-STA-21] files under a season in progress every date from the end of the season before: %s',
    (_, date, season) => {
      expect(seasonOfDate(date, IN_PROGRESS)).toBe(season);
    },
  );

  it('[STA-48] [CL-STA-30] files the days after the Finals under the coming season before its schedule is stored', () => {
    expect(seasonOfDate('2026-06-19', ENDED)).toBe('2025-26');
    expect(seasonOfDate('2026-06-20', ENDED)).toBe('2026-27');
    expect(seasonOfDate('2026-10-01', ENDED)).toBe('2026-27');
  });

  it.each([
    ['a spring day of 1990', '1990-03-01', '1989-90'],
    ['the day before the first covered game', '1993-11-04', '1992-93'],
    ['the first covered game', '1993-11-05', '1993-94'],
    ['a later day of that year', '1993-12-25', '1993-94'],
    ['a day of the next year', '1994-03-01', '1993-94'],
  ])(
    '[STA-48] [CL-STA-22] files a date whose year ends no stored season under the season that starts in that year from its first game on, otherwise under the one that ends in it: %s',
    (_, date, season) => {
      expect(seasonOfDate(date, FIRST_COVERED)).toBe(season);
    },
  );
});

const FIRST_YEAR = 1993;
const LAST_YEAR = 2030;

/** The name of the season whose first year is `year`, as the data model writes it. */
const nameOf = (year: number): string => `${String(year)}-${String(year + 1).slice(-2)}`;

const pad = (value: number): string => String(value).padStart(2, '0');

/** The day `day` of month `month` of `year`, written `YYYY-MM-DD`. */
const dayOf = (year: number, month: number, day: number): string =>
  `${String(year)}-${pad(month)}-${pad(day)}`;

// Seasons stored one after the other from FIRST_YEAR: each starts in October to
// December of its first year, or in January to March of its second as a lockout season
// did, and ends in April to September of its second year; the last one may be in
// progress.
const anyStart = fc.record({
  isLate: fc.boolean(),
  month: fc.integer({ min: 1, max: 3 }),
  day: fc.integer({ min: 1, max: 28 }),
});
const anyEnd = fc.record({
  month: fc.integer({ min: 4, max: 9 }),
  day: fc.integer({ min: 1, max: 28 }),
});
const anySeasons: fc.Arbitrary<SeasonSpan[]> = fc
  .tuple(
    fc.array(fc.tuple(anyStart, anyEnd), { minLength: 1, maxLength: LAST_YEAR - FIRST_YEAR }),
    fc.boolean(),
  )
  .map(([bounds, isLastInProgress]) =>
    bounds.map(([start, end], index) => {
      const year = FIRST_YEAR + index;
      const isInProgress = isLastInProgress && index === bounds.length - 1;
      return {
        season: nameOf(year),
        firstGameOn: start.isLate
          ? dayOf(year + 1, start.month, start.day)
          : dayOf(year, start.month + 9, start.day),
        lastGameOn: isInProgress ? null : dayOf(year + 1, end.month, end.day),
      };
    }),
  );

/** The oracle: the first season whose last game is not past, or else the next season. */
function expectedSeason(date: string, seasons: readonly SeasonSpan[]): string {
  const holding = seasons.find((span) => span.lastGameOn === null || date <= span.lastGameOn);
  return holding?.season ?? nameOf(FIRST_YEAR + seasons.length);
}

describe('seasonOfDate over seasons stored one after the other', () => {
  it('[STA-48] [H-STA-17] [CL-STA-28] files every date under the first season whose last game is not past, or after the last one under the next', () => {
    const anyDay = fc.record({
      seasons: anySeasons,
      yearOffset: fc.integer({ min: 1, max: LAST_YEAR - FIRST_YEAR }),
      month: fc.integer({ min: 1, max: 12 }),
      day: fc.integer({ min: 1, max: 28 }),
    });
    fc.assert(
      fc.property(anyDay, ({ seasons, yearOffset, month, day }) => {
        // A year from the second year of the first season to that of the last.
        const date = dayOf(FIRST_YEAR + Math.min(yearOffset, seasons.length), month, day);

        expect(seasonOfDate(date, seasons)).toBe(expectedSeason(date, seasons));
      }),
    );
  });
});
