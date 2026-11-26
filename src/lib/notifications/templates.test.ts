import { describe, expect, it } from 'vitest';

import { paths } from '@/lib/navigation';
import { toEpochMs, toIsoDate } from '@/lib/time';
import { assertNoBettingWords } from '@/lib/wording';

import { renderMessage } from './templates';

import type {
  AlertData,
  EventDesignation,
  MessageGame,
  MessageProfile,
  TemplateData,
  TrackedGameResultData,
} from './templates/data';
import type { EpochMs } from '@/lib/time';

const PARIS = 'Europe/Paris';
const LOS_ANGELES = 'America/Los_Angeles';
const BASE = 'https://egoscope.example';
const url = (path: string): string => `${BASE}${path}`;
const utc = (day: number, hour: number, minute = 0): EpochMs =>
  toEpochMs(Date.UTC(2026, 10, day, hour, minute));
const firstLineOf = (text: string): string => text.split('\n', 1)[0] ?? '';
/** The lines of a text that hold the word "forecast". */
const forecastLines = (text: string): readonly string[] =>
  text.split('\n').filter((line) => /forecast/iu.test(line));
/** The addresses that a message links to, as its HTML writes them. */
const hrefsOf = (text: string): readonly string[] =>
  Array.from(text.matchAll(/href="(?<href>[^"]*)"/gu), (match) => match.groups?.['href'] ?? '');
/** Every absolute address that the data of a message carries. */
const addressesOf = (data: TemplateData): readonly string[] =>
  JSON.stringify(data).match(/https:\/\/egoscope\.example[^"]*/gu) ?? [];

const game = (scheduledStartAt: EpochMs, usDate: string): MessageGame => ({
  gameId: 7,
  scheduledStartAt,
  usDate: toIsoDate(usDate),
  opponentName: 'Team X',
  isHome: null,
});
// Thursday 19 November 2026, 02:00 in Paris: Wednesday evening in the US.
const THURSDAY_GAME = game(utc(19, 1), '2026-11-18');
// Wednesday 18 November 2026, 01:30 in Paris: Tuesday evening in the US.
const WEDNESDAY_GAME = game(utc(18, 0, 30), '2026-11-17');
const EVENT: EventDesignation = {
  origin: 'detected',
  typeName: 'Public humiliation',
  source: { outletName: 'A national outlet', publishedAt: utc(16, 22, 40), precision: 'exact' },
};
const PROFILE: MessageProfile = {
  meanGap: 0.83,
  rangeLow: 0.07,
  rangeHigh: 1.59,
  validCount: 7,
  historicalCount: 5,
  trackedCount: 2,
  verdictLevel: 'possible',
  direction: 'increase',
  profileConfidence: 'low',
};

const ALERT: AlertData = {
  kind: 'alert',
  sheetNumber: 14,
  playerName: 'Player A',
  events: [EVENT],
  sections: [
    {
      typeName: 'Public humiliation',
      values: {
        kind: 'profile',
        profile: PROFILE,
      },
    },
  ],
  expectedGame: WEDNESDAY_GAME,
  caveatKinds: ['small_sample'],
  isLate: false,
  isUrgent: false,
  typeNotCovered: false,
  complementaryRequest: true,
  sheetUrl: url(paths.alertSheet(14)),
};
const RESULT: TrackedGameResultData = {
  kind: 'tracked_game_result',
  playerName: 'Player A',
  game: WEDNESDAY_GAME,
  result: {
    kind: 'final',
    normalizedGap: 1.07,
    gapStatus: 'provisional',
    indicativeComparison: null,
    category: 'confirmed',
    recordedAfterTipOff: false,
    lateForecast: false,
    profile: {
      validCount: 8,
      meanGap: 0.86,
      rangeLow: 0.15,
      rangeHigh: 1.57,
      verdictLevel: 'possible',
      direction: 'increase',
      verdictChanged: false,
    },
    noBacktestYet: false,
  },
  statusReasonLabel: null,
  belowThreshold: null,
  targetUrl: url(paths.alertSheet(14)),
  validationTableUrl: url(paths.validationTable()),
};
const REQUEST_URL = url(paths.request(12));

// One message of every kind, for the rules that hold for all of them.
const EVERY_KIND: readonly TemplateData[] = [
  {
    kind: 'backtest_request_to_do',
    playerName: 'Player B',
    teamName: 'Team Z',
    event: EVENT,
    deadline: THURSDAY_GAME,
    timeRemainingMs: utc(19, 1) - utc(17, 7),
    tipOffPassed: false,
    isUrgent: false,
    requestUrl: REQUEST_URL,
  },
  {
    kind: 'deadline_changed',
    playerName: 'Player B',
    event: EVENT,
    deadline: WEDNESDAY_GAME,
    timeRemainingMs: utc(18, 0, 30) - utc(17, 4, 30),
    previousDeadlineStartAt: utc(21, 19),
    typeNotInRequest: true,
    tipOffPassed: false,
    isUrgent: false,
    requestUrl: REQUEST_URL,
  },
  {
    kind: 'deadline_reminder',
    playerName: 'Player B',
    deadline: THURSDAY_GAME,
    leadHours: 6,
    isUrgent: true,
    requestUrl: REQUEST_URL,
  },
  ALERT,
  {
    kind: 'alert_update',
    sheetNumber: 15,
    playerName: 'Player E',
    change: {
      kind: 'expected_game_changed',
      previousGame: THURSDAY_GAME,
      reason: 'postponed',
      expectedGame: game(utc(23, 0), '2026-11-22'),
    },
    sheetStatus: 'open',
    isUrgent: false,
    sheetUrl: url(paths.alertSheet(15)),
  },
  RESULT,
  {
    kind: 'new_type_proposal',
    name: 'Benching',
    definition: 'Public loss of a starting spot.',
    articleCount: 3,
    proposedAt: utc(17, 6),
    typeUrl: url(paths.typeSheet('benching')),
  },
  {
    kind: 'incident_start',
    incidentKind: 'press_source_down',
    subjects: ['A national outlet, NBA section'],
    since: utc(16, 6),
    classification: null,
    url: url(paths.pressSources()),
  },
  {
    kind: 'incident_reminder',
    incidentKind: 'quota_reached',
    subjects: ['Language model'],
    since: utc(17, 6),
    classification: {
      waitingArticles: 70,
      nearestPlayer: { playerName: 'Player C', game: THURSDAY_GAME },
      plannedResumeAt: utc(18, 6),
      cause: 'limit_reached',
    },
    url: url(paths.journal(42)),
  },
  {
    kind: 'incident_end',
    incidentKind: 'stats_source_unavailable',
    subjects: [],
    startedAt: utc(19, 5, 10),
    endedAt: utc(19, 10, 50),
    url: url(paths.journal(43)),
  },
  { kind: 'export_reminder', lastExportAt: utc(1, 9), exportUrl: url(paths.settings()) },
  {
    kind: 'pass_digest',
    title: {
      kind: 'pass',
      taskName: 'Evening collection and detection',
      passStartedAt: utc(18, 22),
    },
    lines: [{ text: 'Alert — Player A', afterTipOff: false, url: url(paths.alertSheet(14)) }],
    moreCount: 2,
    homeUrl: url(paths.home()),
  },
  {
    kind: 'quiet_hours_digest',
    title: { kind: 'quiet_hours', from: '23:00', to: '08:00' },
    lines: [{ text: 'Tracked result — Player F', afterTipOff: true, url: url(paths.case(40)) }],
    moreCount: 0,
    homeUrl: url(paths.home()),
  },
  {
    kind: 'catch_up',
    title: { kind: 'catch_up', periodStartAt: utc(18, 8), periodEndAt: utc(18, 10, 30) },
    lines: [{ text: 'Backtest to do — Player B', afterTipOff: false, url: REQUEST_URL }],
    moreCount: 0,
    homeUrl: url(paths.home()),
  },
  { kind: 'link_confirmation', settingsUrl: url(paths.notifications()) },
  { kind: 'test_message', sentAt: utc(26, 9, 15), settingsUrl: url(paths.notifications()) },
  {
    kind: 'daily_cap_reached',
    sentCount: 20,
    nextDayStartsAt: utc(26, 23),
    homeUrl: url(paths.home()),
  },
  { kind: 'chat_unlinked_notice' },
];

describe('renderMessage', () => {
  it('[TEL-08] [TEL-06] begins every kind with a first line that holds only its category and subject', () => {
    expect(EVERY_KIND.map((data) => firstLineOf(renderMessage(data, PARIS)))).toStrictEqual([
      '<b>Egoscope · Backtest to do — Player B</b>',
      '<b>Egoscope · Backtest to do — Player B, deadline changed</b>',
      "<b>Egoscope · Urgent reminder — Player B's backtest still to do</b>",
      '<b>Egoscope · Alert — Player A</b>',
      "<b>Egoscope · Update — Player E's alert</b>",
      '<b>Egoscope · Results of 1 tracked game</b>',
      '<b>Egoscope · New type proposed</b>',
      '<b>Egoscope · Incident — Press source down</b>',
      '<b>Egoscope · Incident — Quota reached — Language model</b>',
      '<b>Egoscope · Incident resolved — Stats source unavailable</b>',
      '<b>Egoscope · Incident — Export reminder</b>',
      '<b>Egoscope · Digest — Evening collection and detection, Wednesday 18 November 2026, 23:00 Paris time</b>',
      '<b>Egoscope · During quiet hours (23:00 – 08:00)</b>',
      '<b>Egoscope · Catch-up</b>',
      '<b>Egoscope · Telegram linked</b>',
      '<b>Egoscope · Test message</b>',
      '<b>Egoscope · Daily cap reached</b>',
      '<b>Egoscope · Telegram not linked</b>',
    ]);
  });

  it("[TEL-04] [CL-TEL-03] writes every clock time in the owner's zone, the zone named after it, in English", () => {
    const texts = EVERY_KIND.map((data) => renderMessage(data, LOS_ANGELES)).join('\n');

    expect(texts.match(/\d{4}, \d{2}:\d{2}/gu)).toHaveLength(23);
    expect(texts.match(/\d{4}, \d{2}:\d{2} Los Angeles time/gu)).toHaveLength(23);
    expect(texts).not.toContain('Paris');
    expect(texts.replaceAll(/[\n\u{20}-\u{7E}·—–\u{2212}]/gu, '')).toBe('');
  });

  it('[VUE-02] [TEL-05] [TEL-08] holds no betting word, "forecast" only in the alert closing line and the tracked-result terms, and no provider name', () => {
    const texts = EVERY_KIND.map((data) => renderMessage(data, PARIS));
    const forecasts = renderMessage(
      { ...RESULT, result: { ...RESULT.result, lateForecast: true, category: 'no_forecast' } },
      PARIS,
    );

    expect(() => {
      for (const text of [...texts, forecasts]) {
        assertNoBettingWords(text);
      }
    }).not.toThrow();
    expect(texts.flatMap((text) => forecastLines(text))).toStrictEqual([
      'A measure of the past, not a forecast.',
    ]);
    expect(forecastLines(forecasts)).toStrictEqual(['late forecast', 'Category: No forecast.']);
    expect(
      texts.filter((text) =>
        /groq|workers ai|cloudflare|hugging face|neon|vercel|github|espn/iu.test(text),
      ),
    ).toStrictEqual([]);
  });

  it('[TEL-07] links every message but the unlinked notice to the absolute addresses of its data, and to nothing else', () => {
    const links = EVERY_KIND.map((data) => hrefsOf(renderMessage(data, PARIS)));
    const strangers = EVERY_KIND.map((data) =>
      hrefsOf(renderMessage(data, PARIS)).filter((href) => !addressesOf(data).includes(href)),
    );

    expect(links.map((hrefs) => hrefs.length > 0)).toStrictEqual(
      EVERY_KIND.map((data) => data.kind !== 'chat_unlinked_notice'),
    );
    expect(strangers).toStrictEqual(EVERY_KIND.map(() => []));
  });

  it('[TEL-08] escapes every value for the HTML of Telegram', () => {
    const text = renderMessage(
      { ...ALERT, playerName: 'Player <A> & "B"', sheetUrl: `${BASE}/alerts/14?from=a&to=b` },
      PARIS,
    );

    expect(firstLineOf(text)).toBe(
      '<b>Egoscope · Alert — Player &lt;A&gt; &amp; &quot;B&quot;</b>',
    );
    expect(text).toContain(
      '<a href="https://egoscope.example/alerts/14?from=a&amp;to=b">See sheet no. 14</a>',
    );
  });
});
