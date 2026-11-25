import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import engineParams from '@data/fixtures/stats-engine/engine-params.json';

import { attachToMeasuredGame } from '../measured-game/attachment';
import { tallyProfile } from '../profiles/tally';
import { groupCases } from './grouping';

import type {
  Attachment,
  AttachmentEvent,
  AttachmentGame,
  ReferenceInstantOrigin,
} from '../measured-game/attachment';
import type { Participation } from '../performance/participation';
import type { ProfileCase } from '../profiles/tally';
import type { EngineParams } from '../types';
import type { CaseEvent, CaseGroup } from './grouping';

// The registry's defaults, a window of 10 days among them (SEN-04). JSON gives the
// baseline phase as a string, which the comparison narrows to a BaselinePhase
// (types.test.ts).
const DEFAULTS: EngineParams = {
  ...engineParams,
  games: {
    ...engineParams.games,
    postseasonBaseline:
      engineParams.games.postseasonBaseline === 'regular_season' ? 'regular_season' : 'postseason',
  },
};

const HOUR = 3_600_000;
// Hours behind UTC in winter: New York, and Los Angeles.
const NEW_YORK_BEHIND_UTC = 5;
const LOS_ANGELES_BEHIND_UTC = 8;

// Two invented followed players, his team and its opponent, and four seeded types.
const PLAYER = '0b7e2f4a-6c1d-4e8b-9a3f-5d2c7e1b9a40';
const TEAMMATE = '3f9a1c7e-2b4d-4a6e-8c1f-7e5d3b9a2c61';
const TEAM = 7;
const OPPONENT = 19;
const HUMILIATION = 'public-humiliation';
const CONFLICT = 'player-conflict';
const RECORD = 'record-approach';
const BIRTHDAY = 'birthday';

const dayStart = (dayOn: string): number => {
  const [year = 0, month = 0, day = 0] = dayOn.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};

/** The instant of New York wall time `hours` on `dayOn`, in winter. */
const easternAt = (dayOn: string, hours: number): number =>
  dayStart(dayOn) + (hours + NEW_YORK_BEHIND_UTC) * HOUR;

/** The end of `dayOn` in Pacific time, 00:00 Los Angeles time the next day (SEN-01). */
const endOfDayPacific = (dayOn: string): number =>
  dayStart(dayOn) + (24 + LOS_ANGELES_BEHIND_UTC) * HOUR;

/** His team game `id`, final, on the US date `dayOn` at 19:30 New York time. */
function gameOn(
  id: number,
  dayOn: string,
  participation: Participation = 'played',
): AttachmentGame {
  return {
    game: {
      id,
      phase: 'regular_season',
      status: 'final',
      homeTeamId: TEAM,
      awayTeamId: OPPONENT,
      finalScore: { home: 99, away: 95 },
      scheduledStartAt: easternAt(dayOn, 19.5),
      homeLinesPublished: true,
      awayLinesPublished: true,
    },
    teamId: TEAM,
    participation,
    minutes: participation === 'played' ? 33 : null,
    gameDayOn: dayOn,
    endOfDayPacificAt: endOfDayPacific(dayOn),
    isBoxScoreUnavailable: false,
  };
}

// His team games of the 2023-24 season: around the worked example's Wednesday game, then
// two he missed in December before the one he played on 12 December.
const SATURDAY = gameOn(101, '2023-11-11');
const WEDNESDAY = gameOn(102, '2023-11-15');
const FRIDAY = gameOn(103, '2023-11-17');
const MISSED = [gameOn(104, '2023-12-02', 'not_played'), gameOn(105, '2023-12-05', 'not_played')];
const DECEMBER_12 = gameOn(106, '2023-12-12');
const CONTEXT = {
  games: [SATURDAY, WEDNESDAY, FRIDAY, ...MISSED, DECEMBER_12],
  now: easternAt('2024-01-15', 12),
  nowGameDayOn: '2024-01-15',
};

/** A historical event whose public date is the date `dayOn` only, as is its one source. */
const publicOn = (dayOn: string): AttachmentEvent => ({
  kind: 'reference_instant',
  referenceInstantAt: endOfDayPacific(dayOn),
  referenceInstantOrigin: 'date_only',
  sources: [{ publicationDateOn: dayOn, publicationAt: null }],
});

/** An event public at the instant `at`, with no source: a detected event. */
const publicAt = (at: number): AttachmentEvent => ({
  kind: 'reference_instant',
  referenceInstantAt: at,
  referenceInstantOrigin: 'known_instant',
  sources: null,
});

type AttachedEvent = CaseEvent & Attachment;

/** His event `eventId` of `eventTypeId`, attached on its own (CL-SEN-06). */
const attached = (eventId: number, eventTypeId: string, event: AttachmentEvent): AttachedEvent => ({
  playerId: PLAYER,
  eventTypeId,
  eventId,
  ...attachToMeasuredGame(event, CONTEXT, DEFAULTS),
});

/**
 * His event `eventId` of `eventTypeId` whose attachment stopped at `measuredGameId`, null
 * for none, public `eventId` hours after the start of 1970.
 */
const onGame = (
  eventId: number,
  eventTypeId: string,
  measuredGameId: number | null,
): CaseEvent => ({
  playerId: PLAYER,
  eventTypeId,
  eventId,
  measuredGameId,
  referenceInstantAt: eventId * HOUR,
  referenceInstantOrigin: 'known_instant',
});

/** `event`, public `hours` after the start of 1970 instead. */
const atHour = (event: CaseEvent, hours: number): CaseEvent => ({
  ...event,
  referenceInstantAt: hours * HOUR,
});

/** `event` as an event known in advance, with no reference instant. */
const knownInAdvance = (event: CaseEvent): CaseEvent => ({
  ...event,
  referenceInstantAt: null,
  referenceInstantOrigin: 'known_in_advance',
});

/** `event` as the teammate's. */
const ofTeammate = (event: CaseEvent): CaseEvent => ({ ...event, playerId: TEAMMATE });

const idsOf = ({ events }: CaseGroup<CaseEvent>): readonly number[] =>
  events.map(({ eventId }) => eventId);

/** Each case as its type, its game and the other types it is co-occurring with. */
const coOccurrenceOf = (cases: readonly CaseGroup<CaseEvent>[]): readonly unknown[] =>
  cases.map(({ eventTypeId, measuredGameId, isCoOccurring, coOccurringTypeIds }) => [
    eventTypeId,
    measuredGameId,
    isCoOccurring,
    coOccurringTypeIds,
  ]);

/** Each case as its events and its game. */
const contentsOf = (cases: readonly CaseGroup<CaseEvent>[]): readonly unknown[] =>
  cases.map((caseGroup) => [idsOf(caseGroup), caseGroup.measuredGameId]);

/** The cases of `eventTypeId` as a profile counts them, valid with a gap of 0.40 (SEN-20). */
function profileCasesOf(
  cases: readonly CaseGroup<CaseEvent>[],
  eventTypeId: string,
): readonly ProfileCase[] {
  const event = { researchConfidence: null };
  return cases
    .filter((caseGroup) => caseGroup.eventTypeId === eventTypeId)
    .map((caseGroup, index) => ({
      caseId: index + 1,
      events: [event, ...caseGroup.events.slice(1).map(() => event)],
      isCoOccurring: caseGroup.isCoOccurring,
      status: 'measured',
      measuredGameScheduledStartAt: WEDNESDAY.game.scheduledStartAt,
      normalizedGap: 0.4,
      gapStatus: 'final',
    }));
}

describe('groupCases', () => {
  it("[SEN-05] [CL-SEN-06] makes the worked example's Monday and Tuesday events one case on Wednesday's game, from Monday's instant", () => {
    const tuesday = attached(11, HUMILIATION, publicOn('2023-11-14'));
    const monday = attached(10, HUMILIATION, publicOn('2023-11-13'));
    const [c10, ...others] = groupCases([tuesday, monday]);
    expect(others).toStrictEqual([]);
    expect(c10?.events).toStrictEqual([monday, tuesday]);
    expect([monday.status, tuesday.status, c10?.measuredGameId]).toStrictEqual([
      'attached',
      'attached',
      WEDNESDAY.game.id,
    ]);
    expect([c10?.referenceInstantAt, c10?.referenceInstantOrigin]).toStrictEqual([
      Date.UTC(2023, 10, 14, 8),
      'date_only',
    ]);
  });

  it('[CA-SEN-06] [SEN-05] [SEN-06] counts two events of one type before one game as one case, and gives two types each a co-occurring case', () => {
    const conflict = publicAt(easternAt('2023-11-14', 12));
    const cases = groupCases([
      attached(10, HUMILIATION, publicOn('2023-11-13')),
      attached(11, HUMILIATION, publicOn('2023-11-14')),
      attached(12, CONFLICT, conflict),
    ]);
    expect(coOccurrenceOf(cases)).toStrictEqual([
      [HUMILIATION, WEDNESDAY.game.id, true, [CONFLICT]],
      [CONFLICT, WEDNESDAY.game.id, true, [HUMILIATION]],
    ]);
    expect(tallyProfile(profileCasesOf(cases, HUMILIATION), [])).toMatchObject({
      eventCount: 2,
      caseCount: 1,
      groupedEventCount: 1,
      coOccurringCount: 1,
    });
    expect(tallyProfile(profileCasesOf(cases, CONFLICT), [])).toMatchObject({
      eventCount: 1,
      caseCount: 1,
      coOccurringCount: 1,
    });
  });

  it('[SEN-05] [CL-SEN-06] keeps as its own case an event whose own window ends before the game, and checks no window again from its instant', () => {
    const later = attached(21, HUMILIATION, publicAt(easternAt('2023-12-04', 12)));
    const earlier = attached(20, HUMILIATION, publicAt(easternAt('2023-12-01', 12)));
    const cases = groupCases([later, earlier]);
    expect(contentsOf(cases)).toStrictEqual([
      [[20], null],
      [[21], DECEMBER_12.game.id],
    ]);
    expect([earlier.status, later.status]).toStrictEqual(['not_measurable', 'attached']);
    expect(cases[1]?.referenceInstantAt).toBe(easternAt('2023-12-04', 12));
  });

  it('[SEN-05] [CL-SEN-06] keeps as its own case an event whose precedence is not established, before the game of another event', () => {
    const late = { publicationDateOn: '2023-12-13', publicationAt: easternAt('2023-12-13', 9) };
    const unproven = { ...publicAt(easternAt('2023-12-10', 12)), sources: [late] };
    const notEstablished = attached(22, HUMILIATION, unproven);
    const established = attached(21, HUMILIATION, publicAt(easternAt('2023-12-04', 12)));
    const cases = groupCases([notEstablished, established]);
    expect(contentsOf(cases)).toStrictEqual([
      [[21], DECEMBER_12.game.id],
      [[22], null],
    ]);
    expect(notEstablished).toMatchObject({
      status: 'not_measurable',
      reason: 'precedence_not_established',
    });
  });

  it('[SEN-05] [CL-SEN-06] keeps apart the events of one player and type that reach no game', () => {
    const cases = groupCases([onGame(2, HUMILIATION, null), onGame(1, HUMILIATION, null)]);
    expect(contentsOf(cases)).toStrictEqual([
      [[1], null],
      [[2], null],
    ]);
  });

  it('[SEN-05] [CL-SEN-06] groups the events whose walks stop at one game not played yet', () => {
    const cases = groupCases([onGame(2, HUMILIATION, 300), onGame(1, HUMILIATION, 300)]);
    expect(contentsOf(cases)).toStrictEqual([[[1, 2], 300]]);
  });

  it('[SEN-05] takes the reference instant and its origin from the earliest event, whatever their ids', () => {
    const later = atHour(onGame(4, HUMILIATION, 300), 5);
    const earliest: CaseEvent = {
      ...atHour(onGame(8, HUMILIATION, 300), 2),
      referenceInstantOrigin: 'date_only',
    };
    const [caseGroup] = groupCases([later, earliest]);
    expect(caseGroup?.events).toStrictEqual([earliest, later]);
    expect([caseGroup?.referenceInstantAt, caseGroup?.referenceInstantOrigin]).toStrictEqual([
      2 * HOUR,
      'date_only',
    ]);
  });

  it.each([
    { name: 'one reference instant', toInstant: (event: CaseEvent) => atHour(event, 3) },
    { name: 'no reference instant, known in advance', toInstant: knownInAdvance },
  ])('[SEN-05] orders by id the events of $name', ({ toInstant }) => {
    const cases = groupCases([
      toInstant(onGame(6, RECORD, 300)),
      toInstant(onGame(2, RECORD, 300)),
    ]);
    expect(contentsOf(cases)).toStrictEqual([[[2, 6], 300]]);
  });

  it('[SEN-05] ranks an event without a reference instant after one with an instant, and gives a case known in advance none', () => {
    const known = knownInAdvance(onGame(1, RECORD, 300));
    const [caseGroup] = groupCases([known, onGame(2, RECORD, 300)]);
    const [knownCase] = groupCases([known]);
    expect([caseGroup?.referenceInstantAt, caseGroup?.referenceInstantOrigin]).toStrictEqual([
      2 * HOUR,
      'known_instant',
    ]);
    expect([knownCase?.referenceInstantAt, knownCase?.referenceInstantOrigin]).toStrictEqual([
      null,
      'known_in_advance',
    ]);
  });

  it('[SEN-06] [CL-SEN-06] gives each type its own case on one game, each co-occurring with the other types', () => {
    const cases = groupCases([
      onGame(3, RECORD, 300),
      onGame(1, HUMILIATION, 300),
      onGame(2, CONFLICT, 300),
      onGame(4, HUMILIATION, 301),
    ]);
    expect(coOccurrenceOf(cases)).toStrictEqual([
      [HUMILIATION, 300, true, [CONFLICT, RECORD]],
      [CONFLICT, 300, true, [HUMILIATION, RECORD]],
      [RECORD, 300, true, [HUMILIATION, CONFLICT]],
      [HUMILIATION, 301, false, []],
    ]);
  });

  it('[SEN-06] [CL-SEN-03] [CL-SEN-06] makes a calendar-derived case co-occurring with a case of another type on its derived game', () => {
    const birthday: AttachmentEvent = { kind: 'calendar_derived', derivedGame: WEDNESDAY };
    const cases = groupCases([
      attached(31, BIRTHDAY, birthday),
      attached(30, HUMILIATION, publicOn('2023-11-14')),
    ]);
    expect(coOccurrenceOf(cases)).toStrictEqual([
      [HUMILIATION, WEDNESDAY.game.id, true, [BIRTHDAY]],
      [BIRTHDAY, WEDNESDAY.game.id, true, [HUMILIATION]],
    ]);
  });

  it('[SEN-06] [CL-SEN-06] keeps the cases of two followed players in one game apart', () => {
    const cases = groupCases([
      onGame(1, HUMILIATION, 300),
      ofTeammate(onGame(2, HUMILIATION, 300)),
      ofTeammate(onGame(3, CONFLICT, 300)),
    ]);
    expect(cases.map(({ playerId, events }) => [playerId, events.length])).toStrictEqual([
      [PLAYER, 1],
      [TEAMMATE, 1],
      [TEAMMATE, 1],
    ]);
    expect(coOccurrenceOf(cases)).toStrictEqual([
      [HUMILIATION, 300, false, []],
      [HUMILIATION, 300, true, [CONFLICT]],
      [CONFLICT, 300, true, [HUMILIATION]],
    ]);
  });

  it('[SEN-06] [CL-SEN-06] never makes co-occurring the cases of two types that reach no game', () => {
    const cases = groupCases([onGame(1, HUMILIATION, null), onGame(2, CONFLICT, null)]);
    expect(coOccurrenceOf(cases)).toStrictEqual([
      [HUMILIATION, null, false, []],
      [CONFLICT, null, false, []],
    ]);
  });
});

const ORIGINS: readonly ReferenceInstantOrigin[] = [
  'known_instant',
  'date_only',
  'uncertain_precedence_shift',
];

// From 1 to 6 runs of 1 to 3 events of one of two players, one of three types and one
// game, or none, each at one of a few instants, from any origin, or with none; runs share
// players, types, games and instants too. With a shuffled copy.
const anyInstant = fc.option(fc.tuple(fc.nat({ max: 4 }), fc.constantFrom(...ORIGINS)), {
  nil: null,
});
const anyRun = fc.record({
  playerId: fc.constantFrom(PLAYER, TEAMMATE),
  eventTypeId: fc.constantFrom(HUMILIATION, CONFLICT, BIRTHDAY),
  measuredGameId: fc.option(fc.integer({ min: 300, max: 302 }), { nil: null }),
  instants: fc.array(anyInstant, { minLength: 1, maxLength: 3 }),
});

/** A run of events: their player, type and game, and the instant of each, with its origin. */
type Run = Readonly<{
  playerId: string;
  eventTypeId: string;
  measuredGameId: number | null;
  instants: readonly (readonly [number, ReferenceInstantOrigin] | null)[];
}>;

/** The events of the run at `runIndex`, the event at `index` of it of id 10 × runIndex + index + 1. */
const eventsOfRun = ({ instants, ...run }: Run, runIndex: number): readonly CaseEvent[] =>
  instants.map((instant, index) => ({
    ...run,
    eventId: runIndex * 10 + index + 1,
    referenceInstantAt: instant === null ? null : instant[0] * HOUR,
    referenceInstantOrigin: instant === null ? 'known_in_advance' : instant[1],
  }));

const anyEvents = fc
  .array(anyRun, { minLength: 1, maxLength: 6 })
  .map((runs) => runs.flatMap((run, runIndex) => eventsOfRun(run, runIndex)))
  .chain((events) =>
    fc.record({
      events: fc.constant(events),
      shuffled: fc.shuffledSubarray(events, { minLength: events.length, maxLength: events.length }),
    }),
  );

const byNumber = (left: number, right: number): number => left - right;

/** The ids of every event, in increasing order. */
const sortedIds = (events: readonly CaseEvent[]): readonly number[] =>
  events.map(({ eventId }) => eventId).toSorted(byNumber);

/** Whether every event of a case is of its player, type and game, alone without a game. */
const isWellFormed = (caseGroup: CaseGroup<CaseEvent>): boolean =>
  caseGroup.events.every(
    ({ playerId, eventTypeId, measuredGameId }) =>
      playerId === caseGroup.playerId &&
      eventTypeId === caseGroup.eventTypeId &&
      measuredGameId === caseGroup.measuredGameId,
  ) &&
  (caseGroup.measuredGameId !== null || caseGroup.events.length === 1);

/** The player, type and game of each case that has a game. */
const keysOnAGame = (cases: readonly CaseGroup<CaseEvent>[]): readonly string[] =>
  cases
    .filter(({ measuredGameId }) => measuredGameId !== null)
    .map(({ playerId, eventTypeId, measuredGameId }) =>
      JSON.stringify([playerId, eventTypeId, measuredGameId]),
    );

/** Whether `other` comes before `event`: an earlier instant, none last, or a smaller id. */
const isBefore = (other: CaseEvent, event: CaseEvent): boolean => {
  const otherAt = other.referenceInstantAt ?? Infinity;
  const eventAt = event.referenceInstantAt ?? Infinity;
  return otherAt < eventAt || (otherAt === eventAt && other.eventId < event.eventId);
};

/** The event of a case that no other event of it comes before, with its instant. */
const earliestOf = ({ events }: CaseGroup<CaseEvent>): readonly unknown[] => {
  const earliest = events.find((event) => events.every((other) => !isBefore(other, event)));
  return [earliest, earliest?.referenceInstantAt, earliest?.referenceInstantOrigin];
};

/** The first event of a case, with the reference instant and origin it gives. */
const firstOf = (caseGroup: CaseGroup<CaseEvent>): readonly unknown[] => [
  caseGroup.events[0],
  caseGroup.referenceInstantAt,
  caseGroup.referenceInstantOrigin,
];

/** The types of his other cases on the game of `caseGroup`. */
function otherTypesOnGame(
  caseGroup: CaseGroup<CaseEvent>,
  cases: readonly CaseGroup<CaseEvent>[],
): ReadonlySet<string> {
  const isOnTheGame = (other: CaseGroup<CaseEvent>): boolean =>
    other !== caseGroup &&
    caseGroup.measuredGameId !== null &&
    other.playerId === caseGroup.playerId &&
    other.measuredGameId === caseGroup.measuredGameId;
  return new Set(cases.filter((other) => isOnTheGame(other)).map(({ eventTypeId }) => eventTypeId));
}

/** Each case as whether it is co-occurring and the set of its other types. */
const markOf = ({
  isCoOccurring,
  coOccurringTypeIds,
}: CaseGroup<CaseEvent>): readonly unknown[] => [isCoOccurring, new Set(coOccurringTypeIds)];

/** Each case as whether his cases of other types share its game, and their types. */
const expectedMarkOf =
  (cases: readonly CaseGroup<CaseEvent>[]) =>
  (caseGroup: CaseGroup<CaseEvent>): readonly unknown[] => {
    const otherTypes = otherTypesOnGame(caseGroup, cases);
    return [otherTypes.size > 0, otherTypes];
  };

describe('groupCases, whatever the events', () => {
  it('[SEN-05] [SEN-06] [CL-SEN-06] groups the events the same whatever their order', () => {
    fc.assert(
      fc.property(anyEvents, ({ events, shuffled }) => {
        expect(groupCases(shuffled)).toStrictEqual(groupCases(events));
      }),
    );
  });

  it('[SEN-05] [SEN-06] [CL-SEN-06] puts each event in one case of its player, type and game, from the earliest instant, beside the other types on that game', () => {
    fc.assert(
      fc.property(anyEvents, ({ events }) => {
        const cases = groupCases(events);
        const keys = keysOnAGame(cases);
        expect(sortedIds(cases.flatMap(({ events: caseEvents }) => caseEvents))).toStrictEqual(
          sortedIds(events),
        );
        expect(cases.filter((caseGroup) => !isWellFormed(caseGroup))).toStrictEqual([]);
        expect(new Set(keys).size).toBe(keys.length);
        expect(cases.map((caseGroup) => firstOf(caseGroup))).toStrictEqual(
          cases.map((caseGroup) => earliestOf(caseGroup)),
        );
        expect(cases.map((caseGroup) => markOf(caseGroup))).toStrictEqual(
          cases.map(expectedMarkOf(cases)),
        );
      }),
    );
  });
});
