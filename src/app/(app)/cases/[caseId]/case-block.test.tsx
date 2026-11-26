import { render, within } from '@testing-library/react';
import axe from 'axe-core';
import { eq, inArray } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  caseHistoryEntries,
  caseManualDecisions,
  caseReviewFlags,
  cases,
  caseTriggeredCriteria,
  createTestDatabase,
  events,
  eventSources,
  games,
} from '@/lib/db';
import { resetParam, setParam } from '@/lib/params';
import {
  BIRTHDAY,
  DATABASE_TEST_TIMEOUT_MS,
  insertDetectedEvent,
  playerWithEveryStatus,
  profiledPlayer,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';
import { assertNoBettingWords, definition } from '@/lib/wording';

import { CaseBlock, caseZoneStatement } from './case-block';

import type { Database, DatabaseResult } from '@/lib/db';
import type { CaseRow, PlayerWithEveryStatus } from '@/lib/testing';

const harness = vi.hoisted(() => ({ getDb: vi.fn<() => Promise<DatabaseResult>>() }));
vi.mock(import('@/lib/db'), async (importOriginal) => ({
  ...(await importOriginal()),
  getDb: harness.getDb,
}));
// What `notFound()` throws, so that a test sees the block give up on an address.
const NOT_FOUND = new Error('not found');
vi.mock(import('next/navigation'), async (importOriginal) => ({
  ...(await importOriginal()),
  notFound: vi.fn(() => {
    throw NOT_FOUND;
  }),
}));

// The day of the test, and the instants of the decisions and the history.
const AT = toEpochMs(Date.UTC(2026, 10, 20, 8, 15));
const HOUR_MS = 3_600_000;
// The reference instant of the measured case, Tuesday 14 January 2025, 09:00 Paris
// time, and the start of its game, 01:30 Paris time the next day, the 14th in the US.
const REFERENCE_AT = new Date(Date.UTC(2025, 0, 14, 8));
const TIP_OFF = new Date(Date.UTC(2025, 0, 15, 0, 30));
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };
const SOURCE_URL = 'https://news.example.com/2025/01/14/storm';
const EJECTIONS =
  'The stats source does not report ejections, so an ejection is flagged only if you notice it.';

/** `value`, which the test expects to be there. */
function present<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Expected a value.');
  }
  return value;
}

type Fact = readonly [string, string];

/**
 * The facts of `scope` in their order, each as its label, the glossary term's own when it
 * is one, and the text of its value.
 */
function factsOf(scope: HTMLElement): readonly Fact[] {
  const values = within(scope).queryAllByRole('definition');
  return within(scope)
    .queryAllByRole('term')
    .map((term, index): Fact => [
      within(term).queryByRole('button')?.textContent ?? term.textContent,
      present(values[index]).textContent,
    ]);
}

/** The facts of `scope` labeled by one of `names`, in their order. */
const factsNamed = (scope: HTMLElement, names: readonly string[]) =>
  factsOf(scope).filter(([name]) => names.includes(name));

/** The part of the block named `name`, the region of its heading. */
const partOf = (scope: HTMLElement, name: string) => within(scope).getByRole('region', { name });

/** The texts of the items of the lists of `scope`. */
const itemsOf = (scope: HTMLElement) =>
  within(scope)
    .queryAllByRole('listitem')
    .map((item) => item.textContent);

/** The block of case `caseId`, rendered as the page renders it. */
async function openCase(caseId: number): Promise<HTMLElement> {
  const { container } = render(await CaseBlock({ caseId: String(caseId) }));
  return container;
}

describe('the case block', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let world: PlayerWithEveryStatus;
  let measured: CaseRow;
  let close: () => Promise<void>;

  /** The measured case with the numbers of its calculation, its sources, flags, decisions and history. */
  async function writeMeasuredCase(): Promise<CaseRow> {
    const row = present(world.profiled.cases[0]);
    const event = present(world.profiled.events[0]);
    const measuredGameId = present(row.measuredGameId ?? undefined);
    await db
      .update(cases)
      .set({
        referenceInstantAt: REFERENCE_AT,
        referenceInstantOrigin: 'known_instant',
        measuredGameScore: 21.4,
        measuredMinutes: 32,
        hasRoundedMinutes: true,
        playingTimeThresholdMinutes: 17.5,
        performanceIndex: 0.669,
        baselineSeason: '2024-25',
        baselinePhase: 'regular_season',
        baselineGameCount: 41,
        baselineMean: 0.512,
        baselineStandardDeviation: 0.184,
        baselineStatus: 'final',
        baselineIsPartial: true,
        normalizedGap: 0.853,
        gapStatus: 'final',
      })
      .where(eq(cases.id, row.id));
    await db.update(games).set({ scheduledStartAt: TIP_OFF }).where(eq(games.id, measuredGameId));
    await db
      .update(events)
      .set({
        referenceDateOn: '2025-01-14',
        injuryReturn: 'no',
        injuryReturnOrigin: 'classification',
        gameStakes: 'normal',
        gameStakesOrigin: 'user',
      })
      .where(eq(events.id, event.id));
    await db.insert(eventSources).values([
      {
        playerEventId: event.id,
        position: 1,
        url: SOURCE_URL,
        cleanedUrl: SOURCE_URL,
        outlet: 'The Harbor Ledger',
        title: 'A storm around the guard',
        publicationDateOn: '2025-01-14',
        linkStatus: 'not_found',
      },
      {
        playerEventId: event.id,
        position: 2,
        url: `${SOURCE_URL}-2`,
        cleanedUrl: `${SOURCE_URL}-2`,
        publicationDateOn: '2025-01-13',
      },
    ]);
    await db.insert(caseReviewFlags).values([
      { caseId: row.id, flag: 'first_game_with_new_team', measuredGameId, raisedAt: new Date(AT) },
      { caseId: row.id, flag: 'manual_decision_to_review', measuredGameId, raisedAt: new Date(AT) },
    ]);
    await db.insert(caseManualDecisions).values([
      {
        caseId: row.id,
        decidedAt: new Date(AT - HOUR_MS),
        kind: 'exclude',
        exclusionReason: 'other_confounding_factor',
        comment: 'A family matter that week.',
        previousStatus: 'measured',
        measuredGameId,
      },
      {
        caseId: row.id,
        decidedAt: new Date(AT),
        kind: 'reinstate',
        reinstatementReason: 'incorrect_context_indication',
        previousStatus: 'excluded',
        measuredGameId,
      },
    ]);
    await db.insert(caseHistoryEntries).values([
      {
        caseId: row.id,
        recordedAt: new Date(AT - HOUR_MS),
        status: 'awaiting_game',
        statusReason: 'statistics_pending',
        cause: 'new_cases',
      },
      {
        caseId: row.id,
        recordedAt: new Date(AT),
        status: 'measured',
        measuredGameId,
        normalizedGap: 0.5,
        gapStatus: 'final',
        cause: 'stats_correction',
      },
    ]);
    return row;
  }

  /** The criteria of every shape, beside the flagged stakes of the excluded case (SEN-11 to SEN-15, SEN-06). */
  async function writeCriteria(): Promise<void> {
    const [second, third, fourth] = world.profiled.cases.slice(1, 4).map(({ id }) => id);
    const excluded = world.excluded.id;
    await db.insert(caseTriggeredCriteria).values([
      {
        caseId: excluded,
        criterion: 'playing_time_too_low',
        triggeringValues: { minutes: 14, threshold: 17.5 },
      },
      {
        caseId: excluded,
        criterion: 'injury_return',
        condition: 'flagged',
        triggeringValues: { injuryReturn: 'yes' },
      },
      {
        caseId: excluded,
        criterion: 'injury_return',
        condition: 'calculated',
        triggeringValues: { runLength: 5, gamesWithoutBoxScore: 1 },
      },
      {
        caseId: excluded,
        criterion: 'unusual_stakes',
        condition: 'calculated',
        triggeringValues: { phase: 'play_in' },
      },
      {
        caseId: excluded,
        criterion: 'opponent_strength',
        triggeringValues: { wins: 52, losses: 18, isPreviousSeason: false },
      },
      {
        caseId: excluded,
        criterion: 'co_occurring',
        triggeringValues: { coOccurringTypeIds: [BIRTHDAY, 'withdrawn-long-ago'] },
      },
      { caseId: excluded, criterion: 'manual', triggeringValues: {} },
      {
        caseId: present(second),
        criterion: 'unusual_stakes',
        condition: 'calculated',
        triggeringValues: { phase: 'playoffs', isEliminationGame: true },
      },
      {
        caseId: present(third),
        criterion: 'unusual_stakes',
        condition: 'calculated',
        triggeringValues: { phase: 'playoffs', isEliminationGame: null },
      },
      {
        caseId: present(third),
        criterion: 'opponent_strength',
        triggeringValues: { wins: 1, losses: 1, isPreviousSeason: true },
      },
    ]);
    await db
      .update(cases)
      .set({ opponentStrengthNotEvaluable: true, stakesNotEvaluable: true })
      .where(eq(cases.id, present(second)));
    // The world's cases have no opponent record to evaluate, which these two now have.
    await db
      .update(cases)
      .set({ opponentStrengthNotEvaluable: false })
      .where(inArray(cases.id, [excluded, present(third)]));
    await db
      .update(cases)
      .set({ referenceInstantOrigin: 'uncertain_precedence_shift' })
      .where(eq(cases.id, present(fourth)));
  }

  /** A detected event of the case shifted for an uncertain precedence, dated by its instant, now (SEN-44). */
  async function writeDetectedEvent(): Promise<void> {
    const { id, playerId, eventTypeId } = present(world.profiled.cases[3]);
    await insertDetectedEvent(db, { playerId, overrides: { caseId: id, eventTypeId } });
  }

  beforeAll(async () => {
    const database = await createTestDatabase();
    const restoreClock = installFakeClock(fixedClock(AT));
    db = database.db;
    harness.getDb.mockResolvedValue({ ok: true, db });
    world = await playerWithEveryStatus(db, await profiledPlayer(db));
    measured = await writeMeasuredCase();
    await writeCriteria();
    await writeDetectedEvent();
    await db.update(games).set({ isStartTimeTbd: true }).where(eq(games.id, world.birthday.gameId));
    close = async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);
  afterAll(async () => close());

  it('[IHM-25] [IHM-46] [CL-IHM-04] [CL-IHM-07] shows a case with its origin in full, its status, its reference instant with its origin and its measured game in full', async () => {
    const view = await openCase(measured.id);

    expect(factsOf(partOf(view, 'Case'))).toStrictEqual([
      ['Origin', 'Historical'],
      ['Status', 'Measured'],
      ['Reference instant', 'Tuesday 14 January 2025, 09:00 Paris timeKnown time'],
      [
        'Measured game',
        'Wednesday 15 January 2025, 01:30 Paris time — Tuesday evening in the USagainst Seaport Gulls',
      ],
    ]);
  });

  it('[IHM-52] [SEN-09] [STA-12] shows the gap with its status and the three numbers it is made of, with the minutes and the baseline used', async () => {
    const calculation = partOf(await openCase(measured.id), 'Gap');

    expect(factsOf(calculation)).toStrictEqual([
      ['Gap', '+0.85Final'],
      ['Index', '0.669'],
      ['Game Score', '21.4'],
      ['MIN', '32rounded minutes'],
      ['Playing-time threshold', '17.5'],
      ['Season', '2024-25'],
      ['Baseline', 'Regular season41 games'],
      ['Mean', '0.512'],
      ['SD', '0.184'],
      ['Status', 'Finalpartial'],
    ]);
    expect(
      within(within(calculation).getByRole('heading', { level: 3 })).getByRole('button'),
    ).toHaveAccessibleName('Season baseline');
  });

  it('[IHM-25] [IHM-52] [IHM-67] [SEN-18] shows each event with its sources and their links, its context indications with their origin, and the link to its sheet', async () => {
    const event = partOf(await openCase(measured.id), 'Event');
    const { id } = present(world.profiled.events[0]);

    expect(factsOf(event)).toStrictEqual([
      ['Reference date', 'Tuesday 14 January 2025'],
      [
        'Sources',
        `A storm around the guardThe Harbor LedgerPublished Tue 14 Jan 2025Not found${SOURCE_URL}-2Published Mon 13 Jan 2025`,
      ],
      ['Return from injury', 'NoClassification'],
      ['Game stakes', 'NormalYou'],
    ]);
    expect(within(event).getByRole('link', { name: 'A storm around the guard' })).toHaveAttribute(
      'href',
      SOURCE_URL,
    );
    expect(within(event).getByRole('link', { name: `${SOURCE_URL}-2` })).toHaveAttribute(
      'href',
      `${SOURCE_URL}-2`,
    );
    expect(within(event).getByRole('link', { name: 'Open the event' })).toHaveAttribute(
      'href',
      `/events/${String(id)}`,
    );
  });

  it('[IHM-25] [CL-IHM-04] dates a detected event by the instant it became public, beside an event dated to the day', async () => {
    const event = partOf(await openCase(present(world.profiled.cases[3]).id), 'Event');
    const dates = factsNamed(event, ['Reference date']);

    expect(dates).toHaveLength(2);
    expect(dates[1]).toStrictEqual(['Reference date', 'Friday 20 November 2026, 09:15 Paris time']);
  });

  it('[IHM-46] [CL-VUE-15] [STA-31] shows a tracked calendar-derived case with its derived game in place of sources, known in advance, its game to be timed', async () => {
    const view = await openCase(world.birthday.tracked.id);

    expect(factsOf(partOf(view, 'Case'))).toStrictEqual([
      ['Origin', 'Tracked'],
      ['Status', 'Awaiting game'],
      ['Reason', 'Game not played yet'],
      ['Reference instant', 'Known in advance'],
      ['Measured game', 'Monday 26 October 2026, time TBD'],
    ]);
    expect(factsNamed(partOf(view, 'Event'), ['Sources'])).toStrictEqual([
      ['Sources', 'Derived from the calendarMonday 26 October 2026'],
    ]);
    expect(
      ['Gap', 'Criteria met'].map((name) => within(view).queryByRole('region', { name })),
    ).toStrictEqual([null, null]);
  });

  it('[SEN-07] shows a case that reached no game with its reason, and no calculation, decision or history', async () => {
    const view = await openCase(world.notMeasurable.id);

    expect(factsNamed(partOf(view, 'Case'), ['Status', 'Reason', 'Measured game'])).toStrictEqual([
      ['Status', 'Not measurable'],
      ['Reason', 'Season not covered by the source'],
    ]);
    expect(
      ['Gap', 'Criteria met', 'Manual decision', 'History'].map((name) =>
        within(view).queryByRole('region', { name }),
      ),
    ).toStrictEqual([null, null, null, null]);
  });

  it('[SEN-11] [SEN-12] [SEN-13] [SEN-14] [SEN-15] [SEN-06] [SEN-18] shows each criterion met with its condition and the values that triggered it', async () => {
    const view = await openCase(world.excluded.id);

    expect(factsOf(partOf(view, 'Criteria met'))).toStrictEqual([
      ['Unusual stakes', 'FlaggedGame stakes: High'],
      ['Playing time too low', '14 minutes played, under the threshold of 17.5'],
      ['Return from injury', 'FlaggedReturn from injury: Yes'],
      [
        'Return from injury',
        'Calculated5 team games missed in a row before the game, 1 of them without a box score',
      ],
      ['Unusual stakes', 'CalculatedA play-in game'],
      ['Opponent strength', "The opponent's record this season: 52 wins, 18 losses"],
      ['Co-occurring', "Same game as a case of Player's birthday"],
      ['Excluded by you', ''],
    ]);
  });

  it('[SEN-14] [SEN-15] writes a playoff game by whether it eliminates a team, the previous season record, and the criteria not evaluable', async () => {
    const [second, third] = world.profiled.cases.slice(1, 3).map(({ id }) => id);
    const elimination = partOf(await openCase(present(second)), 'Criteria met');
    const previousSeason = partOf(await openCase(present(third)), 'Criteria met');

    expect(factsOf(elimination)).toStrictEqual([
      ['Unusual stakes', 'CalculatedA playoff game that eliminates one of the two teams'],
      ['Opponent strength', 'Not evaluable'],
      ['Unusual stakes', 'Not evaluable'],
    ]);
    expect(factsOf(previousSeason)).toStrictEqual([
      ['Unusual stakes', 'CalculatedA playoff game'],
      ['Opponent strength', "The opponent's final record last season: 1 win, 1 loss"],
    ]);
  });

  it('[SEN-16] [CL-SEN-11] [CL-SEN-12] shows the review flags, and beside them that the source reports no ejections', async () => {
    const flags = partOf(await openCase(measured.id), 'Flagged for review');

    expect(itemsOf(flags)).toStrictEqual([
      'First game with a new team',
      'Manual decision to review: the measured game changed',
    ]);
    expect(within(flags).getByText(EJECTIONS)).toBeVisible();
  });

  it('[SEN-06] [SEN-44] [CL-SEN-07] [CL-SEN-11] mentions "co-occurring" and "uncertain precedence" when they apply, and the ejections without any flag', async () => {
    const excluded = await openCase(world.excluded.id);
    const shifted = await openCase(present(world.profiled.cases[3]).id);
    const plain = partOf(await openCase(world.notMeasurable.id), 'Flagged for review');

    expect(itemsOf(partOf(excluded, 'Flagged for review'))).toStrictEqual(['co-occurring']);
    expect(itemsOf(partOf(shifted, 'Flagged for review'))).toStrictEqual(['uncertain precedence']);
    expect(factsNamed(partOf(shifted, 'Case'), ['Reference instant'])[0]?.[1]).toMatch(
      /Uncertain precedence$/u,
    );
    expect(itemsOf(plain)).toStrictEqual([]);
    expect(within(plain).getByText(EJECTIONS)).toBeVisible();
  });

  it('[SEN-17] [SEN-18] shows the manual decisions with their date, reason, comment and the status they found, and the case history with its causes', async () => {
    const view = await openCase(measured.id);

    expect(factsOf(partOf(view, 'Manual decision'))).toStrictEqual([
      [
        'Fri 20 Nov 2026, 08:15',
        'ExcludeOther confounding factorComment A family matter that week.Status before the decision: Measured',
      ],
      [
        'Fri 20 Nov 2026, 09:15',
        'ReinstateIncorrect context indicationStatus before the decision: Excluded (doubtful case)',
      ],
    ]);
    expect(factsOf(partOf(view, 'History'))).toStrictEqual([
      ['Fri 20 Nov 2026, 08:15', 'Awaiting gameStatistics pendingCause New cases'],
      ['Fri 20 Nov 2026, 09:15', 'Measured+0.50 FinalCause Statistics correction'],
    ]);
  });

  it('[IHM-15] renders the label of each defined term as the glossary term that opens its definition', async () => {
    const view = await openCase(measured.id);

    expect(within(view).getByRole('button', { name: 'Gap' })).toHaveAttribute(
      'popovertarget',
      within(view).getByText(definition('normalizedGap').text).id,
    );
    expect(
      within(view)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toStrictEqual([
      'Reference instant',
      'Measured game',
      'Event',
      'Gap',
      'Index',
      'Playing-time threshold',
      'Season baseline',
      'Status',
    ]);
  });

  it('[IHM-50] [IHM-61] passes the WCAG 2.2 AA rules and shows no betting word', async () => {
    const view = await openCase(world.excluded.id);
    // Each text as the screen shows it apart, where the text content of the whole block
    // would glue the end of one to the start of the next.
    const texts: string[] = [];
    within(view).queryAllByText((text) => {
      texts.push(text);
      return false;
    });

    await expect(axe.run(view, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
    expect(texts).toContain('Game stakes: High');
    expect(() => {
      assertNoBettingWords(texts.join(' / '));
    }).not.toThrow();
  });

  it.each(['0', '999999', 'abc', '12x', '2147483648'])(
    '[CL-IHM-19] gives up on the address of case %s, which names no case, so that the screen says the item no longer exists',
    async (caseId) => {
      await expect(CaseBlock({ caseId })).rejects.toBe(NOT_FOUND);
      expect(notFound).toHaveBeenCalled();
    },
  );

  it('[CL-IHM-04] [IHM-14] states the zone of its times, and follows the zone the owner set', async () => {
    await expect(caseZoneStatement()).resolves.toBe('Times in Paris time');
    await expect(
      db.transaction(async (tx) =>
        setParam(tx, { key: 'display.timeZone', value: 'America/New_York', expectedVersion: 0 }),
      ),
    ).resolves.toMatchObject({ ok: true });

    await expect(caseZoneStatement()).resolves.toBe('Times in New York time');
    const view = await openCase(measured.id);

    expect(factsNamed(partOf(view, 'Case'), ['Measured game'])).toStrictEqual([
      ['Measured game', 'Tuesday 14 January 2025, 19:30 New York timeagainst Seaport Gulls'],
    ]);
    await expect(
      db.transaction(async (tx) => resetParam(tx, { key: 'display.timeZone', expectedVersion: 1 })),
    ).resolves.toMatchObject({ ok: true });
  });

  it('refuses to show a case without a database, a deployment fault that the error screen shows', async () => {
    harness.getDb.mockResolvedValueOnce({ ok: false, error: { kind: 'database-not-configured' } });

    await expect(CaseBlock({ caseId: String(measured.id) })).rejects.toThrow(
      'The case detail cannot reach the database: database-not-configured.',
    );
  });
});
