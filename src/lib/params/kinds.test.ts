import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  choice,
  decimal,
  domainList,
  increasingMinutes,
  integer,
  listed,
  minutesOf,
  modelId,
  optionalHttpsAddress,
  quotaLimit,
  timeOfDay,
  timeRange,
  timesOfDay,
  timeZone,
  toggle,
} from './kinds';
import { DAYS, HOURS, MEGABYTES, MINUTES, PERCENT, REQUESTS } from './units';

import type { ValueKind } from './kinds';

/** What `kind` makes of each of `values`. */
const parsed = <V>(kind: ValueKind<V>, values: readonly unknown[]) =>
  values.map((value) => kind.parse(value));

// One code point, two UTF-16 units.
const EMOJI = '😀';
const EMOJI_MODEL_LENGTH = 4;
const ADDRESS_MAX_LENGTH = 2000;

/** As many refusals as `values`. */
const refused = (values: readonly unknown[]) => values.map(() => undefined);

describe('the kinds of values', () => {
  it('[CL-TRV-16] accepts a whole number within its inclusive bounds and nothing else', () => {
    const days = integer(1, 90, DAYS);
    const outside = [0, 91, 1.5, '5', null, NaN];

    expect(parsed(days, [1, 30, 90])).toStrictEqual([1, 30, 90]);
    expect(parsed(days, outside)).toStrictEqual(refused(outside));
    expect(days.allowed).toBe('1 to 90 days');
  });

  it('[TRV-42] writes a whole number with its separator and the noun that agrees with it', () => {
    expect([1, 30].map((value) => integer(1, 90, DAYS).write(value))).toStrictEqual([
      '1 day',
      '30 days',
    ]);
    expect(integer(1, 1440, MINUTES).write(1440)).toBe('1,440 minutes');
    expect([integer(0, 100, PERCENT).write(80), integer(0, 100).write(5)]).toStrictEqual([
      '80%',
      '5',
    ]);
    expect(integer(0, 100).allowed).toBe('0 to 100');
  });

  it('[CL-TRV-16] accepts a decimal on its step within its bounds', () => {
    const delay = decimal({ min: 0.25, max: 24, step: 0.25 }, HOURS);
    const outside = [0, 0.3, 24.25, '1', true];

    expect(parsed(delay, [0.25, 1, 1.5, 24])).toStrictEqual([0.25, 1, 1.5, 24]);
    expect(parsed(delay, outside)).toStrictEqual(refused(outside));
    expect(delay.allowed).toBe('0.25 to 24 hours, step 0.25');
  });

  it('[CL-TRV-16] stores a decimal a rounding error away from its step on the step itself, as it is written', () => {
    const ratio = decimal({ min: 0.5, max: 10, step: 0.1 });
    const delay = decimal({ min: 0.25, max: 24, step: 0.25 }, HOURS);

    expect(parsed(ratio, [2 + 1e-11, 1.1 + 2.2, 2 - 1e-11])).toStrictEqual([2, 3.3, 2]);
    expect(parsed(delay, [0.75 + 1e-12, 23.75 - 1e-12])).toStrictEqual([0.75, 23.75]);
  });

  it('[TRV-42] [CL-TRV-16] writes a decimal with no more decimals than its step, and its unit', () => {
    const delay = decimal({ min: 0.25, max: 24, step: 0.25 }, HOURS);

    expect([1, 1.5, 0.25].map((value) => delay.write(value))).toStrictEqual([
      '1 hour',
      '1.5 hours',
      '0.25 hours',
    ]);
    expect(decimal({ min: 0.5, max: 4, step: 0.5 }, MEGABYTES).write(2)).toBe('2 MB');
    expect(decimal({ min: 0, max: 10, step: 1 }).allowed).toBe('0 to 10, step 1');
  });

  it('[CL-TRV-16] accepts every tenth of its range and refuses every value between two tenths', () => {
    const ratio = decimal({ min: 0.5, max: 10, step: 0.1 });

    fc.assert(
      fc.property(fc.integer({ min: 5, max: 99 }), (tenths) => {
        const value = tenths / 10;

        expect([ratio.parse(value), ratio.parse(value + 0.05)]).toStrictEqual([value, undefined]);
      }),
    );
  });

  it('[CL-TRV-16] reads a switch as a boolean only, written on or off', () => {
    const switched = toggle();

    expect(parsed(switched, [true, false, 'on', 1])).toStrictEqual([
      true,
      false,
      undefined,
      undefined,
    ]);
    expect([switched.write(true), switched.write(false), switched.allowed]).toStrictEqual([
      'on',
      'off',
      'on / off',
    ]);
  });

  it('[CL-TRV-16] accepts one of the stored codes of a choice, written by its label', () => {
    const phase = choice([
      ['postseason', 'postseason'],
      ['regular_season', 'regular season'],
    ]);

    expect(parsed(phase, ['regular_season', 'toString', 'regular season', 2])).toStrictEqual([
      'regular_season',
      undefined,
      undefined,
      undefined,
    ]);
    expect([phase.write('regular_season'), phase.allowed]).toStrictEqual([
      'regular season',
      'postseason / regular season',
    ]);
  });

  it('[CL-TRV-16] reads a time of day in the strict HH:MM form only', () => {
    const time = timeOfDay('any time of day, HH:MM');
    const malformed = ['24:00', '7:30', '16:30:00', 990];

    expect(['00:00', '16:30', '23:59'].map((value) => minutesOf(value))).toStrictEqual([
      0, 990, 1439,
    ]);
    expect(malformed.map((value) => minutesOf(value))).toStrictEqual(refused(malformed));
    expect([time.parse('15:00'), time.parse('15h00'), time.write('15:00')]).toStrictEqual([
      '15:00',
      undefined,
      '15:00',
    ]);
    expect(time.allowed).toBe('any time of day, HH:MM');
  });

  it('[CL-TRV-16] accepts 1 to 6 distinct times at least an hour apart around the clock, stored in the order of the day', () => {
    const times = timesOfDay({ min: 1, max: 6, gapMinutes: 60 });
    const outside = [
      [],
      ['16:30', '17:00'],
      ['23:30', '00:15'],
      ['16:30', '16:30'],
      ['16:30', 990],
      ['00:00', '02:00', '04:00', '06:00', '08:00', '10:00', '12:00'],
      '16:30',
    ];

    expect(
      parsed(times, [
        ['23:00', '16:30'],
        ['23:30', '00:30'],
      ]),
    ).toStrictEqual([
      ['16:30', '23:00'],
      ['00:30', '23:30'],
    ]);
    expect(parsed(times, outside)).toStrictEqual(refused(outside));
    expect([times.write(['16:30', '23:00']), times.allowed]).toStrictEqual([
      '16:30 and 23:00',
      '1 to 6 distinct times of day, at least 60 minutes apart',
    ]);
  });

  it('[CL-TRV-16] accepts a range of the day that may span midnight, equal ends meaning none', () => {
    const range = timeRange();
    const outside = [
      { start: '23:00' },
      { start: '25:00', end: '08:00' },
      { start: '23:00', end: '8:00' },
      { start: '23:00', end: '08:00', days: 7 },
      '23:00-08:00',
    ];

    expect(range.parse({ start: '23:00', end: '08:00' })).toStrictEqual({
      start: '23:00',
      end: '08:00',
    });
    expect(parsed(range, outside)).toStrictEqual(refused(outside));
    expect([
      range.write({ start: '23:00', end: '08:00' }),
      range.write({ start: '08:00', end: '08:00' }),
    ]).toStrictEqual(['23:00 to 08:00', 'none']);
  });

  it('[CL-TRV-16] accepts 1 to 10 strictly increasing intervals of 1 to 1,440 minutes', () => {
    const intervals = increasingMinutes({ maxCount: 10, eachMax: 1440 });
    const outside = [
      [],
      [5, 1],
      [1, 1],
      [0, 5],
      [1, 1441],
      [1, 2.5],
      Array.from({ length: 11 }, (_, index) => index + 1),
      5,
    ];

    expect(intervals.parse([1, 5, 15, 30, 60])).toStrictEqual([1, 5, 15, 30, 60]);
    expect(parsed(intervals, outside)).toStrictEqual(refused(outside));
    expect([intervals.write([1, 5, 15]), intervals.write([1440])]).toStrictEqual([
      '1, 5 and 15 minutes',
      '1,440 minutes',
    ]);
    expect(intervals.allowed).toBe('1 to 10 values, strictly increasing, each 1 to 1,440 minutes');
  });

  it('[CL-TRV-16] accepts lowercase domain names without scheme or path, distinct and stored sorted', () => {
    const domains = domainList(2);
    const outside = [
      ['News.example'],
      ['https://news.example'],
      ['news.example/path'],
      ['localhost'],
      ['a.example', 'b.example', 'c.example'],
      'news.example',
    ];

    expect(
      parsed(domains, [[], ['news.example', 'blog.example'], ['news.example', 'news.example']]),
    ).toStrictEqual([[], ['blog.example', 'news.example'], ['news.example']]);
    expect(parsed(domains, outside)).toStrictEqual(refused(outside));
    expect([domains.write([]), domains.write(['news.example'])]).toStrictEqual([
      '0 domains',
      '1 domain',
    ]);
    expect(domains.allowed).toBe('0 to 2 domain names, lowercase, without scheme or path');
  });

  it('[CL-TRV-16] accepts a model identifier without spaces, up to its length', () => {
    const model = modelId(12);
    const outside = ['two words', '', 'm'.repeat(13), 7];

    expect(model.parse('@cf/model-1')).toBe('@cf/model-1');
    expect(parsed(model, outside)).toStrictEqual(refused(outside));
    expect([model.write('@cf/model-1'), model.allowed]).toStrictEqual([
      '@cf/model-1',
      'a model identifier, without spaces, of at most 12 characters',
    ]);
  });

  it('[CL-TRV-16] counts the characters of a model identifier as code points, not UTF-16 units', () => {
    const model = modelId(EMOJI_MODEL_LENGTH);
    const full = EMOJI.repeat(EMOJI_MODEL_LENGTH);
    const outside = [EMOJI.repeat(EMOJI_MODEL_LENGTH + 1), `${EMOJI} ${EMOJI}`, ''];

    expect(model.parse(full)).toBe(full);
    expect(parsed(model, outside)).toStrictEqual(refused(outside));
  });

  it('[IHM-14] [CL-IHM-05] stores a zone of the IANA database in its own spelling, written as its city time', () => {
    const zone = timeZone();

    expect(parsed(zone, ['europe/paris', 'America/New_York'])).toStrictEqual([
      'Europe/Paris',
      'America/New_York',
    ]);
    expect(parsed(zone, ['Mars/Olympus', '+02:00', 1])).toStrictEqual(refused([1, 2, 3]));
    expect([zone.write('Europe/Paris'), zone.allowed]).toStrictEqual([
      'Paris time',
      'any zone of the IANA time-zone database',
    ]);
  });

  it('[IHM-44] accepts no address, or an https address of at most 2,000 characters', () => {
    const tool = optionalHttpsAddress();
    const address = 'https://search.example/?q=';
    const outside = [
      'http://search.example',
      'not an address',
      `https://${'a'.repeat(1992)}.example`,
      5,
    ];

    expect(parsed(tool, ['', address])).toStrictEqual(['', address]);
    expect(parsed(tool, outside)).toStrictEqual(refused(outside));
    expect([tool.write(''), tool.write(address), tool.allowed]).toStrictEqual([
      'none',
      address,
      'empty, or an https address of at most 2,000 characters',
    ]);
  });

  it('[IHM-44] counts the characters of an address as code points, not UTF-16 units', () => {
    const tool = optionalHttpsAddress();
    const start = 'https://search.example/?q=';
    const full = `${start}${EMOJI.repeat(ADDRESS_MAX_LENGTH - start.length)}`;
    const tooLong = `${full}${EMOJI}`;

    expect(full.length).toBeGreaterThan(ADDRESS_MAX_LENGTH);
    expect(tool.parse(full)).toBe(full);
    expect(tool.parse(tooLong)).toBeUndefined();
  });

  it('[IHM-44] counts a newline and a lone surrogate of an address as one character each', () => {
    const tool = optionalHttpsAddress();
    const start = 'https://search.example/?q=';
    const lonePair = '\u{D83D}';
    const withNewline = `${start}\n${'a'.repeat(ADDRESS_MAX_LENGTH - start.length - 1)}`;
    const withLone = `${start}${lonePair.repeat(ADDRESS_MAX_LENGTH - start.length)}`;

    expect([tool.parse(withNewline), tool.parse(withLone)]).toStrictEqual([withNewline, withLone]);
    expect([tool.parse(`${withNewline}a`), tool.parse(`${withLone}${lonePair}`)]).toStrictEqual([
      undefined,
      undefined,
    ]);
  });

  it('[TRV-03] leaves a quota limit unset until the owner enters a whole number of at least 1', () => {
    const limit = quotaLimit(REQUESTS);

    expect(parsed(limit, [1, 100_000])).toStrictEqual([1, 100_000]);
    expect(parsed(limit, [0, null, 2.5])).toStrictEqual(refused([0, null, 2.5]));
    expect([limit.write(null), limit.write(1), limit.write(100_000)]).toStrictEqual([
      'not set',
      '1 request',
      '100,000 requests',
    ]);
    expect(limit.allowed).toBe(
      'empty until entered, then an integer of at least 1; an unset limit fails the installation check',
    );
  });

  it('[TRV-42] lists values as people do', () => {
    expect([[], ['a'], ['a', 'b'], ['a', 'b', 'c']].map((items) => listed(items))).toStrictEqual([
      '',
      'a',
      'a and b',
      'a, b and c',
    ]);
  });
});
