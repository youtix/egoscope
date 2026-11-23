import { eq } from 'drizzle-orm';

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

/** The birthday columns of a player whose birthday the source gives, or does not. */
function birthdayColumns(birthday: Readonly<{ month: number; day: number }> | null) {
  return birthday === null
    ? { birthdayMonth: null, birthdayDay: null, birthdayOrigin: null }
    : {
        birthdayMonth: birthday.month,
        birthdayDay: birthday.day,
        birthdayOrigin: 'stats_source' as const,
      };
}

/** A name as CL-JOU-13 compares it: NFC, trimmed, its inner spaces collapsed, case folded. */
function normalizedName(name: string): string {
  return name.normalize('NFC').trim().replaceAll(/\s+/gu, ' ').toLowerCase();
}

/**
 * Writes a followed player (JOU-10): an invented player of the league, the
 * first by default, under his fixed identifier, with his name and his birthday as the
 * source gives them, the name normalized as CL-JOU-13 says, and his mapping to the
 * source established, so that the fake of the statistics source and the database agree.
 * `overrides` replaces any column; a `displayName` alone also gives the normalized name.
 * A player already followed under that identifier is left as he is, overrides ignored,
 * so that scenarios combine: gives him as the database holds him.
 */
export async function insertPlayer(
  db: Database,
  { source = 'p01', overrides = {} }: PlayerFactoryOptions = {},
): Promise<PlayerRow> {
  const player = firstRow(
    league.players.filter((candidate) => candidate.id === source),
    `the invented player ${source}`,
  );
  const addedAt = new Date(now());
  const id = overrides.id ?? leaguePlayerId(source);
  const displayName = overrides.displayName ?? player.name;
  await db
    .insert(followedPlayers)
    .values({
      id,
      displayName,
      displayNameNormalized: normalizedName(displayName),
      ...birthdayColumns(player.birthday),
      addedAt,
      ...overrides,
    })
    .onConflictDoNothing({ target: followedPlayers.id });
  await db
    .insert(statsSourceMappings)
    .values({
      playerId: id,
      statsSource: 'sportsdataverse_espn',
      status: 'established',
      sourcePlayerRef: source,
      establishedAt: addedAt,
    })
    .onConflictDoNothing();
  return firstRow(
    await db.select().from(followedPlayers).where(eq(followedPlayers.id, id)),
    'the followed player written',
  );
}
