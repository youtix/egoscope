// The page-only reads of the event page (module map §3.1): lookups that no module's read
// API gives, the correction history, the names its kept values designate, and the game
// of a calendar-derived event with the basis of its derivation (rule 7 of module map §1.2).
import 'server-only';

import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm';

import {
  boxScores,
  eventCorrections,
  eventTypes,
  followedPlayers,
  games,
  teamSeasons,
} from '@/lib/db';
import { expectedGame } from '@/lib/games';
import { toEpochMs, toIsoDate } from '@/lib/time';

import type { Database } from '@/lib/db';
import type { CalendarDerivedEvent, EventCorrectionRow } from '@/lib/events';
import type { CalendarDerivation } from '@/lib/taxonomy';
import type { EpochMs, IsoDate, TipOff } from '@/lib/time';

/**
 * One entry of a correction history: its instant, the field or the action it names, and
 * the values kept before and after it, which only a detected event's structured fields
 * and a calendar-derived event's context keep (IMP-32, DET-52, CL-DSN-15).
 */
export type CorrectionEntry = Readonly<{
  id: number;
  correctedAt: EpochMs;
  field: EventCorrectionRow['field'];
  before: string | null;
  after: string | null;
}>;

/** A team as it was named the season of a game (JOU-08). */
type TeamName = Readonly<{ location: string; name: string }>;

/** The side of the player's team in a game, and the other team (STA-26). */
type Opponent = Readonly<{ venue: 'home' | 'away'; team: TeamName }>;

/**
 * The game of a calendar-derived event (CL-IHM-21, CL-VUE-15): its start, the opponent of
 * the player's team with its side, unless the stored schedule no longer places him in that
 * game, and for a former-team event the day of his last game for that team before it.
 */
export type DerivedGame = Readonly<{
  tipOff: TipOff;
  opponent: Opponent | null;
  lastGameForOpponentOn: IsoDate | null;
}>;

// A game starts strictly after this much less than its start.
const JUST_BEFORE_MS = 1;

/** The correction history of an event, oldest first (IMP-32, DET-52, CL-DSN-15). */
export async function correctionHistory(
  db: Database,
  playerEventId: number,
): Promise<readonly CorrectionEntry[]> {
  const rows = await db
    .select()
    .from(eventCorrections)
    .where(eq(eventCorrections.playerEventId, playerEventId))
    .orderBy(asc(eventCorrections.correctedAt), asc(eventCorrections.id));
  return rows.map((row) => ({
    id: row.id,
    correctedAt: toEpochMs(row.correctedAt.getTime()),
    field: row.field,
    before: row.beforeValue,
    after: row.afterValue,
  }));
}

/** The values that the entries of `field` kept. */
function keptValues(entries: readonly CorrectionEntry[], field: CorrectionEntry['field']) {
  return entries
    .filter((entry) => entry.field === field)
    .flatMap(({ before, after }) => [before, after])
    .filter((value) => value !== null);
}

/**
 * The names of the types and players that the kept values of a detected event's type and
 * player corrections designate, by identifier (DET-52); no read for no such value.
 */
export async function namesOfValues(
  db: Database,
  entries: readonly CorrectionEntry[],
): Promise<ReadonlyMap<string, string>> {
  const typeIds = keptValues(entries, 'event_type');
  const playerIds = keptValues(entries, 'player');
  const types =
    typeIds.length === 0
      ? []
      : await db
          .select({ id: eventTypes.id, name: eventTypes.name })
          .from(eventTypes)
          .where(inArray(eventTypes.id, typeIds));
  const players =
    playerIds.length === 0
      ? []
      : await db
          .select({ id: followedPlayers.id, name: followedPlayers.displayName })
          .from(followedPlayers)
          .where(inArray(followedPlayers.id, playerIds));
  return new Map([...types, ...players].map(({ id, name }) => [id, name]));
}

/** The day of the player's last game for `teamId` that started before `before` (CL-TAX-18). */
async function lastGameFor(
  db: Database,
  { playerId, teamId, before }: Readonly<{ playerId: string; teamId: number; before: Date }>,
) {
  const [last] = await db
    .select({ on: games.gameDayOn })
    .from(boxScores)
    .innerJoin(games, eq(games.id, boxScores.gameId))
    .where(
      and(
        eq(boxScores.playerId, playerId),
        eq(boxScores.teamId, teamId),
        lt(games.scheduledStartAt, before),
      ),
    )
    .orderBy(desc(games.scheduledStartAt))
    .limit(1);
  return last === undefined ? null : toIsoDate(last.on);
}

/**
 * The game of a calendar-derived event, which stands for its sources (CL-IHM-21,
 * CL-VUE-15): its start; the player's team in it, as his team games give it, and so its
 * side and its opponent under the opponent's name that season; and, for `former_team`,
 * the day of his last game for the opponent before it.
 */
export async function derivedGame(
  db: Database,
  event: CalendarDerivedEvent,
  derivation: CalendarDerivation | null,
): Promise<DerivedGame> {
  const [game] = await db.select().from(games).where(eq(games.id, event.derivedGameId));
  if (game === undefined) {
    throw new Error('A calendar-derived event names a game that the database does not hold.');
  }
  const startAt = toEpochMs(game.scheduledStartAt.getTime());
  const tipOff = { scheduledStartAt: startAt, isStartTimeTbd: game.isStartTimeTbd };
  const his = await expectedGame(db, event.playerId, toEpochMs(startAt - JUST_BEFORE_MS));
  const teamId = his?.game.id === game.id ? his.teamId : null;
  const venue = teamId === game.homeTeamId ? 'home' : 'away';
  const opponentId = venue === 'home' ? game.awayTeamId : game.homeTeamId;
  if (teamId === null || opponentId === null) {
    return { tipOff, opponent: null, lastGameForOpponentOn: null };
  }
  const [team] = await db
    .select({ location: teamSeasons.location, name: teamSeasons.name })
    .from(teamSeasons)
    .where(and(eq(teamSeasons.teamId, opponentId), eq(teamSeasons.season, game.season)));
  if (team === undefined) {
    throw new Error('A stored game names a team that has no name that season.');
  }
  return {
    tipOff,
    opponent: { venue, team },
    lastGameForOpponentOn:
      derivation === 'former_team'
        ? await lastGameFor(db, {
            playerId: event.playerId,
            teamId: opponentId,
            before: game.scheduledStartAt,
          })
        : null,
  };
}
