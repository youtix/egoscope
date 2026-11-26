// The digests (TEL-19, TEL-20, CL-TEL-11, CL-TEL-12, CL-TEL-14): the pass digest, the
// quiet-hours digest and the catch-up, kept within Telegram's limit by whole lines.

import { MESSAGE_MAX_LENGTH, textLength } from '@/lib/telegram';
import { formatCount, sentence } from '@/lib/wording';

import { clock, firstLine, link, message, plain } from './text';

import type { DigestData, DigestLine } from './data';

/** The first lines of a digest: its title, and the period of a catch-up (CL-TEL-11, CL-TEL-12). */
function digestHead(title: DigestData['title'], zone: string): readonly string[] {
  switch (title.kind) {
    case 'pass': {
      return [
        firstLine(
          sentence('notifications.digestTitle', {
            task: title.taskName,
            at: clock(title.passStartedAt, zone),
          }),
        ),
      ];
    }
    case 'tracked_results': {
      return [firstLine(sentence('notifications.resultsTitle', { n: formatCount(title.count) }))];
    }
    case 'quiet_hours': {
      return [
        firstLine(sentence('notifications.quietHoursTitle', { from: title.from, to: title.to })),
      ];
    }
    case 'catch_up': {
      return [
        firstLine(sentence('notifications.catchUpTitle')),
        plain(
          sentence('notifications.notReceived', {
            start: clock(title.periodStartAt, zone),
            end: clock(title.periodEndAt, zone),
          }),
        ),
      ];
    }
  }
}

/** One fact, one line, the line its link, "after tip-off" when its game has started (CL-TEL-12). */
function digestLine(line: DigestLine): string {
  const fact = link(line.url, line.text);
  // The sentence's own words hold no markup, so the link goes in as it is.
  return line.afterTipOff ? sentence('notifications.afterTipOffFact', { fact }) : fact;
}

/** "and N more", linked to Home, when facts are left out (TEL-19, CL-TEL-14). */
const moreLine = (count: number, homeUrl: string): string | null =>
  count === 0 ? null : link(homeUrl, sentence('notifications.andMore', { n: formatCount(count) }));

/**
 * A digest within Telegram's limit: the whole fact lines that fit, the others dropped from the
 * end and counted in "and N more", never a line cut (TEL-19, CL-TEL-14). The quiet-hours
 * digest and the catch-up end with a link to Home (TEL-20, CL-TEL-12).
 */
export function digest(data: DigestData, zone: string): string {
  const head = digestHead(data.title, zone);
  const lines = data.lines.map((line) => digestLine(line));
  const footer =
    data.kind === 'pass_digest'
      ? []
      : [link(data.homeUrl, sentence('notifications.everythingInApp'))];
  const composed = (kept: number): string =>
    message([
      ...head,
      ...lines.slice(0, kept),
      moreLine(data.moreCount + lines.length - kept, data.homeUrl),
      ...footer,
    ]);
  // From every fact down to none, the first count whose message fits; none when even the
  // title is over the limit.
  const counts = Array.from({ length: lines.length + 1 }, (_value, index) => lines.length - index);
  const kept = counts.find((count) => textLength(composed(count)) <= MESSAGE_MAX_LENGTH) ?? 0;
  return composed(kept);
}
