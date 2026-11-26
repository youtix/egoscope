import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { firstYearOf, seasonOfDate, seasonSpan, seasonStartingIn } from './seasons';

import type { SeasonOfDateResult, SeasonSpan, SeasonSpanInput } from './seasons';

const filed = (season: string): SeasonOfDateResult => ({ ok: true, season });

const notRead = (ending: string, starting: string): SeasonOfDateResult => ({
  ok: false,
  error: { kind: 'season_not_read', candidates: [ending, starting] },
});

// Stored seasons, framed by their first regular-season game and their last playoff
// game: the 1998-99 and 2011-12 lockout seasons started in February and on Christmas
// Day, the 2019-20 Finals ended in October and the 2020-21 season started in December.
const STORED: readonly SeasonSpan[] = [
  { season: '1997-98', firstGameOn: '1997-10-31', lastGameOn: '1998-06-14' },
  { season: '1998-99', firstGameOn: '1999-02-05', lastGameOn: '1999-06-25' },
  { season: '1999-00', firstGameOn: '1999-11-02', lastGameOn: '2000-06-19' },
  { season: '2000-01', firstGameOn: '2000-10-31', lastGameOn: '2001-06-15' },
  { season: '2010-11', firstGameOn: '2010-10-26', lastGameOn: '2011-06-12' },
  { season: '2011-12', firstGameOn: '2011-12-25', lastGameOn: '2012-06-21' },
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

// 2016-17 alone, before the season before it is read.
const ONLY_2016_17: readonly SeasonSpan[] = [
  { season: '2016-17', firstGameOn: '2016-10-25', lastGameOn: '2017-06-12' },
];

// A season whose end was never found, then the next one.
const END_NOT_FOUND: readonly SeasonSpan[] = [
  { season: '2020-21', firstGameOn: '2020-12-22', lastGameOn: null },
  { season: '2021-22', firstGameOn: '2021-10-19', lastGameOn: '2022-06-16' },
];

// The first seasons the source covers, newest first: no season before them is ever stored.
const FIRST_COVERED: readonly SeasonSpan[] = [
  { season: '1994-95', firstGameOn: '1994-11-04', lastGameOn: '1995-06-14' },
  { season: '1993-94', firstGameOn: '1993-11-05', lastGameOn: '1994-06-22' },
];

const withoutSeason = (season: string): readonly SeasonSpan[] =>
  STORED.filter((span) => span.season !== season);

describe('seasonOfDate', () => {
  it('[STA-48] [CA-STA-17] [CL-STA-28] files 12 August 2021, between the 2020-21 Finals and the first game of 2021-22, under 2021-22, its schedule stored or not, and the last Finals game under 2020-21', () => {
    const without2021 = withoutSeason('2021-22');

    expect(seasonOfDate('2021-08-12', STORED)).toStrictEqual(filed('2021-22'));
    expect(seasonOfDate('2021-08-12', without2021)).toStrictEqual(filed('2021-22'));
    expect(seasonOfDate('2021-07-20', without2021)).toStrictEqual(filed('2020-21'));
  });

  it('[STA-48] [CL-STA-28] cannot tell the season of a date while neither season it can belong to is stored, and names both, the one that ends in its year first', () => {
    expect(seasonOfDate('2021-08-12', [])).toStrictEqual(notRead('2020-21', '2021-22'));
    expect(seasonOfDate('2016-11-15', [])).toStrictEqual(notRead('2015-16', '2016-17'));
  });

  it.each([
    ['a day of its first year', '2016-11-15', filed('2016-17')],
    ['its first game', '2016-10-25', filed('2016-17')],
    ['the day before', '2016-10-24', notRead('2015-16', '2016-17')],
    ['the summer before', '2016-08-01', notRead('2015-16', '2016-17')],
  ])(
    "[STA-48] [CL-STA-28] files a date under the season that starts in its year from that season's first game on, and cannot tell it before while the season before is not stored: %s",
    (_, date, expected) => {
      expect(seasonOfDate(date, ONLY_2016_17)).toStrictEqual(expected);
    },
  );

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
      expect(seasonOfDate(date, STORED)).toStrictEqual(filed(season));
    },
  );

  it.each([
    ['a fall day before the 1998-99 lockout season', '1998-10-01', '1998-99'],
    ['a winter day before it', '1999-01-20', '1998-99'],
    ['its first game', '1999-02-05', '1998-99'],
    ['the summer after it', '1999-08-01', '1999-00'],
    ['a fall day before the 2011-12 lockout season', '2011-11-01', '2011-12'],
    ['the day before its first game', '2011-12-24', '2011-12'],
    ['that first game, on Christmas Day', '2011-12-25', '2011-12'],
  ])(
    '[STA-48] [H-STA-17] files the offseason before a season that starts late under that season: %s',
    (_, date, season) => {
      expect(seasonOfDate(date, STORED)).toStrictEqual(filed(season));
    },
  );

  it('[CL-STA-28] gives a game its season from its day, never from the file that lists it', () => {
    // The 1999-2000 files also list games of February to May 1999.
    const listedIn1999Files = ['1999-02-05', '1999-03-15', '1999-05-05', '1999-11-02'];

    expect(listedIn1999Files.map((day) => seasonOfDate(day, STORED))).toStrictEqual([
      filed('1998-99'),
      filed('1998-99'),
      filed('1998-99'),
      filed('1999-00'),
    ]);
  });

  it('[STA-48] [CL-STA-28] writes a season by its first year and the last two digits of the second, across a century', () => {
    expect(seasonOfDate('2000-01-15', STORED)).toStrictEqual(filed('1999-00'));
    expect(seasonOfDate('2000-11-15', STORED)).toStrictEqual(filed('2000-01'));
    expect(seasonOfDate('2000-03-01', [])).toStrictEqual(notRead('1999-00', '2000-01'));
  });

  it.each([
    ['a spring day', '2026-04-30', '2025-26'],
    ['a day after the Finals of most seasons', '2026-06-30', '2025-26'],
    ['a day of its first year', '2025-11-01', '2025-26'],
    ['the offseason before it', '2025-08-01', '2025-26'],
  ])(
    '[STA-48] [CL-STA-21] files under a season in progress every date from the end of the season before: %s',
    (_, date, season) => {
      expect(seasonOfDate(date, IN_PROGRESS)).toStrictEqual(filed(season));
    },
  );

  it.each([
    ['a day of its second year', '2021-08-12', '2020-21'],
    ['the day before the first game of 2021-22', '2021-10-18', '2020-21'],
    ['that first game', '2021-10-19', '2021-22'],
    ['a later day of 2021', '2021-12-01', '2021-22'],
  ])(
    '[STA-48] [CL-STA-28] never files under a season whose end was never found a date from the first game of the next stored season on: %s',
    (_, date, season) => {
      expect(seasonOfDate(date, END_NOT_FOUND)).toStrictEqual(filed(season));
    },
  );

  it('[STA-48] [CL-STA-30] files the days after the Finals under the coming season before its schedule is stored', () => {
    expect(seasonOfDate('2026-06-19', ENDED)).toStrictEqual(filed('2025-26'));
    expect(seasonOfDate('2026-06-20', ENDED)).toStrictEqual(filed('2026-27'));
    expect(seasonOfDate('2026-10-01', ENDED)).toStrictEqual(filed('2026-27'));
  });

  it.each([
    ['a spring day of 1990', '1990-03-01', notRead('1989-90', '1990-91')],
    ['the day before the first covered game', '1993-11-04', notRead('1992-93', '1993-94')],
    ['the first covered game', '1993-11-05', filed('1993-94')],
    ['a later day of that year', '1993-12-25', filed('1993-94')],
    ['a day of the next year', '1994-03-01', filed('1993-94')],
  ])(
    '[STA-48] [CL-STA-22] [CL-STA-28] cannot tell the season of a day before the first game of the first season the source covers, and files the days from that game on: %s',
    (_, date, expected) => {
      expect(seasonOfDate(date, FIRST_COVERED)).toStrictEqual(expected);
    },
  );
});

const FIRST_YEAR = 1993;
const LAST_YEAR = 2030;
const MAX_SEASONS = LAST_YEAR - FIRST_YEAR;

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
    fc.array(fc.tuple(anyStart, anyEnd), { minLength: 1, maxLength: MAX_SEASONS }),
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

// Such seasons and a day of a year in which one of them ends.
const anyStoredDay = fc
  .record({
    seasons: anySeasons,
    yearOffset: fc.integer({ min: 1, max: MAX_SEASONS }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
  })
  .map(({ seasons, yearOffset, month, day }) => ({
    seasons,
    date: dayOf(FIRST_YEAR + Math.min(yearOffset, seasons.length), month, day),
  }));

// Whether each stored season is removed, by its rank.
const anyRemoval = fc.array(fc.boolean(), { minLength: MAX_SEASONS, maxLength: MAX_SEASONS });

/** The oracle: the first season whose last game is not past, or else the next season. */
function expectedSeason(date: string, seasons: readonly SeasonSpan[]): string {
  const holding = seasons.find((span) => span.lastGameOn === null || date <= span.lastGameOn);
  return holding?.season ?? nameOf(FIRST_YEAR + seasons.length);
}

/**
 * The spans that tell the season of `date` on their own: that of the season that ends
 * in its year, and that of the season that starts in it once its first game is past.
 */
function decidingSpans(date: string, seasons: readonly SeasonSpan[]): readonly SeasonSpan[] {
  const year = Number(date.slice(0, 4));
  return seasons.filter(
    (span) =>
      span.season === nameOf(year - 1) ||
      (span.season === nameOf(year) && date >= span.firstGameOn),
  );
}

describe('seasonOfDate over seasons stored one after the other', () => {
  it('[STA-48] [H-STA-17] [CL-STA-28] files every date of the years they end in under the first season whose last game is not past, or after the last one under the next', () => {
    fc.assert(
      fc.property(anyStoredDay, ({ seasons, date }) => {
        expect(seasonOfDate(date, seasons)).toStrictEqual(filed(expectedSeason(date, seasons)));
      }),
    );
  });

  it('[STA-48] [CL-STA-28] gives season_not_read for a date once the spans that decide it are removed, never another season', () => {
    fc.assert(
      fc.property(anyStoredDay, anyRemoval, ({ seasons, date }, removal) => {
        const kept = seasons.filter((_, rank) => removal[rank] !== true);
        const year = Number(date.slice(0, 4));
        const isDecided = decidingSpans(date, kept).length > 0;
        const expected = isDecided
          ? filed(expectedSeason(date, seasons))
          : notRead(nameOf(year - 1), nameOf(year));

        expect(seasonOfDate(date, kept)).toStrictEqual(expected);
      }),
    );
  });
});

/** What the games module reads of 2020-21: its Finals over, won on 20 July 2021. */
const FINALS_OVER: SeasonSpanInput = {
  season: '2020-21',
  firstRegularSeasonGameOn: '2020-12-22',
  lastPlayoffGameOn: '2021-07-20',
  // A seventh game still listed after the deciding win.
  lastGameOn: '2021-07-22',
  isFinalsOver: true,
};

/** What it reads of 2025-26 in progress: its Finals tied two games to two after game 4. */
const FINALS_UNDER_WAY: SeasonSpanInput = {
  season: '2025-26',
  firstRegularSeasonGameOn: '2025-10-21',
  lastPlayoffGameOn: '2026-06-12',
  lastGameOn: '2026-06-12',
  isFinalsOver: false,
};

/** What it reads of a past season whose Finals the source left unfinished. */
const FINALS_UNFINISHED: SeasonSpanInput = {
  season: '2002-03',
  firstRegularSeasonGameOn: '2002-10-29',
  lastPlayoffGameOn: '2003-06-11',
  // A fifth Finals game still listed as scheduled.
  lastGameOn: '2003-06-13',
  isFinalsOver: false,
};

describe('seasonSpan', () => {
  it('[STA-48] [CL-STA-30] closes a season whose Finals are over on its last final playoff game, never on a game listed after it', () => {
    expect(seasonSpan(FINALS_OVER)).toStrictEqual({
      season: '2020-21',
      firstGameOn: '2020-12-22',
      lastGameOn: '2021-07-20',
    });
  });

  it('[STA-48] [CL-STA-30] closes a season whose Finals are over on its last game when none of its playoff games is final, never leaving it open', () => {
    const input: SeasonSpanInput = {
      season: '2002-03',
      firstRegularSeasonGameOn: '2002-10-29',
      lastPlayoffGameOn: null,
      lastGameOn: '2003-04-16',
      isFinalsOver: true,
    };

    expect(seasonSpan(input)).toStrictEqual({
      season: '2002-03',
      firstGameOn: '2002-10-29',
      lastGameOn: '2003-04-16',
    });
  });

  it.each([
    ['its Finals under way', FINALS_UNDER_WAY],
    [
      'its regular season under way',
      { ...FINALS_UNDER_WAY, lastPlayoffGameOn: null, lastGameOn: '2026-04-12' },
    ],
  ])(
    '[STA-48] [CL-STA-18] [CL-STA-20] leaves open the latest season while its Finals are not over: %s',
    (_, input) => {
      expect(seasonSpan(input)).toStrictEqual({
        season: '2025-26',
        firstGameOn: '2025-10-21',
        lastGameOn: null,
      });
    },
  );

  it('[STA-48] [CL-STA-18] leaves open a past season whose stored Finals are unfinished, and closes it on its last final playoff game once they are said over, as the caller says once a later season has a game', () => {
    expect(seasonSpan(FINALS_UNFINISHED)).toStrictEqual({
      season: '2002-03',
      firstGameOn: '2002-10-29',
      lastGameOn: null,
    });
    expect(seasonSpan({ ...FINALS_UNFINISHED, isFinalsOver: true })).toStrictEqual({
      season: '2002-03',
      firstGameOn: '2002-10-29',
      lastGameOn: '2003-06-11',
    });
  });

  it('[STA-48] closes a past season whose playoffs the source does not list on its last regular-season game', () => {
    const input = {
      ...FINALS_UNFINISHED,
      lastPlayoffGameOn: null,
      lastGameOn: '2003-04-16',
      isFinalsOver: true,
    };

    expect(seasonSpan(input)?.lastGameOn).toBe('2003-04-16');
  });

  it('[STA-48] gives no span to a season without a regular-season game', () => {
    expect(seasonSpan({ ...FINALS_OVER, firstRegularSeasonGameOn: null })).toBeNull();
    expect(
      seasonSpan({
        ...FINALS_UNFINISHED,
        firstRegularSeasonGameOn: null,
        isFinalsOver: true,
      }),
    ).toBeNull();
  });
});

// The first years of the seasons that the property writes, from 1947-48 to 2099-00,
// across two centuries.
const FIRST_SEASON_YEAR = 1947;
const LAST_SEASON_YEAR = 2099;

describe('firstYearOf', () => {
  it('[STA-48] [CL-STA-28] reads the first year of a season from its name, across a century', () => {
    expect(firstYearOf('2024-25')).toBe(2024);
    expect(firstYearOf('1999-00')).toBe(1999);
    expect(firstYearOf('2000-01')).toBe(2000);
    expect(firstYearOf('2019-20')).toBe(2019);
  });

  it('[STA-48] [CL-STA-28] gives back the first year of every season it is written from', () => {
    fc.assert(
      fc.property(fc.integer({ min: FIRST_SEASON_YEAR, max: LAST_SEASON_YEAR }), (year) => {
        expect(firstYearOf(nameOf(year))).toBe(year);
      }),
    );
  });
});

describe('seasonStartingIn', () => {
  it('[STA-48] [CL-STA-28] names a season by its first year and the last two digits of the second, across a century', () => {
    expect(seasonStartingIn(2024)).toBe('2024-25');
    expect(seasonStartingIn(1999)).toBe('1999-00');
    expect(seasonStartingIn(2000)).toBe('2000-01');
    expect(seasonStartingIn(2008)).toBe('2008-09');
  });
});
