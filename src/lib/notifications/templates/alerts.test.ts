import { describe, expect, it } from 'vitest';

import { paths } from '@/lib/navigation';
import { toEpochMs, toIsoDate } from '@/lib/time';
import { assertNoBettingWords } from '@/lib/wording';

import { alertMessage, alertUpdate } from './alerts';

import type {
  AlertData,
  AlertSection,
  AlertUpdateData,
  EventDesignation,
  MessageGame,
  MessageProfile,
} from './data';
import type { EpochMs } from '@/lib/time';

const PARIS = 'Europe/Paris';
const MINUS = '\u{2212}';
const BASE = 'https://egoscope.example';
const URGENT_REASON = 'The game starts before your quiet hours end.';
const CLOSING_LINE = 'A measure of the past, not a forecast.';
const SHEET_14_LINK = '<a href="https://egoscope.example/alerts/14">See sheet no. 14</a>';
const utc = (day: number, hour: number, minute = 0): EpochMs =>
  toEpochMs(Date.UTC(2026, 10, day, hour, minute));
const linesOf = (text: string): readonly string[] => text.split('\n');

const game = (scheduledStartAt: EpochMs, opponentName: string, usDate: string): MessageGame => ({
  gameId: 7,
  scheduledStartAt,
  usDate: toIsoDate(usDate),
  opponentName,
  isHome: null,
});
// Wednesday 18 November 2026, 01:30 in Paris: Tuesday evening in the US.
const WEDNESDAY_GAME = game(utc(18, 0, 30), 'Team X', '2026-11-17');
const WEDNESDAY_TEXT =
  'Wednesday 18 November 2026, 01:30 Paris time — Tuesday evening in the US, against Team X';
// Saturday 21 November 2026, 20:00 in Paris, the same date in the US.
const SATURDAY_GAME = game(utc(21, 19), 'Team X', '2026-11-21');
const SATURDAY_TEXT = 'Saturday 21 November 2026, 20:00 Paris time, against Team X';
const detected = (typeName: string | null): EventDesignation => ({
  origin: 'detected',
  typeName,
  // Monday 16 November 2026, 23:40 in Paris.
  source: { outletName: 'A national outlet', publishedAt: utc(16, 22, 40), precision: 'exact' },
});
const SOURCE_TEXT = 'reported by A national outlet on Monday 16 November 2026, 23:40 Paris time';

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
const SECTION: AlertSection = {
  typeName: 'Public humiliation',
  values: { kind: 'profile', profile: PROFILE },
};
const ALERT: AlertData = {
  kind: 'alert',
  sheetNumber: 14,
  playerName: 'Player A',
  events: [detected('Public humiliation')],
  sections: [SECTION],
  expectedGame: WEDNESDAY_GAME,
  caveatKinds: ['small_sample', 'effect_direction'],
  isLate: false,
  isUrgent: false,
  typeNotCovered: false,
  complementaryRequest: false,
  sheetUrl: `${BASE}${paths.alertSheet(14)}`,
};
const UPDATE: AlertUpdateData = {
  kind: 'alert_update',
  sheetNumber: 15,
  playerName: 'Player E',
  change: {
    kind: 'expected_game_changed',
    previousGame: SATURDAY_GAME,
    reason: 'postponed',
    expectedGame: game(utc(23, 0), 'Team W', '2026-11-22'),
  },
  sheetStatus: 'open',
  isUrgent: false,
  sheetUrl: `${BASE}${paths.alertSheet(15)}`,
};
const GAME_LEFT: Omit<
  Extract<AlertUpdateData['change'], { kind: 'expected_game_changed' }>,
  'reason'
> = { kind: 'expected_game_changed', previousGame: SATURDAY_GAME, expectedGame: null };

/** The lines of the profile of a one-section alert, after its title and event. */
const profileLines = (profile: MessageProfile): readonly string[] =>
  linesOf(
    alertMessage(
      { ...ALERT, sections: [{ typeName: null, values: { kind: 'profile', profile } }] },
      PARIS,
    ),
  ).slice(2, 6);
/** The lines of an alert whose one section is under the case threshold. */
const belowThreshold = (values: AlertSection['values']): readonly string[] =>
  linesOf(alertMessage({ ...ALERT, sections: [{ ...SECTION, values }] }, PARIS));
/** What an update says changed, between its title and its status. */
const changed = (change: AlertUpdateData['change']): readonly string[] =>
  linesOf(alertUpdate({ ...UPDATE, change }, PARIS)).slice(1, -2);

describe('the alert messages', () => {
  it('[TEL-11] [CA-TEL-04] [TEL-05] writes the alert: event, frozen profile, expected game, caveats, link and closing line', () => {
    const text = alertMessage(ALERT, PARIS);

    expect(linesOf(text)).toStrictEqual([
      '<b>Egoscope · Alert — Player A</b>',
      `Event: Public humiliation, ${SOURCE_TEXT}`,
      'Profile for Public humiliation: mean gap +0.83, range from +0.07 to +1.59.',
      '7 valid cases: 5 historical, 2 tracked',
      'Verdict: possible, increase.',
      'Profile confidence: Low.',
      `Expected game: ${WEDNESDAY_TEXT}.`,
      'Caveats: Small sample; Direction of the effect.',
      SHEET_14_LINK,
      CLOSING_LINE,
    ]);
    expect(() => {
      assertNoBettingWords(text);
    }).not.toThrow();
  });

  it('[TEL-11] [TEL-21] starts an urgent alert with its first line and the sentence that follows it', () => {
    expect(linesOf(alertMessage({ ...ALERT, isUrgent: true }, PARIS)).slice(0, 3)).toStrictEqual([
      '<b>Egoscope · Urgent alert — Player A</b>',
      URGENT_REASON,
      `Event: Public humiliation, ${SOURCE_TEXT}`,
    ]);
  });

  it('[TEL-11] [CA-TEL-05] writes every event and every section, a sensitive one without its type', () => {
    const text = alertMessage(
      {
        ...ALERT,
        events: [detected(null), detected('Player conflict')],
        sections: [
          { ...SECTION, typeName: null },
          { ...SECTION, typeName: 'Player conflict' },
        ],
      },
      PARIS,
    );

    expect(linesOf(text).filter((line) => /^(?:Event|Profile for)/u.test(line))).toStrictEqual([
      `Event: sensitive event, ${SOURCE_TEXT}`,
      `Event: Player conflict, ${SOURCE_TEXT}`,
      'Profile for sensitive event: mean gap +0.83, range from +0.07 to +1.59.',
      'Profile for Player conflict: mean gap +0.83, range from +0.07 to +1.59.',
    ]);
    expect(text).not.toContain('Public humiliation');
  });

  it('[TEL-11] writes a section under the threshold with its label, then the general trend presented as such', () => {
    const trend = {
      ...PROFILE,
      meanGap: 0.21,
      rangeLow: -0.05,
      rangeHigh: 0.47,
      validCount: 38,
      playerCount: 12,
    };

    expect(
      belowThreshold({ kind: 'below_threshold', validCount: 4, threshold: 5, trend }).slice(2, 5),
    ).toStrictEqual([
      'Profile for Public humiliation: inconclusive for this player (4 valid cases of the 5 needed)',
      `General trend of the type, does not describe this player: mean gap +0.21 over 38 valid cases of 12 players, range from ${MINUS}0.05 to +0.47.`,
      'The general trend describes all observed players, not any one of them.',
    ]);
    expect(
      belowThreshold({
        kind: 'below_threshold',
        validCount: 1,
        threshold: 5,
        trend: { ...trend, validCount: 1, playerCount: 1 },
      })[3],
    ).toBe(
      `General trend of the type, does not describe this player: mean gap +0.21 over 1 valid case of 1 player, range from ${MINUS}0.05 to +0.47.`,
    );
    expect(
      belowThreshold({ kind: 'below_threshold', validCount: 1, threshold: 5, trend: null }).slice(
        2,
        4,
      ),
    ).toStrictEqual([
      'Profile for Public humiliation: inconclusive for this player (1 valid case of the 5 needed)',
      `Expected game: ${WEDNESDAY_TEXT}.`,
    ]);
  });

  it('[TEL-11] writes the late mark, the type not covered with its supplementary request, an unknown game, and no caveat line without caveats', () => {
    const text = alertMessage(
      {
        ...ALERT,
        expectedGame: null,
        caveatKinds: [],
        isLate: true,
        typeNotCovered: true,
        complementaryRequest: true,
      },
      PARIS,
    );

    expect(linesOf(text).slice(6)).toStrictEqual([
      'Expected game unknown',
      'Late sheet',
      'type not covered by the backtest',
      'Supplementary request to do',
      SHEET_14_LINK,
      CLOSING_LINE,
    ]);
  });

  it('[TEL-11] writes the title of every caveat', () => {
    const caveats = alertMessage(
      {
        ...ALERT,
        caveatKinds: [
          'small_sample',
          'effect_direction',
          'known_context',
          'several_events',
          'confidence_near_threshold',
          'dating_to_verify',
          'incomplete_or_earlier_version',
          'late_sheet',
          'type_not_covered',
          'confounder_not_separable',
        ],
      },
      PARIS,
    );

    expect(linesOf(caveats)[7]).toBe(
      'Caveats: Small sample; Direction of the effect; Known context; Several events; Detection confidence near the threshold; Dating to verify; Incomplete profile or earlier sheet version; Late sheet; Type not covered; Criterion switched off for this type.',
    );
  });

  it('[TEL-11] writes the level alone when inconclusive, the confidence, and one origin of cases as such', () => {
    expect(
      profileLines({
        ...PROFILE,
        trackedCount: 0,
        historicalCount: 7,
        profileConfidence: 'medium',
      }),
    ).toStrictEqual([
      'Profile for sensitive event: mean gap +0.83, range from +0.07 to +1.59.',
      '7 valid cases: 7 historical',
      'Verdict: possible, increase.',
      'Profile confidence: Medium.',
    ]);
    expect(
      profileLines({
        ...PROFILE,
        historicalCount: 0,
        trackedCount: 7,
        verdictLevel: 'inconclusive',
        profileConfidence: 'high',
      }).slice(1),
    ).toStrictEqual([
      '7 valid cases: 7 tracked',
      'Verdict: inconclusive.',
      'Profile confidence: High.',
    ]);
  });

  it('[TEL-12] [CL-TEL-21] writes an update: the game that moved, the new expected game, the status and the link', () => {
    expect(linesOf(alertUpdate(UPDATE, PARIS))).toStrictEqual([
      "<b>Egoscope · Update — Player E's alert</b>",
      `The game of ${SATURDAY_TEXT} is postponed.`,
      'Expected game: Monday 23 November 2026, 01:00 Paris time — Sunday evening in the US, against Team W.',
      'Sheet status: Open.',
      '<a href="https://egoscope.example/alerts/15">See sheet no. 15</a>',
    ]);
  });

  it('[TEL-12] [CL-TEL-21] says how the expected game changed, a new event, and a calendar event that no longer applies', () => {
    expect([
      changed({ ...GAME_LEFT, reason: 'brought_forward' }),
      changed({ ...GAME_LEFT, reason: 'canceled' }),
      changed({ ...GAME_LEFT, reason: 'player_did_not_play' }),
      changed({ ...GAME_LEFT, previousGame: null, reason: 'canceled' }),
    ]).toStrictEqual([
      [`The game of ${SATURDAY_TEXT} is brought forward.`, 'Expected game unknown'],
      [`The game of ${SATURDAY_TEXT} is canceled.`, 'Expected game unknown'],
      [`Player E did not play the game of ${SATURDAY_TEXT}.`, 'Expected game unknown'],
      ['Expected game unknown'],
    ]);
    expect([
      changed({ kind: 'new_event', event: detected('Player conflict') }),
      changed({
        kind: 'event_no_longer_applies',
        typeName: 'Birthday game',
        game: SATURDAY_GAME,
        reason: 'the birthday was corrected',
      }),
    ]).toStrictEqual([
      [`New event: Player conflict, ${SOURCE_TEXT}`],
      [
        `Event: Birthday game, from the calendar, for the game of ${SATURDAY_TEXT}`,
        'This event no longer applies: the birthday was corrected.',
      ],
    ]);
  });

  it('[TEL-12] [TEL-21] starts an urgent update with its first line and its reason, and writes the status', () => {
    const lines = linesOf(
      alertUpdate({ ...UPDATE, sheetStatus: 'canceled', isUrgent: true }, PARIS),
    );

    expect(lines.slice(0, 2)).toStrictEqual([
      "<b>Egoscope · Urgent update — Player E's alert</b>",
      URGENT_REASON,
    ]);
    expect(lines.slice(-2)).toStrictEqual([
      'Sheet status: Canceled.',
      '<a href="https://egoscope.example/alerts/15">See sheet no. 15</a>',
    ]);
  });
});
