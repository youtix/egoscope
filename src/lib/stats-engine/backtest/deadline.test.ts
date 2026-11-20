import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { deadlineOf, rankTodo } from './deadline';

import type { Deadline, NoNextGameReason, RequestToDo } from './deadline';

// The owner's day of the examples, Friday 20 November 2026.
const TODAY = '2026-11-20';
// New York is five hours behind UTC in winter.
const NEW_YORK_WINTER_OFFSET_HOURS = 5;

/**
 * 00:00 New York time on a US date of winter, the deemed start of a game whose time is
 * to be determined (STA-31, CL-STA-14).
 */
function winterDeemedStart(gameDayOn: string): number {
  const [year = 0, month = 0, date = 0] = gameDayOn.split('-').map(Number);
  return Date.UTC(year, month - 1, date, NEW_YORK_WINTER_OFFSET_HOURS);
}

/** A request to do with the reference that the screens show, which the ranking keeps. */
function toDo(
  backtestRequestId: number,
  createdAt: number,
  urgentDeadlineAt?: number,
): RequestToDo & Readonly<{ reference: string }> {
  const reference = `REQ-2026-${String(backtestRequestId).padStart(4, '0')}`;
  return { backtestRequestId, createdAt, urgentDeadlineAt, reference };
}

function isUrgent({ urgentDeadlineAt }: RequestToDo): boolean {
  return urgentDeadlineAt !== undefined;
}

/**
 * The order of the to-do list found another way: one sort per key, the last key first,
 * each keeping on ties the order of the sort before, then the urgent requests moved to
 * the front in that order.
 */
function rankedByPasses(requests: readonly RequestToDo[]): readonly RequestToDo[] {
  const sorted = requests
    .toSorted((one, other) => one.backtestRequestId - other.backtestRequestId)
    .toSorted((one, other) => one.createdAt - other.createdAt)
    .toSorted((one, other) => (one.urgentDeadlineAt ?? 0) - (other.urgentDeadlineAt ?? 0));
  return [
    ...sorted.filter((request) => isUrgent(request)),
    ...sorted.filter((request) => !isUrgent(request)),
  ];
}

// Requests with distinct identifiers over a few instants, so that ties abound.
const instant = fc.integer({ min: 0, max: 4 });
const requestsToDo = fc.uniqueArray(
  fc.record({
    backtestRequestId: fc.integer({ min: 1, max: 40 }),
    createdAt: instant,
    urgentDeadlineAt: fc.option(instant, { nil: undefined }),
  }),
  { selector: ({ backtestRequestId }) => backtestRequestId, maxLength: 10 },
);

/** Requests, and the same requests in any other order. */
function withReordering(
  requests: RequestToDo[],
): fc.Arbitrary<readonly [readonly RequestToDo[], readonly RequestToDo[]]> {
  const shuffled = fc.shuffledSubarray(requests, { minLength: requests.length });
  return fc.tuple(fc.constant(requests), shuffled);
}

describe('deadlineOf', () => {
  it('[BKT-16] gives the start of the next game as the deadline', () => {
    // Saturday 21 November 2026, 19:30 New York time.
    const scheduledStartAt = Date.UTC(2026, 10, 22, 0, 30);
    const game = {
      kind: 'game',
      scheduledStartAt,
      isStartTimeTbd: false,
      gameDayOn: '2026-11-21',
    } as const;

    expect(deadlineOf(game, TODAY)).toStrictEqual<Deadline>({
      kind: 'game',
      scheduledStartAt,
      isStartTimeTbd: false,
    });
  });

  it.each([
    {
      when: "on the owner's day",
      todayOn: '2026-11-22',
      gameDayOn: '2026-11-22',
      daysRemaining: 0,
    },
    { when: 'the next day', todayOn: '2026-11-21', gameDayOn: '2026-11-22', daysRemaining: 1 },
    { when: 'two days later', todayOn: TODAY, gameDayOn: '2026-11-22', daysRemaining: 2 },
    {
      when: 'across the end of a month',
      todayOn: '2026-11-30',
      gameDayOn: '2026-12-01',
      daysRemaining: 1,
    },
    {
      when: 'across the end of a year',
      todayOn: '2026-12-30',
      gameDayOn: '2027-01-02',
      daysRemaining: 3,
    },
    { when: 'across a leap day', todayOn: '2028-02-28', gameDayOn: '2028-03-01', daysRemaining: 2 },
    {
      when: "across New York's clock change",
      todayOn: '2026-10-31',
      gameDayOn: '2026-11-02',
      daysRemaining: 2,
    },
  ])(
    '[BKT-16] [CL-BKT-24] gives a game whose time is to be determined its deemed start, the mark "time TBD" and the whole days left until its date: $when',
    ({ todayOn, gameDayOn, daysRemaining }) => {
      const scheduledStartAt = winterDeemedStart(gameDayOn);
      const game = { kind: 'game', scheduledStartAt, isStartTimeTbd: true, gameDayOn } as const;

      expect(deadlineOf(game, todayOn)).toStrictEqual<Deadline>({
        kind: 'game',
        scheduledStartAt,
        isStartTimeTbd: true,
        daysRemaining,
      });
    },
  );

  it.each<NoNextGameReason>([
    'offseason',
    'team_eliminated',
    'player_without_team',
    'schedule_not_published',
  ])('[BKT-16] answers "no game scheduled" with the reason passed in: %s', (reason) => {
    expect(deadlineOf({ kind: 'no_game_scheduled', reason }, TODAY)).toStrictEqual<Deadline>({
      kind: 'no_game_scheduled',
      reason,
    });
  });
});

describe('rankTodo', () => {
  it('[BKT-17] [CL-IHM-16] ranks the requests to do of Lot 1, none urgent, from the oldest to the most recent', () => {
    const oldest = toDo(3, Date.UTC(2026, 10, 2, 9, 15));
    const middle = toDo(1, Date.UTC(2026, 10, 11, 0, 30));
    const newest = toDo(2, Date.UTC(2026, 10, 20, 18, 5));

    expect(rankTodo([middle, newest, oldest])).toStrictEqual([oldest, middle, newest]);
  });

  it('[BKT-17] [H-BKT-04] [CL-BKT-23] ranks the urgent requests first, from the nearest deadline to the farthest, then the others oldest first', () => {
    // Two manual requests, the oldest, and two born of a detection, the most recent of
    // which has the nearest deadline: 6 hours away, the other 30 hours.
    const manual = toDo(1, Date.UTC(2026, 10, 2, 9, 15));
    const later = toDo(2, Date.UTC(2026, 10, 5, 9, 15));
    const farther = toDo(3, Date.UTC(2026, 10, 19, 8), Date.UTC(2026, 10, 21, 16));
    const nearer = toDo(4, Date.UTC(2026, 10, 20, 7), Date.UTC(2026, 10, 20, 16));

    expect(rankTodo([manual, farther, later, nearer])).toStrictEqual([
      nearer,
      farther,
      manual,
      later,
    ]);
  });

  it('[H-BKT-04] [CL-BKT-23] ranks the urgent requests of one deadline from the oldest to the most recent', () => {
    const deadline = Date.UTC(2026, 10, 21, 0, 30);
    const older = toDo(9, Date.UTC(2026, 10, 18, 10), deadline);
    const newer = toDo(4, Date.UTC(2026, 10, 19, 10), deadline);

    expect(rankTodo([newer, older])).toStrictEqual([older, newer]);
  });

  it('[BKT-17] ranks the requests created at one instant by their identifiers', () => {
    // Accepting a proposal for several players at once creates their supplements in one
    // transaction, at one instant.
    const createdAt = Date.UTC(2026, 10, 12, 8, 45);
    const first = toDo(5, createdAt);
    const second = toDo(6, createdAt);
    const third = toDo(7, createdAt);

    expect(rankTodo([third, first, second])).toStrictEqual([first, second, third]);
  });

  it('[BKT-17] [H-BKT-04] [CL-BKT-23] ranks by urgency, deadline, age and then identifier', () => {
    fc.assert(
      fc.property(requestsToDo, (requests) => {
        expect(rankTodo(requests)).toStrictEqual(rankedByPasses(requests));
      }),
    );
  });

  it('[BKT-17] [H-BKT-04] ranks the same requests in one order, whatever the order they come in', () => {
    fc.assert(
      fc.property(requestsToDo.chain(withReordering), ([requests, shuffled]) => {
        expect(rankTodo(shuffled)).toStrictEqual(rankTodo(requests));
      }),
    );
  });
});
