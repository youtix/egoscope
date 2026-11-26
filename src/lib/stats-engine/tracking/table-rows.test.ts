import { describe, expect, it } from 'vitest';

import { isInRow, tableRows } from './table-rows';

import type { RowMember, TableRoster, ValidationRowPlace } from './table-rows';

// Invented identifiers.
const PLAYER_A = 'player-a';
const PLAYER_B = 'player-b';
const PLAYER_C = 'player-c';
const PLAYER_D = 'player-d';
const TYPE_X = 'type-x';
const TYPE_Y = 'type-y';
const TYPE_Z = 'type-z';

const ROSTER: TableRoster = {
  eventTypes: [
    { eventTypeId: TYPE_X, status: 'validated' },
    { eventTypeId: 'type-proposed', status: 'proposed' },
    { eventTypeId: TYPE_Z, status: 'withdrawn' },
    { eventTypeId: TYPE_Y, status: 'validated' },
    { eventTypeId: 'type-rejected', status: 'rejected' },
  ],
  players: [
    { playerId: PLAYER_B, status: 'paused' },
    { playerId: PLAYER_A, status: 'active' },
    { playerId: PLAYER_C, status: 'withdrawn' },
    { playerId: PLAYER_D, status: 'active' },
  ],
};
const OVERALL_ROWS = [
  ['overall', false],
  ['overall_subrow:probable_profile', false],
  ['overall_subrow:possible_profile', false],
  ['overall_subrow:general_trend', false],
];

function memberOf(playerId: string, eventTypeId: string): RowMember {
  return { playerId, eventTypeId, overallSubrow: 'possible_profile' };
}

function keyOf(place: ValidationRowPlace): string {
  const subrow = 'subrowKind' in place ? [place.subrowKind] : [];
  const player = 'playerId' in place ? [place.playerId] : [];
  const type = 'eventTypeId' in place ? [place.eventTypeId] : [];
  return [place.scope, ...subrow, ...player, ...type].join(':');
}

function rowsOf(members: readonly RowMember[]): unknown[] {
  return tableRows(ROSTER, members).map(({ place, archived }) => [keyOf(place), archived]);
}

describe('tableRows', () => {
  it('[SUI-23] [SUI-28] [CL-SUI-11] lists the overall row and its sub-rows, the validated types, every player, and the pairs with a member, by player then type, then the archived part', () => {
    expect(
      rowsOf([
        memberOf(PLAYER_A, TYPE_Y),
        memberOf(PLAYER_C, TYPE_X),
        memberOf(PLAYER_A, TYPE_X),
        memberOf(PLAYER_B, TYPE_Z),
        memberOf(PLAYER_B, TYPE_X),
        memberOf(PLAYER_A, TYPE_X),
      ]),
    ).toStrictEqual([
      ...OVERALL_ROWS,
      [`type:${TYPE_X}`, false],
      [`type:${TYPE_Y}`, false],
      [`player:${PLAYER_B}`, false],
      [`player:${PLAYER_A}`, false],
      [`player:${PLAYER_D}`, false],
      [`player_type_pair:${PLAYER_B}:${TYPE_X}`, false],
      [`player_type_pair:${PLAYER_A}:${TYPE_X}`, false],
      [`player_type_pair:${PLAYER_A}:${TYPE_Y}`, false],
      [`type:${TYPE_Z}`, true],
      [`player:${PLAYER_C}`, true],
      [`player_type_pair:${PLAYER_B}:${TYPE_Z}`, true],
      [`player_type_pair:${PLAYER_C}:${TYPE_X}`, true],
    ]);
  });

  it('[SUI-23] [CL-SUI-11] lists every player and validated type with zero cases, and no pair, when no row has a member', () => {
    expect(rowsOf([])).toStrictEqual([
      ...OVERALL_ROWS,
      [`type:${TYPE_X}`, false],
      [`type:${TYPE_Y}`, false],
      [`player:${PLAYER_B}`, false],
      [`player:${PLAYER_A}`, false],
      [`player:${PLAYER_D}`, false],
      [`type:${TYPE_Z}`, true],
      [`player:${PLAYER_C}`, true],
    ]);
  });
});

describe('isInRow', () => {
  const places: readonly ValidationRowPlace[] = [
    { scope: 'overall' },
    { scope: 'overall_subrow', subrowKind: 'possible_profile' },
    { scope: 'overall_subrow', subrowKind: 'probable_profile' },
    { scope: 'type', eventTypeId: TYPE_X },
    { scope: 'type', eventTypeId: TYPE_Y },
    { scope: 'player', playerId: PLAYER_A },
    { scope: 'player', playerId: PLAYER_B },
    { scope: 'player_type_pair', playerId: PLAYER_A, eventTypeId: TYPE_X },
    { scope: 'player_type_pair', playerId: PLAYER_A, eventTypeId: TYPE_Y },
    { scope: 'player_type_pair', playerId: PLAYER_B, eventTypeId: TYPE_X },
  ];

  it('[SUI-23] [SUI-28] [CL-SUI-06] places a member in the overall row, the sub-row of its forecast, and the rows of its type, its player and its pair, and in no other', () => {
    const member = memberOf(PLAYER_A, TYPE_X);
    expect(places.map((place) => isInRow(place, member))).toStrictEqual([
      true,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      false,
    ]);
  });

  it('[SUI-28] [CL-SUI-16] places a member without a forecast in no sub-row', () => {
    const member: RowMember = { ...memberOf(PLAYER_A, TYPE_X), overallSubrow: null };
    expect(places.slice(0, 3).map((place) => isInRow(place, member))).toStrictEqual([
      true,
      false,
      false,
    ]);
  });
});
