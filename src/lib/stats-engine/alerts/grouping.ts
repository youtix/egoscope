// The sheet an event belongs to (ALE-03, H-ALE-02, CL-ALE-13, CL-ALE-14). A sheet
// gathers the events of one player whose expected game was the same at their detection,
// a calendar-derived event's being its derived game. That game, fixed at detection, is
// what groups them, never the sheet's current expected game, which a schedule change can
// move (ALE-23): two sheets of a player that end on the same game so stay distinct, and
// are related. An event with no known expected game shares no game with another, so it
// joins no sheet. The state of the sheet does not matter: a new event joins a canceled
// sheet of its game as any other (CL-ALE-14).

import type { GameId, PlayerEventId, PlayerId } from '../types';

/**
 * An event that a sheet may hold (ALE-03, CL-ALE-13): its id and player; for a detected
 * event, his expected game at its detection (SUI-03), null when none was known; for a
 * calendar-derived event, the game it is derived from, which is its expected game.
 */
export type SheetEvent =
  | Readonly<{
      origin: 'detected';
      eventId: PlayerEventId;
      playerId: PlayerId;
      expectedGameIdAtDetection: GameId | null;
    }>
  | Readonly<{
      origin: 'calendar';
      eventId: PlayerEventId;
      playerId: PlayerId;
      derivedGameId: GameId;
    }>;

/**
 * A sheet as the grouping reads it (ALE-03, H-ALE-02): its player; the expected game its
 * events had at their detection, null when none was known; its current expected game,
 * which a schedule change may have moved (ALE-23), null while none is known; and the
 * events placed on it.
 */
export type GroupingSheet = Readonly<{
  playerId: PlayerId;
  expectedGameIdAtDetection: GameId | null;
  currentExpectedGameId: GameId | null;
  eventIds: readonly PlayerEventId[];
}>;

/**
 * Where an event goes (ALE-03): it is already on a sheet, which it stays on; it joins the
 * sheet of his expected game; or it needs a new sheet, with the sheets of his that already
 * end on its game, which the new one will be related to (H-ALE-02).
 */
export type SheetPlacement<S extends GroupingSheet> =
  | Readonly<{ kind: 'already_placed'; sheet: S }>
  | Readonly<{ kind: 'joins'; sheet: S }>
  | Readonly<{ kind: 'new_sheet'; relatedSheets: readonly S[] }>;

/** The game an event is grouped by (ALE-03, CL-ALE-13). */
function groupingGameOf(event: SheetEvent): GameId | null {
  return event.origin === 'calendar' ? event.derivedGameId : event.expectedGameIdAtDetection;
}

/** The sheets of a player whose current expected game is the given game, when it is known. */
function sheetsEndingOn<S extends GroupingSheet>(
  sheets: readonly S[],
  playerId: PlayerId,
  gameId: GameId | null,
): readonly S[] {
  return gameId === null
    ? []
    : sheets.filter(
        (sheet) => sheet.playerId === playerId && sheet.currentExpectedGameId === gameId,
      );
}

/**
 * Places an event on a sheet of his (ALE-03, H-ALE-02, CL-ALE-13, CL-ALE-14). An event
 * already on one of `sheets` stays on it and is never placed again, so a new detection
 * pass makes no second sheet for it. Otherwise it joins the sheet of the same player
 * whose events had, at their detection, the expected game it has at its own, a
 * calendar-derived event's being its derived game, whatever that sheet's state; with none,
 * or with no known expected game, it needs a new sheet, which is related to the sheets of
 * his already ending on its game.
 */
export function placeEvent<S extends GroupingSheet>(
  event: SheetEvent,
  sheets: readonly S[],
): SheetPlacement<S> {
  const holding = sheets.find((sheet) => sheet.eventIds.includes(event.eventId));
  if (holding !== undefined) {
    return { kind: 'already_placed', sheet: holding };
  }
  const gameId = groupingGameOf(event);
  const joined = sheets.find(
    (sheet) =>
      gameId !== null &&
      sheet.playerId === event.playerId &&
      sheet.expectedGameIdAtDetection === gameId,
  );
  return joined === undefined
    ? { kind: 'new_sheet', relatedSheets: sheetsEndingOn(sheets, event.playerId, gameId) }
    : { kind: 'joins', sheet: joined };
}

/**
 * The sheets related to a sheet (H-ALE-02): the other sheets of its player, among
 * `sheets`, whose current expected game is its own, as when a schedule change moves one
 * onto the game of another; none while its expected game is unknown. `sheet` is one of
 * `sheets`, or a sheet about to join them.
 */
export function relatedSheets<S extends GroupingSheet>(
  sheet: S,
  sheets: readonly S[],
): readonly S[] {
  return sheetsEndingOn(sheets, sheet.playerId, sheet.currentExpectedGameId).filter(
    (other) => other !== sheet,
  );
}
