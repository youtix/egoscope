// The team directory that comes with each season's games (JOU-08, STA-26, CL-JOU-18,
// CL-STA-23): one application team per franchise identifier of the source, under the
// names of the latest season stored, and each season's names in `team_seasons`.
import { and, eq, inArray, sql } from 'drizzle-orm';

import { teams, teamSeasons, teamSourceRefs } from '@/lib/db';

import type { SeasonRow } from './types';
import type { Transaction } from '@/lib/db';
import type { TeamId } from '@/lib/stats-engine';
import type { Season, SourceTeam, SourceTeamId } from '@/lib/stats-source';

/** The key of a statistics source, as the data model stores it (CL-STA-23). */
export type StatsSourceKey = SeasonRow['statsSource'];

/** The application team of each franchise identifier of the source. */
export type TeamIds = ReadonlyMap<SourceTeamId, TeamId>;

/** A season's team list, from the source that served it. */
type TeamList = Readonly<{
  season: Season;
  statsSource: StatsSourceKey;
  teams: readonly SourceTeam[];
}>;

/** A stored team of the list, with its names and the latest season stored of it. */
type KnownTeam = Readonly<{
  ref: string;
  id: TeamId;
  name: string;
  abbreviation: string;
  latest: string | null;
}>;

/** The one row that a statement returns. */
export function only<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (row === undefined) {
    throw new Error('A statement that returns one row returned none.');
  }
  return row;
}

/** A franchise's name that season, such as `Harbor City Herons` (JOU-08). */
const fullName = (team: SourceTeam): string => `${team.location} ${team.name}`;

async function knownTeams(tx: Transaction, list: TeamList): Promise<readonly KnownTeam[]> {
  const refs = list.teams.map(({ team }) => team);
  return tx
    .select({
      ref: teamSourceRefs.sourceTeamRef,
      id: teams.id,
      name: teams.name,
      abbreviation: teams.abbreviation,
      latest: sql<string | null>`(SELECT max(${teamSeasons.season}) FROM ${teamSeasons}
        WHERE ${teamSeasons.teamId} = ${teams.id})`,
    })
    .from(teamSourceRefs)
    .innerJoin(teams, eq(teams.id, teamSourceRefs.teamId))
    .where(
      and(
        eq(teamSourceRefs.statsSource, list.statsSource),
        inArray(teamSourceRefs.sourceTeamRef, refs),
      ),
    );
}

/** Gives a known team the names of `team` when no later season of it is stored (JOU-08, STA-26). */
async function followLatest(
  tx: Transaction,
  known: KnownTeam,
  { season, team }: Readonly<{ season: Season; team: SourceTeam }>,
): Promise<void> {
  const isLatest = known.latest === null || known.latest <= season;
  if (isLatest && (known.name !== fullName(team) || known.abbreviation !== team.abbreviation)) {
    await tx
      .update(teams)
      .set({ name: fullName(team), abbreviation: team.abbreviation })
      .where(eq(teams.id, known.id));
  }
}

async function insertTeam(
  tx: Transaction,
  team: SourceTeam,
  statsSource: StatsSourceKey,
): Promise<TeamId> {
  const { id } = only(
    await tx
      .insert(teams)
      .values({ abbreviation: team.abbreviation, name: fullName(team) })
      .returning({ id: teams.id }),
  );
  await tx.insert(teamSourceRefs).values({ teamId: id, statsSource, sourceTeamRef: team.team });
  return id;
}

/**
 * Stores a season's teams (JOU-08, STA-26, CL-JOU-18, CL-STA-23): a new franchise
 * identifier becomes a team, whose name and abbreviation follow the latest season
 * stored, and each team keeps its name, location and abbreviation of the season. Known
 * teams are renamed before new ones come, so that a new team may take an abbreviation
 * that a known one gives up. Gives the team of each identifier.
 */
export async function storeTeams(tx: Transaction, list: TeamList): Promise<TeamIds> {
  const rows = await knownTeams(tx, list);
  const known = new Map(rows.map((row) => [row.ref, row]));
  const pairs: (readonly [SourceTeam, TeamId])[] = [];
  for (const team of list.teams) {
    const row = known.get(team.team);
    if (row === undefined) {
      continue;
    }
    await followLatest(tx, row, { season: list.season, team });
    pairs.push([team, row.id]);
  }
  for (const team of list.teams) {
    if (!known.has(team.team)) {
      pairs.push([team, await insertTeam(tx, team, list.statsSource)]);
    }
  }
  if (pairs.length > 0) {
    await tx
      .insert(teamSeasons)
      .values(
        pairs.map(([{ name, location, abbreviation }, teamId]) => {
          return { teamId, season: list.season, name, location, abbreviation };
        }),
      )
      .onConflictDoUpdate({
        target: [teamSeasons.teamId, teamSeasons.season],
        set: {
          name: sql`excluded.name`,
          location: sql`excluded.location`,
          abbreviation: sql`excluded.abbreviation`,
        },
      });
  }
  return new Map(pairs.map(([team, id]) => [team.team, id]));
}
