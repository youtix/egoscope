// The messages of a backtest request (TEL-09, TEL-10, CL-TEL-18): to do, deadline changed and
// the reminder before the deadline.

import { formatDuration } from '@/lib/time';
import { sentence } from '@/lib/wording';

import { clock, eventLine, firstLine, gameText, link, message, plain, urgentLine } from './text';

import type {
  BacktestRequestToDoData,
  DeadlineChangedData,
  DeadlineReminderData,
  MessageGame,
} from './data';

const HOUR_MS = 3_600_000;

const requestLink = (url: string): string => link(url, sentence('notifications.openRequest'));

/** The deadline: the expected game and the time left, or that it is unknown (BKT-18). */
function deadlineLine(
  deadline: MessageGame | null,
  remainingMs: number | null,
  zone: string,
): string {
  if (deadline === null) {
    return plain(sentence('notifications.deadlineUnknown'));
  }
  const game = gameText(deadline, zone);
  if (remainingMs === null) {
    return plain(sentence('notifications.deadlineGame', { game }));
  }
  const remaining = formatDuration(remainingMs);
  return plain(sentence('notifications.deadline', { game, remaining }));
}

/** The end of a request message: the prompt, tip-off if passed, the link (TEL-09). */
function requestEnd(isAfterTipOff: boolean, requestUrl: string): readonly (string | null)[] {
  return [
    plain(sentence('notifications.promptReady')),
    isAfterTipOff ? plain(sentence('notifications.gameStarted')) : null,
    requestLink(requestUrl),
  ];
}

/**
 * A request to do: the player without a backtest, the event, the deadline and the time left,
 * the prompt ready and the link to the request (TEL-09, TEL-21).
 */
export function backtestRequest(data: BacktestRequestToDoData, zone: string): string {
  const player = data.playerName;
  const team = data.teamName ?? sentence('notifications.withoutTeam');
  const title = data.isUrgent
    ? sentence('notifications.urgentRequestTitle', { player })
    : sentence('notifications.requestTitle', { player });
  return message([
    firstLine(title),
    urgentLine(data.isUrgent),
    plain(sentence('notifications.playerWithoutBacktest', { player, team })),
    eventLine(data.event, zone),
    deadlineLine(data.deadline, data.timeRemainingMs, zone),
    ...requestEnd(data.tipOffPassed, data.requestUrl),
  ]);
}

/**
 * A new event that moves a request's deadline: the event, the new and the previous deadline,
 * and whether the request would take in its type (TEL-09, CL-TEL-18).
 */
export function deadlineChanged(data: DeadlineChangedData, zone: string): string {
  const player = data.playerName;
  const previous = data.previousDeadlineStartAt;
  const title = data.isUrgent
    ? sentence('notifications.urgentDeadlineChangedTitle', { player })
    : sentence('notifications.deadlineChangedTitle', { player });
  const previousLine =
    previous === null
      ? sentence('notifications.previousDeadlineUnknown')
      : sentence('notifications.previousDeadline', { at: clock(previous, zone) });
  return message([
    firstLine(title),
    urgentLine(data.isUrgent),
    plain(sentence('notifications.noBacktestYetFor', { player })),
    eventLine(data.event, zone),
    deadlineLine(data.deadline, data.timeRemainingMs, zone),
    plain(previousLine),
    data.typeNotInRequest ? plain(sentence('notifications.typeNotInRequest')) : null,
    ...requestEnd(data.tipOffPassed, data.requestUrl),
  ]);
}

/**
 * The reminder of a request still to do before its game, and what is lost without an import
 * before tip-off (TEL-10, TEL-21).
 */
export function deadlineReminder(data: DeadlineReminderData, zone: string): string {
  const player = data.playerName;
  const title = data.isUrgent
    ? sentence('notifications.urgentReminderTitle', { player })
    : sentence('notifications.reminderTitle', { player });
  const lead = formatDuration(data.leadHours * HOUR_MS);
  const game = gameText(data.deadline, zone);
  return message([
    firstLine(title),
    urgentLine(data.isUrgent),
    plain(sentence('notifications.reminderGame', { lead, game })),
    plain(sentence('notifications.reminderConsequence')),
    requestLink(data.requestUrl),
  ]);
}
