import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { placeEvent, relatedSheets } from './grouping';

import type { GameId, PlayerEventId, PlayerId } from '../types';
import type { GroupingSheet, SheetEvent, SheetPlacement } from './grouping';

// Three invented followed players, and the games of their teams.
const PLAYER = '6d2a9c41-3e7b-4f15-8a60-2c9e4b7d1f03';
const TEAMMATE = 'a81f5e27-9c3d-4b62-b7e4-0d6f2a9c5e18';
const RIVAL = 'c4e07b93-1a5f-4d28-9e6c-7b3a0f8d2e45';
const TONIGHT = 101;
const SATURDAY = 102;
const MONDAY = 103;
const WEDNESDAY = 104;

/** A sheet as the alerts module keeps one, with its status, which the grouping never reads. */
type Sheet = {
  number: number;
  status: 'open' | 'closed' | 'canceled';
  playerId: PlayerId;
  expectedGameIdAtDetection: GameId | null;
  currentExpectedGameId: GameId | null;
  eventIds: PlayerEventId[];
};

type SheetShape = Readonly<{
  games: readonly [GameId | null, (GameId | null)?];
  eventIds: PlayerEventId[];
}>;

/**
 * Sheet `number` of a player, with the events placed on it and the expected game they had
 * at their detection, `[gameAtDetection]`, which is still its current one, or
 * `[gameAtDetection, currentGame]` after a schedule change.
 */
function sheet(number: number, playerId: PlayerId, { games, eventIds }: SheetShape): Sheet {
  const [atDetection, current = atDetection] = games;
  return {
    number,
    status: 'open',
    playerId,
    expectedGameIdAtDetection: atDetection,
    currentExpectedGameId: current,
    eventIds,
  };
}

function detected(
  eventId: PlayerEventId,
  playerId: PlayerId,
  expectedGameIdAtDetection: GameId | null,
): SheetEvent {
  return { origin: 'detected', eventId, playerId, expectedGameIdAtDetection };
}

function derived(eventId: PlayerEventId, playerId: PlayerId, derivedGameId: GameId): SheetEvent {
  return { origin: 'calendar', eventId, playerId, derivedGameId };
}

/** Where an event goes, with the numbers of the sheets its placement names. */
function placementOf(event: SheetEvent, sheets: readonly Sheet[]): unknown {
  const placement = placeEvent(event, sheets);
  return placement.kind === 'new_sheet'
    ? { kind: placement.kind, related: placement.relatedSheets.map(({ number }) => number) }
    : { kind: placement.kind, sheet: placement.sheet.number };
}

describe('placeEvent', () => {
  it('[ALE-03] puts an event on the sheet of his whose events had its expected game at their detection', () => {
    const sheets = [
      sheet(1, PLAYER, { games: [SATURDAY], eventIds: [10] }),
      sheet(2, PLAYER, { games: [TONIGHT], eventIds: [11, 12] }),
      sheet(3, TEAMMATE, { games: [TONIGHT], eventIds: [13] }),
    ];

    expect(placementOf(detected(20, PLAYER, TONIGHT), sheets)).toStrictEqual({
      kind: 'joins',
      sheet: 2,
    });
  });

  it("[ALE-03] gives a new sheet to an event of his on another game, or of another player on his game's", () => {
    const sheets = [sheet(1, PLAYER, { games: [TONIGHT], eventIds: [10] })];

    expect(placementOf(detected(20, PLAYER, SATURDAY), sheets)).toStrictEqual({
      kind: 'new_sheet',
      related: [],
    });
    expect(placementOf(detected(21, TEAMMATE, TONIGHT), sheets)).toStrictEqual({
      kind: 'new_sheet',
      related: [],
    });
  });

  it('[ALE-03] leaves an event already on a sheet where it is, whatever its expected game now', () => {
    const sheets = [
      sheet(1, PLAYER, { games: [TONIGHT], eventIds: [10, 11] }),
      sheet(2, PLAYER, { games: [SATURDAY], eventIds: [12] }),
    ];

    expect(placementOf(detected(11, PLAYER, SATURDAY), sheets)).toStrictEqual({
      kind: 'already_placed',
      sheet: 1,
    });
    expect(placementOf(detected(12, PLAYER, null), sheets)).toStrictEqual({
      kind: 'already_placed',
      sheet: 2,
    });
  });

  it('[ALE-03] [H-ALE-02] groups by the expected game at detection, not by the game a schedule change moved the sheet to', () => {
    // Sheet 1 was produced for tonight's game, then postponed onto Saturday's.
    const sheets = [sheet(1, PLAYER, { games: [TONIGHT, SATURDAY], eventIds: [10] })];

    expect(placementOf(detected(20, PLAYER, SATURDAY), sheets)).toStrictEqual({
      kind: 'new_sheet',
      related: [1],
    });
    expect(placementOf(detected(21, PLAYER, TONIGHT), sheets)).toStrictEqual({
      kind: 'joins',
      sheet: 1,
    });
  });

  it('[ALE-03] gives an event with no known expected game a sheet of its own, related to none', () => {
    const sheets = [
      sheet(1, PLAYER, { games: [null], eventIds: [10] }),
      sheet(2, PLAYER, { games: [TONIGHT, null], eventIds: [11] }),
    ];

    expect(placementOf(detected(20, PLAYER, null), sheets)).toStrictEqual({
      kind: 'new_sheet',
      related: [],
    });
  });

  it('[ALE-03] [H-ALE-02] relates a new sheet to the sheets of his only that end on its game', () => {
    const sheets = [
      sheet(1, PLAYER, { games: [TONIGHT, MONDAY], eventIds: [10] }),
      sheet(2, PLAYER, { games: [SATURDAY, MONDAY], eventIds: [11] }),
      sheet(3, TEAMMATE, { games: [MONDAY], eventIds: [12] }),
      sheet(4, PLAYER, { games: [WEDNESDAY], eventIds: [13] }),
    ];

    expect(placementOf(detected(20, PLAYER, MONDAY), sheets)).toStrictEqual({
      kind: 'new_sheet',
      related: [1, 2],
    });
  });

  it('[CL-ALE-13] groups a calendar-derived event by the game it is derived from', () => {
    const sheets = [
      sheet(1, PLAYER, { games: [TONIGHT], eventIds: [10] }),
      sheet(2, PLAYER, { games: [SATURDAY], eventIds: [11] }),
      sheet(3, PLAYER, { games: [TONIGHT, MONDAY], eventIds: [12] }),
    ];

    expect(placementOf(derived(20, PLAYER, SATURDAY), sheets)).toStrictEqual({
      kind: 'joins',
      sheet: 2,
    });
    expect(placementOf(derived(21, PLAYER, MONDAY), sheets)).toStrictEqual({
      kind: 'new_sheet',
      related: [3],
    });
    expect(placementOf(derived(22, TEAMMATE, TONIGHT), sheets)).toStrictEqual({
      kind: 'new_sheet',
      related: [],
    });
  });

  it('[CL-ALE-14] puts a new event of a canceled sheet’s game on that sheet', () => {
    const canceled: Sheet = {
      ...sheet(1, PLAYER, { games: [TONIGHT], eventIds: [10] }),
      status: 'canceled',
    };

    expect(placementOf(detected(20, PLAYER, TONIGHT), [canceled])).toStrictEqual({
      kind: 'joins',
      sheet: 1,
    });
  });
});

describe('relatedSheets', () => {
  it('[H-ALE-02] relates two sheets of a player that end on the same game, each to the other', () => {
    const postponed = sheet(1, PLAYER, { games: [TONIGHT, SATURDAY], eventIds: [10] });
    const saturday = sheet(2, PLAYER, { games: [SATURDAY], eventIds: [11] });
    const teammate = sheet(3, TEAMMATE, { games: [SATURDAY], eventIds: [12] });
    const monday = sheet(4, PLAYER, { games: [MONDAY], eventIds: [13] });
    const sheets = [postponed, saturday, teammate, monday];

    expect(relatedSheets(postponed, sheets).map(({ number }) => number)).toStrictEqual([2]);
    expect(relatedSheets(saturday, sheets).map(({ number }) => number)).toStrictEqual([1]);
    expect(relatedSheets(teammate, sheets)).toStrictEqual([]);
    expect(relatedSheets(monday, sheets)).toStrictEqual([]);
  });

  it('[H-ALE-02] relates no sheet whose expected game is unknown', () => {
    const first = sheet(1, PLAYER, { games: [TONIGHT, null], eventIds: [10] });
    const second = sheet(2, PLAYER, { games: [null], eventIds: [11] });

    expect(relatedSheets(first, [first, second])).toStrictEqual([]);
    expect(relatedSheets(second, [first, second])).toStrictEqual([]);
  });

  it('[ALE-03] [H-ALE-02] tells a sheet read apart from the others by its number, never relating it to itself', () => {
    const stored = sheet(1, PLAYER, { games: [TONIGHT, SATURDAY], eventIds: [10] });
    const saturday = sheet(2, PLAYER, { games: [SATURDAY], eventIds: [11] });

    expect(relatedSheets({ ...stored }, [stored])).toStrictEqual([]);
    expect(
      relatedSheets({ ...stored }, [stored, saturday]).map(({ number }) => number),
    ).toStrictEqual([2]);
  });
});

// --- Random sequences of events ---------------------------------------------------

const PLAYERS = [PLAYER, TEAMMATE, RIVAL];
const GAMES = [TONIGHT, SATURDAY, MONDAY, WEDNESDAY];
const STEP_COUNT = 40;

/**
 * One step of a run: a new detected or calendar-derived event; a new pass over an
 * event already seen, the `pick`th; or a schedule change that moves the `pick`th sheet
 * onto another game, or makes it unknown.
 */
type Step =
  | Readonly<{ kind: 'event'; event: SheetEvent }>
  | Readonly<{ kind: 'again'; pick: number }>
  | Readonly<{ kind: 'reschedule'; pick: number; gameId: GameId | null }>;

const gameArbitrary = fc.constantFrom(...GAMES);
const maybeGameArbitrary = fc.option(gameArbitrary, { nil: null });
const playerArbitrary = fc.constantFrom(...PLAYERS);

/** A raw step, the event's id given later from its position in the run. */
const rawStepArbitrary = fc.oneof(
  fc.record({
    kind: fc.constant('detected'),
    playerId: playerArbitrary,
    gameId: maybeGameArbitrary,
  }),
  fc.record({ kind: fc.constant('calendar'), playerId: playerArbitrary, gameId: gameArbitrary }),
  fc.record({ kind: fc.constant('again'), pick: fc.nat() }),
  fc.record({ kind: fc.constant('reschedule'), pick: fc.nat(), gameId: maybeGameArbitrary }),
);

type RawStep = typeof rawStepArbitrary extends fc.Arbitrary<infer Raw> ? Raw : never;

/** A raw step as a step of the run, a new event taking its position as its id. */
function toStep(raw: RawStep, index: number): Step {
  const eventId = index + 1;
  if (raw.kind === 'detected') {
    return { kind: 'event', event: detected(eventId, raw.playerId, raw.gameId) };
  }
  if (raw.kind === 'calendar') {
    return { kind: 'event', event: derived(eventId, raw.playerId, raw.gameId) };
  }
  return raw;
}

const stepsArbitrary = fc
  .array(rawStepArbitrary, { minLength: 1, maxLength: STEP_COUNT, size: 'max' })
  .map((rawSteps) => rawSteps.map((raw, index) => toStep(raw, index)));

/** The game an event is grouped by: its expected game at detection, or its derived game. */
function gameOf(event: SheetEvent): GameId | null {
  return event.origin === 'calendar' ? event.derivedGameId : event.expectedGameIdAtDetection;
}

function eventsOf(steps: readonly Step[]): readonly SheetEvent[] {
  return steps.flatMap((step) => (step.kind === 'event' ? [step.event] : []));
}

type Run = {
  sheets: Sheet[];
  /** The events seen, in the order of the run. */
  seen: SheetEvent[];
  /** The placements of the passes over an event already seen, with the event. */
  repeated: { event: SheetEvent; placement: SheetPlacement<Sheet> }[];
  /** For each new sheet, the related sheets its placement gave, and those it has once made. */
  created: { related: readonly Sheet[]; relatedOnceMade: readonly Sheet[] }[];
};

/** Places an event as the alerts module would: on the sheet it joins, or on a new sheet. */
function place(run: Run, event: SheetEvent): SheetPlacement<Sheet> {
  const placement = placeEvent(event, run.sheets);
  if (placement.kind === 'joins') {
    placement.sheet.eventIds.push(event.eventId);
  } else if (placement.kind === 'new_sheet') {
    const made = sheet(run.sheets.length + 1, event.playerId, {
      games: [gameOf(event)],
      eventIds: [event.eventId],
    });
    run.sheets.push(made);
    run.created.push({
      related: placement.relatedSheets,
      relatedOnceMade: relatedSheets(made, run.sheets),
    });
  }
  return placement;
}

/** Plays a new pass over the `pick`th event already seen, if any. */
function playAgain(run: Run, pick: number): void {
  const event = run.seen[pick % run.seen.length];
  if (event !== undefined) {
    run.repeated.push({ event, placement: place(run, event) });
  }
}

/** Moves the `pick`th sheet, if any, onto another game, or makes its game unknown. */
function reschedule(run: Run, pick: number, gameId: GameId | null): void {
  const moved = run.sheets[pick % run.sheets.length];
  if (moved !== undefined) {
    moved.currentExpectedGameId = gameId;
  }
}

/** Plays one step of a run. */
function playStep(run: Run, step: Step): void {
  if (step.kind === 'event') {
    place(run, step.event);
    run.seen.push(step.event);
  } else if (step.kind === 'again') {
    playAgain(run, step.pick);
  } else {
    reschedule(run, step.pick, step.gameId);
  }
}

function play(steps: readonly Step[]): Run {
  const run: Run = { sheets: [], seen: [], repeated: [], created: [] };
  for (const step of steps) {
    playStep(run, step);
  }
  return run;
}

/** The sheet holding an event, among those of a run. */
function holdingOf(run: Run, event: SheetEvent): Sheet | undefined {
  return run.sheets.find(({ eventIds }) => eventIds.includes(event.eventId));
}

/** The events of each sheet, to compare two runs' grouping whatever the sheets' numbers. */
function partitionOf(sheets: readonly GroupingSheet[]): readonly (readonly PlayerEventId[])[] {
  return sheets
    .map(({ eventIds }) => eventIds.toSorted((left, right) => left - right))
    .toSorted(([left = 0], [right = 0]) => left - right);
}

/** Whether two sheets are distinct sheets of a player ending on the same known game. */
function areOnSameKnownGame(one: Sheet, other: Sheet): boolean {
  return (
    other.number !== one.number &&
    other.playerId === one.playerId &&
    one.currentExpectedGameId !== null &&
    other.currentExpectedGameId === one.currentExpectedGameId
  );
}

describe('placeEvent and relatedSheets over random event sequences', () => {
  it('[ALE-03] puts every event on one sheet only, and never places it again at a later pass', () => {
    fc.assert(
      fc.property(stepsArbitrary, (steps) => {
        const run = play(steps);

        for (const { event, placement } of run.repeated) {
          expect(placement).toStrictEqual({ kind: 'already_placed', sheet: holdingOf(run, event) });
        }
        const sheetCount = run.sheets.length;
        for (const event of run.seen) {
          expect(placeEvent(event, run.sheets)).toStrictEqual({
            kind: 'already_placed',
            sheet: holdingOf(run, event),
          });
        }
        expect(run.sheets).toHaveLength(sheetCount);
        expect(
          run.sheets.flatMap(({ eventIds }) => eventIds).toSorted((a, b) => a - b),
        ).toStrictEqual(run.seen.map(({ eventId }) => eventId));
      }),
    );
  });

  it('[ALE-03] [CL-ALE-13] keeps one sheet per player and known game, holding his events of that game at detection', () => {
    fc.assert(
      fc.property(stepsArbitrary, (steps) => {
        const { sheets, seen } = play(steps);

        for (const { playerId, expectedGameIdAtDetection, eventIds } of sheets) {
          const held = seen.filter(({ eventId }) => eventIds.includes(eventId));
          expect(held.map((event) => [event.playerId, gameOf(event)])).toStrictEqual(
            held.map(() => [playerId, expectedGameIdAtDetection]),
          );
          expect(expectedGameIdAtDetection === null && held.length > 1).toBe(false);
        }
        const keys = sheets
          .filter(({ expectedGameIdAtDetection }) => expectedGameIdAtDetection !== null)
          .map(({ playerId, expectedGameIdAtDetection }) =>
            JSON.stringify([playerId, expectedGameIdAtDetection]),
          );
        expect(new Set(keys).size).toBe(keys.length);
      }),
    );
  });

  it('[ALE-03] [H-ALE-02] groups the same events alike whatever their order and the schedule changes', () => {
    const runs = stepsArbitrary.chain((steps) => {
      const events = eventsOf(steps);
      return fc.tuple(
        fc.constant(steps),
        fc.shuffledSubarray([...events], { minLength: events.length, maxLength: events.length }),
      );
    });
    fc.assert(
      fc.property(runs, ([steps, shuffled]) => {
        const inOrder = play(steps);
        const reordered = play(shuffled.map((event): Step => ({ kind: 'event', event })));

        expect(partitionOf(reordered.sheets)).toStrictEqual(partitionOf(inOrder.sheets));
      }),
    );
  });

  it('[H-ALE-02] relates exactly the distinct sheets of a player that end on the same known game', () => {
    fc.assert(
      fc.property(stepsArbitrary, (steps) => {
        const { sheets, created } = play(steps);

        for (const one of sheets) {
          expect(relatedSheets(one, sheets)).toStrictEqual(
            sheets.filter((other) => areOnSameKnownGame(one, other)),
          );
        }
        for (const { related, relatedOnceMade } of created) {
          expect(related).toStrictEqual(relatedOnceMade);
        }
      }),
    );
  });
});
