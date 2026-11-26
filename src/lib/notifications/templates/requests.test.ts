import { describe, expect, it } from 'vitest';

import { paths } from '@/lib/navigation';
import { toEpochMs, toIsoDate } from '@/lib/time';

import { backtestRequest, deadlineChanged, deadlineReminder } from './requests';

import type {
  BacktestRequestToDoData,
  DeadlineChangedData,
  DeadlineReminderData,
  EventDesignation,
  MessageGame,
} from './data';
import type { EpochMs } from '@/lib/time';

const PARIS = 'Europe/Paris';
const HOUR_MS = 3_600_000;
const REQUEST_URL = `https://egoscope.example${paths.request(12)}`;
const REQUEST_LINK = '<a href="https://egoscope.example/backtests/12">Open the request</a>';
const URGENT_REASON = 'The game starts before your quiet hours end.';
const utc = (day: number, hour: number, minute = 0): EpochMs =>
  toEpochMs(Date.UTC(2026, 10, day, hour, minute));
const linesOf = (text: string): readonly string[] => text.split('\n');

const game = (scheduledStartAt: EpochMs, usDate: string): MessageGame => ({
  gameId: 7,
  scheduledStartAt,
  usDate: toIsoDate(usDate),
  opponentName: 'Team X',
  isHome: null,
});
// Thursday 19 November 2026, 02:00 in Paris: Wednesday evening in the US.
const THURSDAY_GAME = game(utc(19, 1), '2026-11-18');
const THURSDAY_TEXT =
  'Thursday 19 November 2026, 02:00 Paris time — Wednesday evening in the US, against Team X';
// Wednesday 18 November 2026, 01:30 in Paris: Tuesday evening in the US.
const WEDNESDAY_GAME = game(utc(18, 0, 30), '2026-11-17');
const WEDNESDAY_TEXT =
  'Wednesday 18 November 2026, 01:30 Paris time — Tuesday evening in the US, against Team X';
const detected = (typeName: string): EventDesignation => ({
  origin: 'detected',
  typeName,
  // Monday 16 November 2026, 23:40 in Paris.
  source: { outletName: 'A national outlet', publishedAt: utc(16, 22, 40), precision: 'exact' },
});
const SOURCE_TEXT = 'reported by A national outlet on Monday 16 November 2026, 23:40 Paris time';

const REQUEST: BacktestRequestToDoData = {
  kind: 'backtest_request_to_do',
  playerName: 'Player B',
  teamName: 'Team Z',
  event: detected('Player conflict'),
  deadline: THURSDAY_GAME,
  timeRemainingMs: 42 * HOUR_MS,
  tipOffPassed: false,
  isUrgent: false,
  requestUrl: REQUEST_URL,
};
const DEADLINE_CHANGED: DeadlineChangedData = {
  kind: 'deadline_changed',
  playerName: 'Player B',
  event: detected('Public humiliation'),
  deadline: WEDNESDAY_GAME,
  timeRemainingMs: 20 * HOUR_MS,
  previousDeadlineStartAt: utc(21, 19),
  typeNotInRequest: true,
  tipOffPassed: false,
  isUrgent: false,
  requestUrl: REQUEST_URL,
};
const REMINDER: DeadlineReminderData = {
  kind: 'deadline_reminder',
  playerName: 'Player B',
  deadline: THURSDAY_GAME,
  leadHours: 6,
  isUrgent: false,
  requestUrl: REQUEST_URL,
};

describe('the messages of a backtest request', () => {
  it('[TEL-09] [TEL-07] [TEL-08] writes a request to do: player and team, event, deadline with the time left, prompt, then its link', () => {
    expect(linesOf(backtestRequest(REQUEST, PARIS))).toStrictEqual([
      '<b>Egoscope · Backtest to do — Player B</b>',
      'Player B (Team Z) has no backtest yet.',
      `Event: Player conflict, ${SOURCE_TEXT}`,
      `Deadline: expected game ${THURSDAY_TEXT}, in 42 h.`,
      'The research prompt is ready.',
      REQUEST_LINK,
    ]);
  });

  it('[TEL-09] [TEL-21] marks an urgent request, a player without team and a game that has started', () => {
    const urgent: BacktestRequestToDoData = {
      ...REQUEST,
      teamName: null,
      timeRemainingMs: null,
      tipOffPassed: true,
      isUrgent: true,
    };

    expect(linesOf(backtestRequest(urgent, PARIS))).toStrictEqual([
      '<b>Egoscope · Urgent backtest to do — Player B</b>',
      URGENT_REASON,
      'Player B (without team) has no backtest yet.',
      `Event: Player conflict, ${SOURCE_TEXT}`,
      `Deadline: expected game ${THURSDAY_TEXT}.`,
      'The research prompt is ready.',
      'the game has started; the request is still useful for the profile',
      REQUEST_LINK,
    ]);
  });

  it('[TEL-09] says that the deadline is unknown when no game is expected', () => {
    expect(linesOf(backtestRequest({ ...REQUEST, deadline: null }, PARIS))[3]).toBe(
      'Deadline: expected game unknown.',
    );
  });

  it('[TEL-09] [CL-TEL-18] writes the deadline changed: new event and deadline, the previous one, the type to add', () => {
    expect(linesOf(deadlineChanged(DEADLINE_CHANGED, PARIS))).toStrictEqual([
      '<b>Egoscope · Backtest to do — Player B, deadline changed</b>',
      'Player B has no backtest yet.',
      `Event: Public humiliation, ${SOURCE_TEXT}`,
      `Deadline: expected game ${WEDNESDAY_TEXT}, in 20 h.`,
      'Previous deadline: Saturday 21 November 2026, 20:00 Paris time.',
      'Updating the request would include this type.',
      'The research prompt is ready.',
      REQUEST_LINK,
    ]);
  });

  it('[TEL-09] [TEL-21] [CL-TEL-18] writes an urgent deadline changed without a previous deadline, after tip-off', () => {
    const urgent: DeadlineChangedData = {
      ...DEADLINE_CHANGED,
      previousDeadlineStartAt: null,
      typeNotInRequest: false,
      timeRemainingMs: null,
      tipOffPassed: true,
      isUrgent: true,
    };

    expect(linesOf(deadlineChanged(urgent, PARIS))).toStrictEqual([
      '<b>Egoscope · Urgent backtest to do — Player B, deadline changed</b>',
      URGENT_REASON,
      'Player B has no backtest yet.',
      `Event: Public humiliation, ${SOURCE_TEXT}`,
      `Deadline: expected game ${WEDNESDAY_TEXT}.`,
      'Previous deadline: expected game unknown.',
      'The research prompt is ready.',
      'the game has started; the request is still useful for the profile',
      REQUEST_LINK,
    ]);
  });

  it('[TEL-21] writes the reminder before the deadline with its consequence, and its urgent first line', () => {
    expect(linesOf(deadlineReminder(REMINDER, PARIS))).toStrictEqual([
      "<b>Egoscope · Reminder — Player B's backtest still to do</b>",
      `Game in 6 h: ${THURSDAY_TEXT}.`,
      'Without an import before tip-off, this game gets no alert sheet; the event is still tracked.',
      REQUEST_LINK,
    ]);
    expect(
      linesOf(deadlineReminder({ ...REMINDER, isUrgent: true }, PARIS)).slice(0, 2),
    ).toStrictEqual([
      "<b>Egoscope · Urgent reminder — Player B's backtest still to do</b>",
      URGENT_REASON,
    ]);
  });
});
