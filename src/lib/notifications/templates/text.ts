// The pieces that every message of the catalogue is made of (TEL-04, TEL-06, TEL-07, TEL-08):
// escaped lines, the bold first line, links, clock times that name the zone, games and events.

import { formatDate, formatGameTime, formatInstant, userDay } from '@/lib/time';
import { formatCount, sentence } from '@/lib/wording';

import type { EventDesignation, VerdictDirection, VerdictLevel } from './data';
import type { EpochMs } from '@/lib/time';
import type { SentenceKey } from '@/lib/wording';

const LINE_BREAK = '\n';
/** Between the items of one list: caveat titles, sources (TEL-08). */
export const LIST_SEPARATOR = '; ';

const VERDICT_LEVELS = {
  possible: 'sensitivity.possible',
  probable: 'sensitivity.probable',
  inconclusive: 'sensitivity.inconclusive',
} as const satisfies Record<VerdictLevel, SentenceKey>;
const DIRECTIONS = {
  increase: 'sensitivity.increase',
  decrease: 'sensitivity.decrease',
} as const satisfies Record<VerdictDirection, SentenceKey>;

/**
 * The text that a table writes for a stored value (TEL-08). Every value of its set has a row,
 * so a missing one is a bug of the table.
 */
export function writtenFor<V extends string>(
  table: ReadonlyMap<V, () => string>,
  value: V,
): string {
  const write = table.get(value);
  if (write === undefined) {
    throw new Error(`No text is written for the value ${value}.`);
  }
  return write();
}

/** `text` made safe for Telegram's HTML mode, quotes included for an attribute. */
const escaped = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** A line of plain text, escaped for Telegram's HTML mode (TEL-08). */
export const plain = (text: string): string => escaped(text);

/** The first line "Egoscope · category — subject", in bold (TEL-08). */
export const firstLine = (text: string): string => `<b>${escaped(text)}</b>`;

/** A link to the exact screen, at the absolute address the data gives (TEL-07). */
export const link = (url: string, text: string): string =>
  `<a href="${escaped(url)}">${escaped(text)}</a>`;

/** The lines that are there, one idea per line (TEL-08). */
export const message = (lines: readonly (string | null)[]): string =>
  lines.filter((line) => line !== null).join(LINE_BREAK);

/** An instant in the owner's zone, the zone named (TEL-04, CL-TEL-03). */
export const clock = (instant: EpochMs, zone: string): string =>
  formatInstant(instant, zone, 'full');

/**
 * A game: its start in the owner's zone with the zone, its US date and part of day when
 * that date differs (TEL-04, CL-TEL-03, CL-IHM-07), and its opponent. The message data carries
 * no "time TBD" flag (notifications domain model §5), so the stored start is shown.
 */
export function gameText(
  game: Readonly<{ scheduledStartAt: EpochMs; opponentName: string }>,
  zone: string,
): string {
  const tipOff = { scheduledStartAt: game.scheduledStartAt, isStartTimeTbd: false };
  return sentence('notifications.gameAgainst', {
    start: formatGameTime(tipOff, zone, 'full'),
    opponent: game.opponentName,
  });
}

/**
 * An event by its type and source, or its type and derived game, never its description;
 * "sensitive event" for a type on an intimate subject (TEL-06, DSN-35, CL-TEL-21).
 */
export function designation(event: EventDesignation, zone: string): string {
  if (event.origin === 'calendar') {
    return sentence('notifications.fromCalendar', {
      type: event.typeName,
      game: gameText(event.game, zone),
    });
  }
  const type = event.typeName ?? sentence('notifications.sensitiveEvent');
  const { outletName, publishedAt, precision } = event.source;
  if (precision === 'none') {
    return sentence('notifications.reportedUndated', { type, outlet: outletName });
  }
  const published =
    precision === 'exact'
      ? clock(publishedAt, zone)
      : formatDate(userDay(publishedAt, zone), 'full');
  return sentence('notifications.reportedAt', { type, outlet: outletName, published });
}

/** The line "Event: …" of a message about an event (TEL-06, TEL-09, TEL-11). */
export const eventLine = (event: EventDesignation, zone: string): string =>
  plain(sentence('notifications.eventLine', { event: designation(event, zone) }));

/** The second line of an urgent message, which says why it is urgent (TEL-21). */
export const urgentLine = (isUrgent: boolean): string | null =>
  isUrgent ? plain(sentence('notifications.urgentReason')) : null;

/** A verdict: its level and direction, or the level alone when inconclusive (SEN-23, SEN-24). */
export function verdictText(level: VerdictLevel, direction: VerdictDirection | null): string {
  const levelText = sentence(VERDICT_LEVELS[level]);
  return level === 'inconclusive' || direction === null
    ? levelText
    : sentence('sensitivity.levelAndDirection', {
        level: levelText,
        direction: sentence(DIRECTIONS[direction]),
      });
}

/** The SEN-31 label of a profile under the case threshold (TEL-11, TEL-13). */
export const belowThresholdLabel = (validCount: number, threshold: number): string =>
  sentence('sensitivity.inconclusiveForPlayer', {
    k: formatCount(validCount),
    n: formatCount(threshold),
  });
