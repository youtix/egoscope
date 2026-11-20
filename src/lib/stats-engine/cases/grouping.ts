// The cases of the events (SEN-05, SEN-06, CL-SEN-06). Each event is first attached on
// its own, its own window, precedence and shift included (measured-game part); then the
// events of one player and type whose own attachment ends on the same game form one
// case, counted once, whose reference instant is the earliest of theirs, and an event
// that reaches no game is a case of its own. Grouping never checks a window again from
// that earliest instant. The cases of different types on one game are each co-occurring,
// calendar-derived ones included, and two followed players never share a case. Which
// stored case a group keeps is the sensitivity module's (events-and-cases.md, 2.5).

import type { ReferenceInstantOrigin } from '../measured-game/attachment';
import type { EpochMs, EventTypeId, GameId, PlayerEventId, PlayerId } from '../types';

/**
 * An event as the grouping reads it (CL-SEN-06): its player, type and id; the game its
 * own attachment stopped at, as the attachment gives it, null when it reached none, for
 * an event that ends pending or not measurable without a game; and the reference instant
 * its measured game was searched from, with where that instant comes from, null for a
 * date known in advance.
 */
export type CaseEvent = Readonly<{
  playerId: PlayerId;
  eventTypeId: EventTypeId;
  eventId: PlayerEventId;
  measuredGameId: GameId | null;
  referenceInstantAt: EpochMs | null;
  referenceInstantOrigin: ReferenceInstantOrigin;
}>;

/**
 * A case and its events (SEN-05, SEN-06): its player, type and game; its events, at least
 * one, the earliest first; the reference instant of the earliest, with where it comes
 * from; and whether it is co-occurring, with the other types of his cases on the same
 * game, in the order of the cases.
 */
export type CaseGroup<E extends CaseEvent> = Readonly<{
  playerId: PlayerId;
  eventTypeId: EventTypeId;
  measuredGameId: GameId | null;
  events: readonly [E, ...E[]];
  referenceInstantAt: EpochMs | null;
  referenceInstantOrigin: ReferenceInstantOrigin;
  isCoOccurring: boolean;
  coOccurringTypeIds: readonly EventTypeId[];
}>;

// An event known in advance has no reference instant: it comes after those that have one.
const NO_INSTANT = Infinity;

/** The earliest first (SEN-05): by reference instant, the events without one last, then by id. */
function inEventOrder(left: CaseEvent, right: CaseEvent): number {
  const leftAt = left.referenceInstantAt ?? NO_INSTANT;
  const rightAt = right.referenceInstantAt ?? NO_INSTANT;
  return leftAt === rightAt ? left.eventId - right.eventId : leftAt - rightAt;
}

/**
 * The case of an event (SEN-05, CL-SEN-06): that of his events of its type on its game,
 * or its own when it reached no game.
 */
function caseKeyOf({ playerId, eventTypeId, eventId, measuredGameId }: CaseEvent): string {
  return JSON.stringify(
    measuredGameId === null ? [eventId] : [playerId, eventTypeId, measuredGameId],
  );
}

/** The game of a case, which his cases of other types on it share (SEN-06). */
function gameKeyOf({ playerId, measuredGameId }: CaseEvent): string {
  return JSON.stringify([playerId, measuredGameId]);
}

/** The events of each case, the cases in the order of their earliest events. */
function eventsByCase<E extends CaseEvent>(
  events: readonly E[],
): readonly (readonly [E, ...E[]])[] {
  const cases: [E, ...E[]][] = [];
  const byCase = new Map<string, [E, ...E[]]>();
  for (const event of events.toSorted(inEventOrder)) {
    const key = caseKeyOf(event);
    const caseEvents = byCase.get(key);
    if (caseEvents === undefined) {
      const opened: [E, ...E[]] = [event];
      byCase.set(key, opened);
      cases.push(opened);
    } else {
      caseEvents.push(event);
    }
  }
  return cases;
}

/**
 * Groups the events of followed players into cases, whatever their order (SEN-05,
 * SEN-06, CL-SEN-06). The events of one player and type whose own attachment stopped at
 * the same game, played or blocking the walk, form one case, counted once, whose
 * reference instant is the earliest of theirs; an event whose attachment reached no
 * game, as when its own window expires or its precedence is not established, is a case
 * of its own, never joined to a game by an earlier instant, so no window is checked
 * again. A case on a game that his cases of other types share is co-occurring, with the
 * list of those types, calendar-derived ones included; the cases of another player are
 * never his. The cases come in the order of their earliest events.
 */
export function groupCases<E extends CaseEvent>(events: readonly E[]): readonly CaseGroup<E>[] {
  const cases = eventsByCase(events);
  const casesOnGame = Map.groupBy(
    cases.filter(([first]) => first.measuredGameId !== null),
    ([first]) => gameKeyOf(first),
  );
  return cases.map((caseEvents) => {
    const [first] = caseEvents;
    const coOccurringTypeIds = (casesOnGame.get(gameKeyOf(first)) ?? [])
      .filter((other) => other !== caseEvents)
      .map(([other]) => other.eventTypeId);
    return {
      playerId: first.playerId,
      eventTypeId: first.eventTypeId,
      measuredGameId: first.measuredGameId,
      events: caseEvents,
      referenceInstantAt: first.referenceInstantAt,
      referenceInstantOrigin: first.referenceInstantOrigin,
      isCoOccurring: coOccurringTypeIds.length > 0,
      coOccurringTypeIds,
    };
  });
}
