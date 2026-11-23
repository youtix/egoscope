import { followedPlayers, statsSourceMappings } from '@/lib/db';
import { now } from '@/lib/time';
import league from '@data/fixtures/stats-source/world/scenario.json';

import { firstRow } from '../rows';

import type { Database } from '@/lib/db';

/** A followed player as the database holds him. */
export type PlayerRow = typeof followedPlayers.$inferSelect;

// The followed player's identifier of each invented player: fixed, so that the
// research results of data/fixtures/testing/ name the player that a scenario writes.
const PLAYER_IDS = {
  p01: '0f6c2a4e-8b1d-4c3f-9a7e-5d2b1c0e9f01',
  p02: '0f6c2a4e-8b1d-4c3f-9a7e-5d2b1c0e9f02',
  p03: '0f6c2a4e-8b1d-4c3f-9a7e-5d2b1c0e9f03',
  p04: '0f6c2a4e-8b1d-4c3f-9a7e-5d2b1c0e9f04',
  p05: '0f6c2a4e-8b1d-4c3f-9a7e-5d2b1c0e9f05',
  p06: '0f6c2a4e-8b1d-4c3f-9a7e-5d2b1c0e9f06',
  p07: '0f6c2a4e-8b1d-4c3f-9a7e-5d2b1c0e9f07',
  p08: '0f6c2a4e-8b1d-4c3f-9a7e-5d2b1c0e9f08',
  p09: '0f6c2a4e-8b1d-4c3f-9a7e-5d2b1c0e9f09',
  p10: '0f6c2a4e-8b1d-4c3f-9a7e-5d2b1c0e9f10',
} as const;

/** An invented player of the league of the statistics-source fake, by his source identifier. */
export type LeaguePlayer = keyof typeof PLAYER_IDS;

/** The followed player's identifier that `insertPlayer` gives the invented player `source`. */
export function leaguePlayerId(source: LeaguePlayer): string {
  return PLAYER_IDS[source];
}

/** What `insertPlayer` takes: the invented player to follow, and the columns to write otherwise. */
export type PlayerFactoryOptions = Readonly<{
  source?: LeaguePlayer;
  overrides?: Partial<typeof followedPlayers.$inferInsert>;
}>;

/**
 * Writes a followed player (JOU-10): an invented player of the league, the
 * first by default, under his fixed identifier, with his name and his birthday as the
 * source gives them and his mapping to the source established, so that the fake of
 * the statistics source and the database agree. `overrides` replaces any column.
 */
export async function insertPlayer(
  db: Database,
  { source = 'p01', overrides = {} }: PlayerFactoryOptions = {},
): Promise<PlayerRow> {
  const player = firstRow(
    league.players.filter((candidate) => candidate.id === source),
    `the invented player ${source}`,
  );
  const { birthday } = player;
  const addedAt = new Date(now());
  const rows = await db
    .insert(followedPlayers)
    .values({
      id: leaguePlayerId(source),
      displayName: player.name,
      displayNameNormalized: player.name.toLowerCase(),
      birthdayMonth: birthday?.month ?? null,
      birthdayDay: birthday?.day ?? null,
      birthdayOrigin: birthday === null ? null : 'stats_source',
      addedAt,
      ...overrides,
    })
    .returning();
  const row = firstRow(rows, 'the followed player written');
  await db.insert(statsSourceMappings).values({
    playerId: row.id,
    statsSource: 'sportsdataverse_espn',
    status: 'established',
    sourcePlayerRef: source,
    establishedAt: addedAt,
  });
  return row;
}
