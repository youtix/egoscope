import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase } from '@/lib/db';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertEventType,
  insertHistoricalEvent,
  insertImport,
  insertPlayer,
  insertRequest,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs, toIsoDate } from '@/lib/time';

import { getEvent, uncheckedSources } from './queries';
import { addSources, recordLinkCheck, recordSpotCheck } from './sources';

import type { PlayerEventSource } from './queries';
import type { NewSource } from './sources';
import type { Database } from '@/lib/db';
import type { FixedClock } from '@/lib/time';

const START = toEpochMs(Date.UTC(2026, 10, 25, 9, 0));
const MINUTE = 60_000;
const GONE = { ok: false, error: { kind: 'source_gone' } };
const DONE = { ok: true, value: undefined };
// A source of no event: the identity never gives it in these tests.
const NO_SOURCE = 999_999;

/** An untimed source published on `on`, its link and title telling it apart. */
function source(on: string, name: string): NewSource {
  return {
    url: `https://news.example.test/${name}`,
    cleanedUrl: `https://news.example.test/${name}`,
    outlet: 'Example News',
    title: `Article ${name}`,
    publicationDate: { on: toIsoDate(on), at: null },
  };
}

describe('the sources of an event', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let close: () => Promise<void>;
  let clock: FixedClock;
  let restoreClock: () => void;
  let playerId: string;
  let importId: number;

  beforeAll(async () => {
    const database = await createTestDatabase();
    ({ db, close } = database);
    clock = fixedClock(START);
    restoreClock = installFakeClock(clock);
    ({ id: playerId } = await insertPlayer(db));
    await insertEventType(db);
    const request = await insertRequest(db, { playerId });
    ({ id: importId } = await insertImport(db, { request }));
  }, DATABASE_TEST_TIMEOUT_MS);

  afterAll(async () => {
    restoreClock();
    await close();
  });

  /** A historical event of the player, with no source yet. */
  async function anEvent(): Promise<number> {
    const { id } = await insertHistoricalEvent(db, { playerId, originImportId: importId });
    return id;
  }

  async function add(playerEventId: number, sources: readonly NewSource[]) {
    return db.transaction(async (tx) => addSources(tx, { playerEventId, importId, sources }));
  }

  async function sourcesOf(playerEventId: number): Promise<readonly PlayerEventSource[]> {
    const playerEvent = await getEvent(db, playerEventId);
    return playerEvent?.origin === 'historical' ? playerEvent.sources : [];
  }

  it('[DSN-08] keeps each link and title exactly as given, with its outlet and publication date', async () => {
    const playerEventId = await anEvent();
    const asPublished: NewSource = {
      url: ' https://News.example.test/2024/11/20/Forward%20Under-Fire?utm_source=feed&id=7#top ',
      cleanedUrl: 'https://news.example.test/2024/11/20/forward%20under-fire?id=7',
      outlet: 'Example News',
      title: '  «Forward» under FIRE — l’équipe   doubts him ',
      publicationDate: {
        on: toIsoDate('2024-11-19'),
        at: toEpochMs(Date.UTC(2024, 10, 20, 3, 45)),
        offsetMinutes: -480,
      },
    };
    const ids = await add(playerEventId, [
      // @ts-expect-error -- a source has no field for an excerpt of the article.
      { ...asPublished, excerpt: 'The first paragraph of the article.' },
    ]);

    expect(await sourcesOf(playerEventId)).toStrictEqual([
      {
        sourceId: ids[0],
        position: 1,
        ...asPublished,
        addedByImportId: importId,
        addedAt: START,
        linkStatus: null,
        linkCheckedAt: null,
        spotCheckVerdict: null,
      },
    ]);
  });

  it('[DSN-08] [CL-IMP-16] numbers the sources by date, timed ones first by instant, full ties in their order', async () => {
    const playerEventId = await anEvent();
    const [first] = await add(playerEventId, [source('2024-11-20', 'kept-first')]);
    const timed: NewSource = {
      ...source('2024-11-20', 'timed'),
      publicationDate: {
        on: toIsoDate('2024-11-20'),
        at: toEpochMs(Date.UTC(2024, 10, 20, 15, 0)),
        offsetMinutes: 0,
      },
    };
    const added = await add(playerEventId, [
      source('2024-11-21', 'later'),
      timed,
      source('2024-11-19', 'older'),
      source('2024-11-20', 'tied'),
    ]);
    const [later, timedId, older, tied] = added;
    const ordered = await sourcesOf(playerEventId);

    expect(added).toHaveLength(4);
    expect(ordered.map(({ sourceId, position }) => [position, sourceId])).toStrictEqual([
      [1, older],
      [2, timedId],
      [3, first],
      [4, tied],
      [5, later],
    ]);
  });

  it('[DSN-08] records the instant of a link check, and not_found only for a page found missing', async () => {
    // Every source of the earlier tests is checked first.
    const earlier = await uncheckedSources(db, NO_SOURCE);
    await Promise.all(earlier.map(async ({ sourceId }) => recordLinkCheck(db, sourceId, null)));
    const playerEventId = await anEvent();
    const [missing, answered, unchecked] = await add(playerEventId, [
      source('2024-11-20', 'missing'),
      source('2024-11-20', 'answered'),
      source('2024-11-20', 'unchecked'),
    ]);
    const before = await uncheckedSources(db, 2);
    clock.advance(MINUTE);
    const results = [
      await recordLinkCheck(db, missing ?? 0, 'not_found'),
      await recordLinkCheck(db, answered ?? 0, null),
    ];
    const after = await uncheckedSources(db, 10);
    const checked = await sourcesOf(playerEventId);

    expect(before).toStrictEqual([
      { sourceId: missing, url: 'https://news.example.test/missing' },
      { sourceId: answered, url: 'https://news.example.test/answered' },
    ]);
    expect(results).toStrictEqual([DONE, DONE]);
    expect(after).toStrictEqual([
      { sourceId: unchecked, url: 'https://news.example.test/unchecked' },
    ]);
    expect(
      checked.map(({ linkStatus, linkCheckedAt }) => ({ linkStatus, linkCheckedAt })),
    ).toStrictEqual([
      { linkStatus: 'not_found', linkCheckedAt: START + MINUTE },
      { linkStatus: null, linkCheckedAt: START + MINUTE },
      { linkStatus: null, linkCheckedAt: null },
    ]);
  });

  it('[DSN-08] records the spot-check verdict of a source', async () => {
    const playerEventId = await anEvent();
    const [checked, other] = await add(playerEventId, [
      source('2024-11-20', 'checked'),
      source('2024-11-21', 'other'),
    ]);
    const result = await recordSpotCheck(db, checked ?? 0, 'inconsistent');
    const verdicts = await sourcesOf(playerEventId);

    expect(result).toStrictEqual(DONE);
    expect(
      verdicts.map(({ sourceId, spotCheckVerdict }) => [sourceId, spotCheckVerdict]),
    ).toStrictEqual([
      [checked, 'inconsistent'],
      [other, null],
    ]);
  });

  it('[DSN-08] records no check on a source that is gone', async () => {
    expect(await recordLinkCheck(db, NO_SOURCE, 'not_found')).toStrictEqual(GONE);
    expect(await recordSpotCheck(db, NO_SOURCE, 'consistent')).toStrictEqual(GONE);
  });
});
