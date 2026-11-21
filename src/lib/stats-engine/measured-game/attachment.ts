// The attachment of an event to its measured game (SEN-02 to SEN-04, CL-SEN-05 steps 1, 6
// and 7): the walk over the player's team games from the instant the event became
// public, the walk of an event known in advance from its date, the derived game of a
// calendar-derived event, and the precedence of a historical event's sources over the
// game its walk reaches, which an uncertain precedence moves once to a later game. His
// team games come from teamGames (schedule part), each with the marks that the caller
// adds, since this part reads no clock and converts no time zone.

import { byScheduledStart } from '../schedule/series';
import { classifyPrecedence, precedenceOver } from './precedence';

import type { TeamGame } from '../schedule/team-membership';
import type { EngineParams, EpochMs, GameId, IsoDate } from '../types';
import type { Precedence, PrecedenceGame, PrecedenceSource } from './precedence';

/**
 * One of his team games as the attachment reads it: the team game that teamGames gives,
 * with three marks that the caller adds. Its US date (CL-TRV-03). The end of that date in
 * Pacific time, 00:00 Los Angeles time the next day, as time.endOfDayPacific gives it,
 * where an uncertain precedence shifts the event to (CL-SEN-07). And whether his team's
 * box score of the game is unavailable (STA-35, CL-STA-11): a team game of unknown
 * participation does not tell a box score still awaited from an unavailable one, which
 * the walk treats differently (CL-STA-04), so the walk reads this mark for such a game.
 */
export type AttachmentGame = TeamGame &
  Readonly<{ gameDayOn: IsoDate; endOfDayPacificAt: EpochMs; isBoxScoreUnavailable: boolean }>;

/**
 * Where the instant that a measured game is searched from comes from (SEN-01, SEN-02,
 * SEN-44, CL-SEN-02, CL-SEN-07): a timed public date or a detected event's reference
 * date, the end of a date-only public date in Pacific time, a date known in advance,
 * which gives no instant, or the shift for an uncertain precedence.
 */
export type ReferenceInstantOrigin =
  'known_instant' | 'date_only' | 'known_in_advance' | 'uncertain_precedence_shift';

/**
 * An event to attach (CL-SEN-02): a calendar-derived event with its derived game, one of
 * his team games (CL-SEN-03); an event searched from its reference instant, which the
 * caller sets (SEN-01, CL-SEN-02); or an event of another type known in advance, searched
 * from its date E (CL-SEN-04). The last two carry a historical event's sources, whose
 * precedence over the game decides (IMP-18), and null for a detected event.
 */
export type AttachmentEvent =
  | Readonly<{ kind: 'calendar_derived'; derivedGame: AttachmentGame }>
  | (Readonly<{ sources: readonly PrecedenceSource[] | null }> &
      (
        | Readonly<{
            kind: 'reference_instant';
            referenceInstantAt: EpochMs;
            referenceInstantOrigin: 'known_instant' | 'date_only';
          }>
        | Readonly<{ kind: 'known_in_advance'; eventOn: IsoDate }>
      ));

/**
 * What an attachment reads besides the event: his team games, in any order; the instant
 * of the evaluation; and its US date, the date of that instant in US Eastern time
 * (CL-TRV-03), as time.gameDay gives it.
 */
export type AttachmentContext = Readonly<{
  games: readonly AttachmentGame[];
  now: EpochMs;
  nowGameDayOn: IsoDate;
}>;

/**
 * Where an attachment ends (SEN-07, CL-SEN-05), with the game it stopped at, as a case
 * stores it in `measured_game_id`: attached to the measured game; awaiting a game that is
 * not final or of unknown participation, or, with no game, one that the window can still
 * hold; not measurable at a game whose box score is unavailable or a derived game he did
 * not play, and with no game when the window holds no game he played or when the
 * precedence is not established.
 */
type AttachmentEnd =
  | Readonly<{ status: 'attached'; measuredGameId: GameId }>
  | Readonly<{
      status: 'awaiting_game';
      reason: 'game_not_played_yet' | 'statistics_pending';
      measuredGameId: GameId | null;
    }>
  | Readonly<{
      status: 'not_measurable';
      reason: 'no_game_within_window' | 'precedence_not_established';
      measuredGameId: null;
    }>
  | Readonly<{
      status: 'not_measurable';
      reason: 'box_score_unavailable' | 'derived_game_missed';
      measuredGameId: GameId;
    }>;

/**
 * The attachment of an event (CL-SEN-05 steps 1, 6 and 7): where it ends; the reference
 * instant of its last walk and where that instant comes from, none for a date known in
 * advance or a derived game; the games that walk skipped because he did not play them,
 * his absences (SEN-03); and a historical event's precedence, null for any other event.
 */
export type Attachment = AttachmentEnd &
  Readonly<{
    referenceInstantAt: EpochMs | null;
    referenceInstantOrigin: ReferenceInstantOrigin;
    absences: readonly GameId[];
    precedence: Precedence | null;
  }>;

/**
 * Where a walk starts and how far its window reaches (SEN-03, SEN-04, CL-SEN-04): its
 * reference instant and origin; whether a game comes after the start; whether a game
 * lies past the window; and whether the window has passed, so that no game stored later
 * can fall in it.
 */
type WalkStart = Readonly<{
  referenceInstantAt: EpochMs | null;
  referenceInstantOrigin: ReferenceInstantOrigin;
  isCandidate: (game: AttachmentGame) => boolean;
  isPastWindow: (game: AttachmentGame) => boolean;
  hasWindowPassed: boolean;
}>;

/**
 * A walk: where it ends, the games it skipped, the first game it looked at, which a
 * precedence reads until the measured game is known (CL-IMP-17), and that measured game
 * when the walk found it.
 */
type Walk = Readonly<{
  end: AttachmentEnd;
  absences: readonly GameId[];
  firstCandidate: AttachmentGame | undefined;
  measuredGame: AttachmentGame | undefined;
}>;

const MS_PER_HOUR = 3_600_000;
const HOURS_PER_DAY = 24;
const MS_PER_DAY = HOURS_PER_DAY * MS_PER_HOUR;

const NO_GAME_WITHIN_WINDOW: AttachmentEnd = {
  status: 'not_measurable',
  reason: 'no_game_within_window',
  measuredGameId: null,
};
const NO_GAME_YET: AttachmentEnd = {
  status: 'awaiting_game',
  reason: 'game_not_played_yet',
  measuredGameId: null,
};
const PRECEDENCE_NOT_ESTABLISHED: AttachmentEnd = {
  status: 'not_measurable',
  reason: 'precedence_not_established',
  measuredGameId: null,
};

/** The day of a date written YYYY-MM-DD, counted from 1970-01-01 in the same calendar. */
function dayNumber(date: IsoDate): number {
  const [year = NaN, month = NaN, day = NaN] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

/**
 * A walk from `reference.referenceInstantAt` (SEN-03, SEN-04): over the games that start
 * strictly after it, within sensitivity.maxAttachmentDays counted in hours from it, 240
 * by default, a window that has passed once `now` is later than its end.
 */
function fromInstant(
  reference: Readonly<{
    referenceInstantAt: EpochMs;
    referenceInstantOrigin: ReferenceInstantOrigin;
  }>,
  now: EpochMs,
  params: EngineParams,
): WalkStart {
  const { referenceInstantAt, referenceInstantOrigin } = reference;
  const windowEndAt = referenceInstantAt + params.sensitivity.maxAttachmentDays * MS_PER_DAY;
  return {
    referenceInstantAt,
    referenceInstantOrigin,
    isCandidate: ({ game }) => game.scheduledStartAt > referenceInstantAt,
    isPastWindow: ({ game }) => game.scheduledStartAt > windowEndAt,
    hasWindowPassed: now > windowEndAt,
  };
}

/**
 * A walk from the date `eventOn` of an event known in advance (SEN-02, CL-SEN-04): over
 * the games whose US date is that date or later, within sensitivity.maxAttachmentDays
 * calendar days after it, a window that has passed once the US date of now is later.
 */
function fromDate(eventOn: IsoDate, nowGameDayOn: IsoDate, params: EngineParams): WalkStart {
  const lastDay = dayNumber(eventOn) + params.sensitivity.maxAttachmentDays;
  return {
    referenceInstantAt: null,
    referenceInstantOrigin: 'known_in_advance',
    isCandidate: ({ gameDayOn }) => gameDayOn >= eventOn,
    isPastWindow: ({ gameDayOn }) => dayNumber(gameDayOn) > lastDay,
    hasWindowPassed: dayNumber(nowGameDayOn) > lastDay,
  };
}

/** The end at a game he played, the measured game (SEN-03). */
function attachedTo(game: AttachmentGame): AttachmentEnd {
  return { status: 'attached', measuredGameId: game.game.id };
}

/**
 * The end at a game whose participation is not known (CL-SEN-05 step 6, CL-STA-04):
 * awaiting it, "game not yet played" while it is not final and its start is to come,
 * "statistics pending" once its start has passed or while his team's box score is
 * missing; not measurable, "box score unavailable", once that box score is unavailable.
 */
function unknownEnd(game: AttachmentGame, now: EpochMs): AttachmentEnd {
  const measuredGameId = game.game.id;
  if (game.participation === null) {
    const reason = game.game.scheduledStartAt > now ? 'game_not_played_yet' : 'statistics_pending';
    return { status: 'awaiting_game', reason, measuredGameId };
  }
  return game.isBoxScoreUnavailable
    ? { status: 'not_measurable', reason: 'box_score_unavailable', measuredGameId }
    : { status: 'awaiting_game', reason: 'statistics_pending', measuredGameId };
}

/**
 * The walk (SEN-03, SEN-04, CL-SEN-05 step 6): his team games after `start`, in the fixed
 * order of scheduled start, then id (CL-STA-09). A game past the window ends it, not
 * measurable; the first game he played is the measured game, whatever his minutes; a game
 * not final or of unknown participation ends it, never slid past; a game he did not play
 * is skipped and counted as an absence. Past the last stored game, the event is not
 * measurable once the window has passed, and awaits a game before.
 */
function walk(start: WalkStart, { games, now }: AttachmentContext): Walk {
  const candidates = games
    .filter((game) => start.isCandidate(game))
    .toSorted((left, right) => byScheduledStart(left.game, right.game));
  const absences: GameId[] = [];
  const ended = (end: AttachmentEnd, measuredGame?: AttachmentGame): Walk => ({
    end,
    absences,
    firstCandidate: candidates[0],
    measuredGame,
  });
  for (const game of candidates) {
    if (start.isPastWindow(game)) {
      return ended(NO_GAME_WITHIN_WINDOW);
    }
    if (game.participation === 'played') {
      return ended(attachedTo(game), game);
    }
    if (game.participation !== 'not_played') {
      return ended(unknownEnd(game, now));
    }
    absences.push(game.game.id);
  }
  return ended(start.hasWindowPassed ? NO_GAME_WITHIN_WINDOW : NO_GAME_YET);
}

/**
 * The end at the derived game of a calendar-derived event (CL-SEN-03): attached when he
 * played it; not measurable, "did not play the derived game", when he did not, never
 * slid to a later game; otherwise as at any game whose participation is not known.
 */
function derivedEnd(game: AttachmentGame, now: EpochMs): AttachmentEnd {
  if (game.participation === 'played') {
    return attachedTo(game);
  }
  return game.participation === 'not_played'
    ? { status: 'not_measurable', reason: 'derived_game_missed', measuredGameId: game.game.id }
    : unknownEnd(game, now);
}

/** The attachment that `walked` gives from `start`, with `precedence`. */
function attachmentOf(start: WalkStart, walked: Walk, precedence: Precedence | null): Attachment {
  return {
    ...walked.end,
    referenceInstantAt: start.referenceInstantAt,
    referenceInstantOrigin: start.referenceInstantOrigin,
    absences: walked.absences,
    precedence,
  };
}

function precedenceGameOf(teamGame: AttachmentGame): PrecedenceGame {
  return { scheduledStartAt: teamGame.game.scheduledStartAt, gameDayOn: teamGame.gameDayOn };
}

/**
 * The attachment of a historical event from `start` (CL-SEN-05 steps 6 and 7, SEN-44,
 * CL-SEN-07): the precedence of its `sources` over the game the walk reaches. Not
 * established makes the event not measurable. Uncertain shifts its reference instant to
 * the end of that game's US date in Pacific time and walks again from there, the window
 * counted from it, never classifying again. Established keeps the game. A walk that
 * reaches no game he played gives the precedence that the first game after the start
 * decides (CL-IMP-17).
 */
function withPrecedence(
  sources: readonly PrecedenceSource[],
  start: WalkStart,
  setting: Readonly<{ context: AttachmentContext; params: EngineParams }>,
): Attachment {
  const { context, params } = setting;
  const walked = walk(start, context);
  const { measuredGame, firstCandidate } = walked;
  if (measuredGame === undefined) {
    const firstTeamGame = firstCandidate === undefined ? null : precedenceGameOf(firstCandidate);
    const precedence = classifyPrecedence(sources, { measuredGame: null, firstTeamGame });
    return attachmentOf(start, walked, precedence);
  }
  const precedence = precedenceOver(sources, precedenceGameOf(measuredGame));
  if (precedence === 'uncertain') {
    const shifted = fromInstant(
      {
        referenceInstantAt: measuredGame.endOfDayPacificAt,
        referenceInstantOrigin: 'uncertain_precedence_shift',
      },
      context.now,
      params,
    );
    return attachmentOf(shifted, walk(shifted, context), precedence);
  }
  const kept =
    precedence === 'established' ? walked : { ...walked, end: PRECEDENCE_NOT_ESTABLISHED };
  return attachmentOf(start, kept, precedence);
}

/**
 * The attachment of `event` to its measured game (SEN-02, SEN-03, SEN-04, IMP-18, SEN-44,
 * CL-SEN-02 to CL-SEN-05, CL-SEN-07), over the team games of `context` and under
 * sensitivity.maxAttachmentDays. From a reference instant, the walk takes his team games
 * from the first that starts strictly after it, a game whose time is to be determined
 * by its deemed start (CL-STA-14), and the window counts on instants. Known in advance,
 * it takes them from the first whose US date is the event's date or later, and the window
 * counts in calendar days. Calendar-derived, it reads the derived game alone, with no
 * skipping and no window (CL-SEN-03). A historical event then has its precedence
 * classified, and shifted once when uncertain.
 */
export function attachToMeasuredGame(
  event: AttachmentEvent,
  context: AttachmentContext,
  params: EngineParams,
): Attachment {
  if (event.kind === 'calendar_derived') {
    return {
      ...derivedEnd(event.derivedGame, context.now),
      referenceInstantAt: null,
      referenceInstantOrigin: 'known_in_advance',
      absences: [],
      precedence: null,
    };
  }
  const start =
    event.kind === 'known_in_advance'
      ? fromDate(event.eventOn, context.nowGameDayOn, params)
      : fromInstant(event, context.now, params);
  return event.sources === null
    ? attachmentOf(start, walk(start, context), null)
    : withPrecedence(event.sources, start, { context, params });
}
