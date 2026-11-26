// The rows of the validation table, in their fixed order (SUI-23, SUI-28, CL-SUI-11): the
// overall row and its sub-rows; the rows of the validated types, of the followed players and
// of the player-type pairs that have a member; then the archived part, the rows of the
// withdrawn types and players and of their pairs. A row's members are the tracked cases, the
// regrouping exits and the valid historical cases of its type, its player or its sub-row
// (CL-SUI-06).

import { OVERALL_SUBROW_KINDS } from './case-place';

import type { TypeStatus } from '../profiles/evaluate-trend';
import type { EventTypeId, PlayerId } from '../types';
import type { OverallSubrowKind } from './case-place';

/** The status of a followed player (JOU-15), as it is stored. */
export type PlayerStatus = 'active' | 'paused' | 'withdrawn';

/** An event type as the table reads it (SUI-23, CL-SUI-11). */
export type TableEventType = Readonly<{ eventTypeId: EventTypeId; status: TypeStatus }>;

/** A followed player as the table reads it (SUI-23, CL-SUI-11). */
export type TablePlayer = Readonly<{ playerId: PlayerId; status: PlayerStatus }>;

/** The event types and the followed players, in the order their rows take (SUI-23). */
export type TableRoster = Readonly<{
  eventTypes: readonly TableEventType[];
  players: readonly TablePlayer[];
}>;

/** The place of a row (SUI-23, SUI-28): its scope, with what it is the row of. */
export type ValidationRowPlace =
  | Readonly<{ scope: 'overall' }>
  | Readonly<{ scope: 'overall_subrow'; subrowKind: OverallSubrowKind }>
  | Readonly<{ scope: 'type'; eventTypeId: EventTypeId }>
  | Readonly<{ scope: 'player'; playerId: PlayerId }>
  | Readonly<{ scope: 'player_type_pair'; playerId: PlayerId; eventTypeId: EventTypeId }>;

/** The scope of a row (SUI-23, SUI-28), the glossary's `ValidationRowScope`. */
export type ValidationRowScope = ValidationRowPlace['scope'];

/**
 * What places a tracked case, a regrouping exit or a historical case in the rows (CL-SUI-06):
 * its player, its type, and the sub-row of its forecast, null without one.
 */
export type RowMember = Readonly<{
  playerId: PlayerId;
  eventTypeId: EventTypeId;
  overallSubrow: OverallSubrowKind | null;
}>;

/** A row's place, and whether it belongs to the archived part (SUI-23, CL-SUI-11). */
export type PlacedRow = Readonly<{ place: ValidationRowPlace; archived: boolean }>;

function placedRow(place: ValidationRowPlace, isArchived: boolean): PlacedRow {
  return { place, archived: isArchived };
}

const OVERALL_ROWS: readonly PlacedRow[] = [
  placedRow({ scope: 'overall' }, false),
  ...OVERALL_SUBROW_KINDS.map((subrowKind) =>
    placedRow({ scope: 'overall_subrow', subrowKind }, false),
  ),
];

/**
 * Tells whether a member belongs to a row (SUI-23, SUI-28, CL-SUI-06): every member to the
 * overall row; to a sub-row, the members with that sub-row's forecast; to the row of a type, a
 * player or a pair, the members of that type, that player or both. A co-occurring case thus
 * belongs to the rows of its own type only.
 */
export function isInRow(place: ValidationRowPlace, member: RowMember): boolean {
  return (
    (!('subrowKind' in place) || member.overallSubrow === place.subrowKind) &&
    (!('playerId' in place) || member.playerId === place.playerId) &&
    (!('eventTypeId' in place) || member.eventTypeId === place.eventTypeId)
  );
}

/**
 * Lists the rows of the validation table in their fixed order (SUI-23, SUI-28, CL-SUI-11):
 * the overall row and its sub-rows; one row per validated type, per followed player, with no
 * member if need be, and per pair with a member, by player then type, in the roster's order;
 * then, in the archived part, the rows of the withdrawn types, of the withdrawn players, and of
 * the pairs of either. The proposed and rejected types have no row.
 */
export function tableRows(roster: TableRoster, members: readonly RowMember[]): PlacedRow[] {
  const typeRows = roster.eventTypes.flatMap(({ eventTypeId, status }) =>
    status === 'validated' || status === 'withdrawn'
      ? placedRow({ scope: 'type', eventTypeId }, status === 'withdrawn')
      : [],
  );
  const playerRows = roster.players.map(({ playerId, status }) =>
    placedRow({ scope: 'player', playerId }, status === 'withdrawn'),
  );
  const pairRows = roster.players.flatMap((player) =>
    roster.eventTypes.flatMap((type) => {
      const { playerId } = player;
      const { eventTypeId } = type;
      const pair: ValidationRowPlace = { scope: 'player_type_pair', playerId, eventTypeId };
      const isArchived = player.status === 'withdrawn' || type.status === 'withdrawn';
      return members.some((member) => isInRow(pair, member)) ? placedRow(pair, isArchived) : [];
    }),
  );
  const listed = [...typeRows, ...playerRows, ...pairRows];
  return [
    ...OVERALL_ROWS,
    ...listed.filter(({ archived }) => !archived),
    ...listed.filter(({ archived }) => archived),
  ];
}
