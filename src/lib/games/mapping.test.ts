import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  boxScores,
  createTestDatabase,
  followedPlayers,
  mappingCandidates,
  statsSourceMappings,
  teamSourceRefs,
} from '@/lib/db';
import { createFakeStatsSource } from '@/lib/stats-source';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertBoxScores,
  insertLeagueSeason,
  insertPlayer,
  leaguePlayerId,
} from '@/lib/testing';
import { fixedClock, installFakeClock, now, toEpochMs } from '@/lib/time';

import { storeDirectory } from './directory';
import {
  changeMapping,
  confirmMapping,
  establishedMappings,
  markMappingToEstablish,
  pendingMappings,
  refreshPendingCandidates,
} from './mapping';

import type { Database } from '@/lib/db';
import type { FakeStatsSource } from '@/lib/stats-source';

const START = toEpochMs(Date.UTC(2026, 10, 10, 12));
const CALL_WINDOW_MS = 60_000;
const UNKNOWN_PLAYER = '00000000-0000-4000-8000-000000000000';
const NAMESAKES = ['p02', 'p03'];

const refsOf = (candidates: readonly { sourcePlayerRef: string }[]) =>
  candidates.map((candidate) => candidate.sourcePlayerRef);

describe('the statistics-source mapping', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let source: FakeStatsSource;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(START));
    source = createFakeStatsSource();
    await insertLeagueSeason(db, '2025-26');
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  /** The directory read of a statistics update: the fake's answer stored, or nothing when it does not answer. */
  async function isDirectoryUpdated(isKept?: (ref: string) => boolean): Promise<boolean> {
    const ctx = {
      deadline: toEpochMs(now() + CALL_WINDOW_MS),
      signal: new AbortController().signal,
    };
    const outcome = await source.getSeasonPlayers(ctx, { season: '2025-26', knownVersion: null });
    if (!outcome.ok || outcome.value.kind !== 'read') {
      return false;
    }
    const data = outcome.value.data.filter((entry) => isKept?.(entry.player) ?? true);
    const stored = await db.transaction(async (tx) =>
      storeDirectory(tx, { season: '2025-26', entries: data }),
    );
    return stored.ok;
  }

  /** Follows the invented player `ref` with no mapping yet, as `players.add` leaves him. */
  async function follow(ref: 'p02' | 'p03') {
    const player = await insertPlayer(db, { source: ref });
    await db.delete(statsSourceMappings).where(eq(statsSourceMappings.playerId, player.id));
    return player.id;
  }

  const mark = async (playerId: string) =>
    db.transaction(async (tx) => markMappingToEstablish(tx, { playerId }));
  const confirm = async (playerId: string, sourcePlayerRef: string) =>
    db.transaction(async (tx) => confirmMapping(tx, { playerId, sourcePlayerRef }));
  const change = async (playerId: string) =>
    db.transaction(async (tx) => changeMapping(tx, { playerId }));
  const refresh = async () => db.transaction(async (tx) => refreshPendingCandidates(tx));

  /** The player's mapping, its status and what it holds, or undefined when he has none. */
  async function mappingOf(playerId: string) {
    const [mapping] = await db
      .select({
        id: statsSourceMappings.id,
        status: statsSourceMappings.status,
        sourcePlayerRef: statsSourceMappings.sourcePlayerRef,
        establishedAt: statsSourceMappings.establishedAt,
        lastSearchedAt: statsSourceMappings.lastSearchedAt,
      })
      .from(statsSourceMappings)
      .where(eq(statsSourceMappings.playerId, playerId));
    return mapping;
  }

  /** The candidates of each mapping to establish, as the to-do list shows them. */
  async function pendingRefs() {
    const pending = await pendingMappings(db);
    return pending.map((mapping) => refsOf(mapping.candidates));
  }

  it('[STA-03] [JOU-10] [CA-STA-15] asks to choose between two namesakes and fetches nothing for him before the choice', async () => {
    await isDirectoryUpdated();
    const playerId = await follow('p02');
    const marked = await mark(playerId);
    expect(marked.ok && refsOf(marked.value.candidates)).toStrictEqual(NAMESAKES);
    const gate = await establishedMappings(db);
    expect({
      mapping: await mappingOf(playerId),
      gated: gate.has(playerId),
      pending: await pendingRefs(),
    }).toStrictEqual({
      mapping: {
        id: marked.ok ? marked.value.mappingId : 0,
        status: 'to_establish',
        sourcePlayerRef: null,
        establishedAt: null,
        lastSearchedAt: new Date(START),
      },
      gated: false,
      pending: [NAMESAKES],
    });

    expect(await confirm(playerId, 'p02')).toStrictEqual({
      ok: true,
      value: { formerLinesDeleted: 0 },
    });
    const opened = await establishedMappings(db);
    expect({
      mapping: await mappingOf(playerId),
      gate: opened.get(playerId),
      candidates: await db.select().from(mappingCandidates),
      pending: await pendingMappings(db),
      refreshed: await refresh(),
    }).toStrictEqual({
      mapping: {
        id: marked.ok ? marked.value.mappingId : 0,
        status: 'established',
        sourcePlayerRef: 'p02',
        establishedAt: new Date(START),
        lastSearchedAt: new Date(START),
      },
      gate: 'p02',
      candidates: [],
      pending: [],
      refreshed: [],
    });
  });

  it('[CA-JOU-07] [CA-STA-15] records a player added while the source is unavailable as "mapping to establish", fetches nothing for him, and searches again at the next update', async () => {
    source.inject({ kind: 'outage', times: 1 });
    expect(await isDirectoryUpdated()).toBe(false);
    const playerId = await follow('p03');
    const marked = await mark(playerId);
    const mapping = await mappingOf(playerId);
    const gate = await establishedMappings(db);
    expect({
      marked,
      status: mapping?.status,
      gate: gate.size,
      refreshed: await refresh(),
    }).toStrictEqual({
      marked: { ok: true, value: { mappingId: mapping?.id, candidates: [] } },
      status: 'to_establish',
      gate: 0,
      refreshed: [],
    });

    expect(await isDirectoryUpdated()).toBe(true);
    const refreshed = await refresh();
    expect(
      refreshed.map((gained) => [gained.mappingId, gained.playerId, refsOf(gained.candidates)]),
    ).toStrictEqual([[mapping?.id, playerId, NAMESAKES]]);
    const after = await establishedMappings(db);
    expect({
      again: await refresh(),
      pending: await pendingRefs(),
      gated: after.has(playerId),
    }).toStrictEqual({
      again: [],
      pending: [NAMESAKES],
      gated: false,
    });
  });

  it('[JOU-10] refuses at any moment an identity linked to another followed player, whatever his state, naming him (CL-JOU-04)', async () => {
    await isDirectoryUpdated();
    const owner = await insertPlayer(db, { source: 'p03' });
    await db
      .update(followedPlayers)
      .set({ status: 'withdrawn' })
      .where(eq(followedPlayers.id, owner.id));
    const playerId = await follow('p02');
    const marked = await mark(playerId);
    expect(
      marked.ok && marked.value.candidates.map((candidate) => candidate.followedAs),
    ).toStrictEqual([null, { playerId: leaguePlayerId('p03'), displayName: 'Dario Castell' }]);
    const refused = {
      ok: false,
      error: { kind: 'already_followed', playerId: owner.id, displayName: 'Dario Castell' },
    };
    const atAddition = await confirm(playerId, 'p03');
    const mapping = await mappingOf(playerId);
    expect({ atAddition, status: mapping?.status }).toStrictEqual({
      atAddition: refused,
      status: 'to_establish',
    });

    await confirm(playerId, 'p02');
    await change(playerId);
    expect(await confirm(playerId, 'p03')).toStrictEqual(refused);
    expect(await confirm(owner.id, 'p03')).toStrictEqual({
      ok: true,
      value: { formerLinesDeleted: 0 },
    });
  });

  it('[JOU-10] refuses an unknown player, an identity the directory does not hold, and a step the mapping cannot take', async () => {
    await isDirectoryUpdated();
    const playerId = await follow('p02');
    const notFound = { ok: false, error: { kind: 'player_not_found' } };
    expect({
      confirmed: await confirm(UNKNOWN_PLAYER, 'p02'),
      marked: await mark(UNKNOWN_PLAYER),
      changed: await change(playerId),
      unknown: await confirm(playerId, 'p99'),
      mapping: await mappingOf(playerId),
    }).toStrictEqual({
      confirmed: notFound,
      marked: notFound,
      changed: { ok: false, error: { kind: 'mapping_not_found' } },
      unknown: { ok: false, error: { kind: 'unknown_identity' } },
      mapping: undefined,
    });
    await confirm(playerId, 'p02');
    expect(await mark(playerId)).toStrictEqual({
      ok: false,
      error: { kind: 'mapping_established' },
    });
  });

  it("[STA-03] [JOU-10] reopens the search at a change, fetches nothing meanwhile, and deletes the former identity's lines once another is confirmed (CL-JOU-11)", async () => {
    await isDirectoryUpdated();
    const player = await insertPlayer(db, { source: 'p02' });
    const lines = await insertBoxScores(db, {
      playerId: player.id,
      source: 'p02',
      season: '2025-26',
    });
    expect(lines).toBeGreaterThan(0);

    const changed = await change(player.id);
    expect(changed.ok && refsOf(changed.value.candidates)).toStrictEqual(NAMESAKES);
    const mapping = await mappingOf(player.id);
    const gate = await establishedMappings(db);
    const kept = await db.select().from(boxScores);
    expect({
      mapping: mapping && [mapping.status, mapping.sourcePlayerRef, mapping.establishedAt],
      gated: gate.has(player.id),
      kept: kept.length,
    }).toStrictEqual({
      mapping: ['to_establish', null, null],
      gated: false,
      kept: lines,
    });

    expect(await confirm(player.id, 'p03')).toStrictEqual({
      ok: true,
      value: { formerLinesDeleted: lines },
    });
    const opened = await establishedMappings(db);
    expect({ lines: await db.select().from(boxScores), gate: opened.get(player.id) }).toStrictEqual(
      {
        lines: [],
        gate: 'p03',
      },
    );
  });

  it('[JOU-10] carries the preselection of a replacement source over while its candidate is found again (CL-TRV-14)', async () => {
    await isDirectoryUpdated();
    const playerId = await follow('p02');
    await mark(playerId);
    const mapping = await mappingOf(playerId);
    // A replacement source's crosswalk preselects one candidate (mapPlayers).
    await db
      .update(mappingCandidates)
      .set({ isPreselected: true })
      .where(
        and(
          eq(mappingCandidates.mappingId, mapping?.id ?? 0),
          eq(mappingCandidates.sourcePlayerRef, 'p03'),
        ),
      );
    expect(await refresh()).toStrictEqual([]);
    const [pending] = await pendingMappings(db);
    const marks = pending?.candidates.map((candidate) => [
      candidate.sourcePlayerRef,
      candidate.isPreselected,
    ]);
    const refs = await db.select().from(teamSourceRefs);
    const team = (ref: string) => refs.find((row) => row.sourceTeamRef === ref)?.teamId;
    expect(pending?.candidates[0]).toStrictEqual({
      sourcePlayerRef: 'p02',
      displayName: 'Dario Castell',
      currentTeamId: team('3'),
      teamIds: [team('3'), team('2')],
      firstSeason: '2025-26',
      lastSeason: '2025-26',
      isPreselected: false,
      followedAs: null,
    });
    expect({ ...pending, candidates: marks }).toStrictEqual({
      mappingId: mapping?.id,
      playerId,
      displayName: 'Dario Castell',
      lastSearchedAt: START,
      candidates: [
        ['p02', false],
        ['p03', true],
      ],
    });

    await isDirectoryUpdated((ref) => ref !== 'p03');
    await refresh();
    const [after] = await pendingMappings(db);
    expect(
      after?.candidates.map((candidate) => [candidate.sourcePlayerRef, candidate.isPreselected]),
    ).toStrictEqual([['p02', false]]);
  });

  it('[JOU-10] lists a mapping to establish that no search has run for yet, without candidates', async () => {
    const playerId = await follow('p03');
    await db.insert(statsSourceMappings).values({ playerId, statsSource: 'sportsdataverse_espn' });
    const mapping = await mappingOf(playerId);
    expect(await pendingMappings(db)).toStrictEqual([
      {
        mappingId: mapping?.id,
        playerId,
        displayName: 'Dario Castell',
        lastSearchedAt: null,
        candidates: [],
      },
    ]);
  });
});
