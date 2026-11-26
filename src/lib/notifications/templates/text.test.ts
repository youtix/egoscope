import { describe, expect, it } from 'vitest';

import { toEpochMs, toIsoDate } from '@/lib/time';

import {
  belowThresholdLabel,
  clock,
  designation,
  eventLine,
  firstLine,
  gameText,
  link,
  message,
  plain,
  urgentLine,
  verdictText,
  writtenFor,
} from './text';

import type { EventDesignation } from './data';
import type { EpochMs } from '@/lib/time';

const PARIS = 'Europe/Paris';
const LOS_ANGELES = 'America/Los_Angeles';
const utc = (day: number, hour: number, minute = 0): EpochMs =>
  toEpochMs(Date.UTC(2026, 10, day, hour, minute));

// Monday 16 November 2026, 23:40 in Paris.
const PUBLISHED_AT = utc(16, 22, 40);
// Thursday 19 November 2026, 02:00 in Paris: Wednesday evening in the US.
const THURSDAY_GAME = { scheduledStartAt: utc(19, 1), opponentName: 'Team X' };
// Saturday 21 November 2026, 20:00 in Paris, the same date in the US.
const SATURDAY_GAME = { scheduledStartAt: utc(21, 19), opponentName: 'Team X' };
const detected = (
  typeName: string | null,
  precision: 'exact' | 'approximate' | 'none' = 'exact',
): EventDesignation => ({
  origin: 'detected',
  typeName,
  source: { outletName: 'A national outlet', publishedAt: PUBLISHED_AT, precision },
});
const BIRTHDAY: EventDesignation = {
  origin: 'calendar',
  typeName: 'Birthday game',
  game: {
    gameId: 7,
    scheduledStartAt: SATURDAY_GAME.scheduledStartAt,
    usDate: toIsoDate('2026-11-21'),
    opponentName: 'Team X',
    isHome: null,
  },
};

describe('the pieces of a message', () => {
  it('[TEL-08] escapes every value for the HTML of Telegram, the first line in bold', () => {
    expect(plain('Player <A> & "B"')).toBe('Player &lt;A&gt; &amp; &quot;B&quot;');
    expect(firstLine('Egoscope · Alert — Player <A>')).toBe(
      '<b>Egoscope · Alert — Player &lt;A&gt;</b>',
    );
    expect(link('https://egoscope.example/alerts/14?from=a&to="b"', 'See <sheet>')).toBe(
      '<a href="https://egoscope.example/alerts/14?from=a&amp;to=&quot;b&quot;">See &lt;sheet&gt;</a>',
    );
  });

  it('[TEL-08] writes one idea per line and leaves out the lines that are not there', () => {
    expect(message(['<b>Title</b>', null, 'One idea.', null, 'Another idea.'])).toBe(
      '<b>Title</b>\nOne idea.\nAnother idea.',
    );
    expect(message([])).toBe('');
  });

  it("[TEL-04] [CL-TEL-03] writes a clock time in the owner's zone, the zone named after it", () => {
    expect(clock(PUBLISHED_AT, PARIS)).toBe('Monday 16 November 2026, 23:40 Paris time');
    expect(clock(PUBLISHED_AT, LOS_ANGELES)).toBe(
      'Monday 16 November 2026, 14:40 Los Angeles time',
    );
  });

  it("[TEL-04] [CL-TEL-03] follows a game's start with its US date and part of day only when that date differs", () => {
    expect(gameText(THURSDAY_GAME, PARIS)).toBe(
      'Thursday 19 November 2026, 02:00 Paris time — Wednesday evening in the US, against Team X',
    );
    expect(gameText(SATURDAY_GAME, PARIS)).toBe(
      'Saturday 21 November 2026, 20:00 Paris time, against Team X',
    );
    expect(gameText(THURSDAY_GAME, LOS_ANGELES)).toBe(
      'Wednesday 18 November 2026, 17:00 Los Angeles time, against Team X',
    );
  });

  it('[TEL-06] [CA-TEL-05] [CL-TEL-21] designates an event by its type and source, a sensitive one without its type, a calendar one by its game', () => {
    expect(
      [
        detected('Public humiliation'),
        detected(null),
        detected('Public humiliation', 'approximate'),
        detected('Public humiliation', 'none'),
        BIRTHDAY,
      ].map((event) => designation(event, PARIS)),
    ).toStrictEqual([
      'Public humiliation, reported by A national outlet on Monday 16 November 2026, 23:40 Paris time',
      'sensitive event, reported by A national outlet on Monday 16 November 2026, 23:40 Paris time',
      'Public humiliation, reported by A national outlet on Monday 16 November 2026',
      'Public humiliation, reported by A national outlet, date unknown',
      'Birthday game, from the calendar, for the game of Saturday 21 November 2026, 20:00 Paris time, against Team X',
    ]);
    expect(eventLine(detected(null, 'none'), PARIS)).toBe(
      'Event: sensitive event, reported by A national outlet, date unknown',
    );
  });

  it('[TEL-21] adds the reason of an urgent message, and nothing to another', () => {
    expect([urgentLine(true), urgentLine(false)]).toStrictEqual([
      'The game starts before your quiet hours end.',
      null,
    ]);
  });

  it('[TEL-11] writes a verdict with its direction, the level alone when inconclusive or without direction', () => {
    expect([
      verdictText('possible', 'increase'),
      verdictText('probable', 'decrease'),
      verdictText('probable', null),
      verdictText('inconclusive', 'increase'),
    ]).toStrictEqual(['possible, increase', 'probable, decrease', 'probable', 'inconclusive']);
  });

  it('[TEL-11] [TEL-13] writes the label of a profile under the case threshold, in the singular for one case', () => {
    expect([belowThresholdLabel(4, 5), belowThresholdLabel(1, 5)]).toStrictEqual([
      'inconclusive for this player (4 valid cases of the 5 needed)',
      'inconclusive for this player (1 valid case of the 5 needed)',
    ]);
  });

  it('writes the text of a stored value from its table, and refuses a value that the table misses, a bug of the table', () => {
    const table = new Map<'written' | 'missing', () => string>([['written', () => 'Written']]);

    expect(writtenFor(table, 'written')).toBe('Written');
    expect(() => writtenFor(table, 'missing')).toThrow('No text is written for the value missing.');
  });
});
