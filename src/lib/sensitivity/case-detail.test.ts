import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  caseHistoryEntries,
  caseManualDecisions,
  caseReviewFlags,
  createTestDatabase,
  eventSources,
} from '@/lib/db';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertHistoricalEvent,
  playerWithEveryStatus,
  profiledPlayer,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { getCase } from './case-detail';

import type { Database } from '@/lib/db';
import type { PlayerWithEveryStatus } from '@/lib/testing';

const AT = toEpochMs(Date.UTC(2026, 10, 20, 8, 15));
const HOUR_MS = 3_600_000;
const SOURCE_URL = 'https://news.example.com/2024/11/11/storm';
const ANY_ID: unknown = expect.any(Number);
const ANY_DAY: unknown = expect.any(String);

/** `value`, which the test expects to be there. */
function present<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Expected a value.');
  }
  return value;
}

/** The one source of an event, a report under `path`. */
function sourceOf(playerEventId: number, path: string) {
  return {
    playerEventId,
    position: 1,
    url: `https://news.example.com/${path}`,
    cleanedUrl: `https://news.example.com/${path}`,
    publicationDateOn: '2024-10-23',
  };
}

describe('the detail of a case', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let world: PlayerWithEveryStatus;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const database = await createTestDatabase();
    const restoreClock = installFakeClock(fixedClock(AT));
    db = database.db;
    world = await playerWithEveryStatus(db, await profiledPlayer(db));
    close = async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);
  afterAll(async () => close());

  it('[SEN-11] [SEN-12] [SEN-18] [IHM-25] gives an excluded case its criterion with its values, its event with its context indications and their origin, and its calculation', async () => {
    const { excluded } = world;
    const detail = await getCase(db, excluded.id);

    expect(detail).toMatchObject({
      id: excluded.id,
      status: 'excluded',
      criteria: [
        {
          criterion: 'unusual_stakes',
          condition: 'flagged',
          triggeringValues: { gameStakes: 'high' },
        },
      ],
      measuredGameScore: excluded.measuredGameScore,
      hasRoundedMinutes: true,
      playingTimeThresholdMinutes: excluded.playingTimeThresholdMinutes,
      teamGamesMissedBefore: excluded.teamGamesMissedBefore,
      opponentStrengthNotEvaluable: true,
      stakesNotEvaluable: false,
      minutes: excluded.measuredMinutes,
      performanceIndex: excluded.performanceIndex,
      normalizedGap: excluded.normalizedGap,
      reviewFlags: [],
      decisions: [],
      history: [],
    });
    expect(detail?.events).toStrictEqual([
      {
        id: ANY_ID,
        origin: 'historical',
        referenceDateOn: ANY_DAY,
        referenceAt: null,
        description: 'Every outlet covered the player on the same day.',
        sources: [],
        derivedGame: null,
        injuryReturn: 'unknown',
        injuryReturnOrigin: null,
        gameStakes: 'high',
        gameStakesOrigin: 'research',
      },
    ]);
  });

  it('[SEN-02] [IHM-25] gives a calendar-derived case its derived game', async () => {
    const { birthday } = world;

    await expect(getCase(db, birthday.tracked.id)).resolves.toMatchObject({
      origin: 'tracked',
      events: [
        {
          id: birthday.event.id,
          origin: 'calendar',
          sources: [],
          derivedGame: { id: birthday.gameId, gameDay: '2026-10-26' },
        },
      ],
    });
  });

  it('[SEN-16] [SEN-17] [IHM-25] [CL-VUE-15] gives a case its sources with their links, its review flags, its manual decisions and its history, oldest first', async () => {
    const [measured] = world.profiled.cases;
    const [event] = world.profiled.events;
    const { id: caseId, measuredGameId: gameId } = present(measured);
    const measuredGameId = present(gameId ?? undefined);
    const playerEventId = present(event).id;
    await db.insert(eventSources).values([
      {
        playerEventId,
        position: 2,
        url: `${SOURCE_URL}?ref=feed`,
        cleanedUrl: `${SOURCE_URL}-2`,
        publicationDateOn: '2024-10-22',
        linkStatus: 'not_found',
      },
      {
        playerEventId,
        position: 1,
        url: SOURCE_URL,
        cleanedUrl: SOURCE_URL,
        outlet: 'The Daily Example',
        title: 'A storm around the guard',
        publicationDateOn: '2024-10-21',
      },
    ]);
    await db.insert(caseReviewFlags).values([
      {
        caseId,
        flag: 'ejection',
        measuredGameId,
        raisedAt: new Date(AT),
        acknowledgedAt: new Date(AT),
      },
      {
        caseId,
        flag: 'manual_decision_to_review',
        measuredGameId,
        raisedAt: new Date(AT - HOUR_MS),
      },
    ]);
    await db.insert(caseManualDecisions).values({
      caseId,
      decidedAt: new Date(AT - HOUR_MS),
      kind: 'exclude',
      exclusionReason: 'other_confounding_factor',
      comment: 'A family matter that week.',
      previousStatus: 'measured',
      measuredGameId,
    });
    await db.insert(caseHistoryEntries).values({
      caseId,
      recordedAt: new Date(AT - HOUR_MS),
      status: 'measured',
      measuredGameId,
      normalizedGap: 0.5,
      gapStatus: 'final',
      cause: 'stats_correction',
    });

    const detail = await getCase(db, caseId);

    expect(detail?.events[0]?.sources).toStrictEqual([
      {
        url: SOURCE_URL,
        outlet: 'The Daily Example',
        title: 'A storm around the guard',
        publicationDateOn: '2024-10-21',
        linkStatus: null,
      },
      {
        url: `${SOURCE_URL}?ref=feed`,
        outlet: null,
        title: null,
        publicationDateOn: '2024-10-22',
        linkStatus: 'not_found',
      },
    ]);
    expect(detail?.reviewFlags).toStrictEqual([
      {
        flag: 'manual_decision_to_review',
        measuredGameId,
        raisedAt: AT - HOUR_MS,
        acknowledgedAt: null,
      },
      { flag: 'ejection', measuredGameId, raisedAt: AT, acknowledgedAt: AT },
    ]);
    expect(detail?.decisions).toStrictEqual([
      {
        decidedAt: AT - HOUR_MS,
        kind: 'exclude',
        exclusionReason: 'other_confounding_factor',
        reinstatementReason: null,
        comment: 'A family matter that week.',
        previousStatus: 'measured',
        measuredGameId,
      },
    ]);
    expect(detail?.history).toStrictEqual([
      {
        recordedAt: AT - HOUR_MS,
        status: 'measured',
        statusReason: null,
        measuredGameId,
        normalizedGap: 0.5,
        gapStatus: 'final',
        cause: 'stats_correction',
      },
    ]);
  });

  it('[SEN-05] [IHM-25] gives each event of a case that groups two its own sources', async () => {
    const { profiled } = world;
    const caseId = present(profiled.cases[1]).id;
    const first = present(profiled.events.find((event) => event.caseId === caseId));
    const second = await insertHistoricalEvent(db, {
      playerId: profiled.player.id,
      originImportId: profiled.imported.id,
      overrides: { referenceDateOn: first.referenceDateOn, caseId },
    });
    await db
      .insert(eventSources)
      .values([sourceOf(second.id, 'second-report'), sourceOf(first.id, 'first-report')]);

    const detail = await getCase(db, caseId);

    expect(
      detail?.events.map(({ id, sources }) => ({ id, urls: sources.map(({ url }) => url) })),
    ).toStrictEqual([
      { id: first.id, urls: ['https://news.example.com/first-report'] },
      { id: second.id, urls: ['https://news.example.com/second-report'] },
    ]);
  });

  it('[IHM-25] answers null for a case that does not exist', async () => {
    await expect(getCase(db, 0)).resolves.toBeNull();
  });
});
