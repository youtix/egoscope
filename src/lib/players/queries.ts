import 'server-only';

import { and, asc, count, eq, inArray, ne, or, sql } from 'drizzle-orm';

import {
  followedPlayers,
  playerNameVariants,
  playerStatusChanges,
  playerTeamChanges,
} from '@/lib/db';
import { getParam } from '@/lib/params';
import { toEpochMs } from '@/lib/time';

import type {
  FollowedPlayerRow,
  PlayerNameVariantRow,
  PlayerStatusChangeRow,
  PlayerTeamChangeRow,
} from './types';
import type { Database, Transaction } from '@/lib/db';
import type { EpochMs } from '@/lib/time';
import type { SQL } from 'drizzle-orm';

/** A connection or the caller's transaction, to read through. */
type Reader = Database | Transaction;

/** The state of a followed player (JOU-15). */
export type PlayerStatus = FollowedPlayerRow['status'];

/** A spelling variant or a nickname (JOU-08). */
export type NameVariantKind = PlayerNameVariantRow['kind'];

// The status that the list shows when it is given none (JOU-28).
const DEFAULT_LIST_STATUS: PlayerStatus = 'active';
const FIRST_PAGE = 1;
// A player identifier as Postgres writes a uuid: a malformed one names no player.
const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;

/**
 * A name or variant as two of them are compared (CL-JOU-13, JOU-09): Unicode NFC,
 * trimmed, inner runs of spaces collapsed to one, case folded by `toLowerCase` (a
 * lowercasing, not Unicode full case folding: a final sigma stays apart); accents and other
 * diacritics stay significant, so "Josué" and "Josue" remain two variants.
 */
export function normalizeName(name: string): string {
  return name.normalize('NFC').trim().replaceAll(/\s+/gu, ' ').toLowerCase();
}

/** Whether `playerId` can name a player at all: a malformed one would make Postgres throw. */
function isPlayerId(playerId: string): boolean {
  return UUID_PATTERN.test(playerId);
}

/** The instant of a `timestamptz` read back, in epoch milliseconds. */
const instant = (date: Date): EpochMs => toEpochMs(date.getTime());

/**
 * The number of active players, the count that `players.maxActive` caps; paused and
 * withdrawn players are not counted (JOU-04).
 */
export async function activeCount(db: Reader): Promise<number> {
  const [row] = await db
    .select({ active: count() })
    .from(followedPlayers)
    .where(eq(followedPlayers.status, 'active'));
  return row?.active ?? 0;
}

// The one table of what each status allows, which every other module reads (CL-JOU-05),
// built up from a withdrawn player's statistics and profiles: manual requests and the
// derivation added for a paused player (JOU-17, JOU-19), then detection, its requests,
// alerts and the pause suggestion for an active one only (JOU-18, JOU-22).
const WITHDRAWN_GATES = {
  /** His schedule, box scores, baselines, next game and indicators. */
  statistics: true,
  /** The calculation of his profiles, which stay consultable. */
  profiles: true,
  /** A backtest request that the owner makes by hand. */
  manualBacktestRequests: false,
  /** The derivation of his birthday games and first games against a former team. */
  calendarDerivation: false,
  /** The suggestion to pause him after a prolonged absence. */
  pauseSuggestion: false,
  /** Lot 2: daily detection of articles about him. */
  detection: false,
  /** Lot 2: a backtest request born of a detection. */
  detectionBacktestRequests: false,
  /** Lot 2: alert sheets about him. */
  alertSheets: false,
};

/** What a player's status lets run for him (CL-JOU-05). */
export type StatusGates = Readonly<Record<keyof typeof WITHDRAWN_GATES, boolean>>;

const PAUSED_GATES: StatusGates = {
  ...WITHDRAWN_GATES,
  manualBacktestRequests: true,
  calendarDerivation: true,
};

const ACTIVE_GATES: StatusGates = {
  ...PAUSED_GATES,
  pauseSuggestion: true,
  detection: true,
  detectionBacktestRequests: true,
  alertSheets: true,
};

/**
 * What runs for a player of `status`, the single table that the other modules read instead
 * of encoding it again (JOU-16, JOU-17, JOU-18, JOU-19, JOU-22, CL-JOU-05): an active player
 * gets every function; a paused one keeps his statistics, his profiles, manual backtest
 * requests and the calendar derivation; a withdrawn one his statistics and profiles only.
 */
export function statusGates(status: PlayerStatus): StatusGates {
  return { active: ACTIVE_GATES, paused: PAUSED_GATES, withdrawn: WITHDRAWN_GATES }[status];
}

/** Another followed player who already has one of the names typed (JOU-09, CL-JOU-04). */
export type SharedVariant = Readonly<{
  /** The name typed, as typed. */
  text: string;
  playerId: string;
  /** The other player's display name, which the warning names. */
  displayName: string;
}>;

/**
 * For each of `texts`, the other followed players, whatever their status, whose display
 * name or one of whose variants is the same after normalization, so that entry shows
 * "Shared with {player}" (JOU-09, CA-JOU-06, CL-JOU-04, CL-JOU-13). `exceptPlayerId`,
 * the player being edited or just added, is left out. One query; none for no text.
 */
export async function sharedVariants(
  db: Reader,
  texts: readonly string[],
  exceptPlayerId?: string,
): Promise<readonly SharedVariant[]> {
  const typed = texts.filter((text) => normalizeName(text) !== '');
  if (typed.length === 0) {
    return [];
  }
  const keys = [...new Set(typed.map((text) => normalizeName(text)))];
  const others = exceptPlayerId === undefined ? undefined : ne(followedPlayers.id, exceptPlayerId);
  const sameName = or(
    inArray(followedPlayers.displayNameNormalized, keys),
    inArray(playerNameVariants.normalizedText, keys),
  );
  const rows = await db
    .selectDistinct({
      playerId: followedPlayers.id,
      displayName: followedPlayers.displayName,
      displayNameNormalized: followedPlayers.displayNameNormalized,
      variant: playerNameVariants.normalizedText,
    })
    .from(followedPlayers)
    .leftJoin(playerNameVariants, eq(playerNameVariants.playerId, followedPlayers.id))
    .where(and(others, sameName))
    .orderBy(asc(followedPlayers.displayNameNormalized), asc(followedPlayers.id));
  return typed.flatMap((text) => {
    const key = normalizeName(text);
    const owners = rows.filter((row) => row.displayNameNormalized === key || row.variant === key);
    const unique = new Map(owners.map((row) => [row.playerId, row.displayName]));
    return [...unique].map(([playerId, displayName]) => ({ text, playerId, displayName }));
  });
}

/** What the list of followed players shows of one (JOU-28). */
export type ListedPlayer = Readonly<{
  id: string;
  displayName: string;
  currentTeamId: number | null;
  status: PlayerStatus;
}>;

/** Which followed players the list shows, and which page of them (JOU-28, IHM-18). */
export type PlayerListQuery = Readonly<{
  /** Active players when left out (JOU-28). */
  status?: PlayerStatus;
  /** A part of a display name or a variant, compared after normalization (CL-JOU-13). */
  search?: string;
  /** From 1: the first page when left out or not a whole number of at least 1. */
  page?: number;
}>;

/** A page of the list, and whether another follows. */
export type PlayerListPage = Readonly<{
  players: readonly ListedPlayer[];
  page: number;
  hasNextPage: boolean;
}>;

/** The players whose normalized display name or one of whose variants contains `search`. */
function matchingName(search: string): SQL | undefined {
  const term = normalizeName(search);
  return term === ''
    ? undefined
    : or(
        sql`strpos(${followedPlayers.displayNameNormalized}, ${term}) > 0`,
        sql`exists (select 1 from ${playerNameVariants} where ${playerNameVariants.playerId} = ${followedPlayers.id} and strpos(${playerNameVariants.normalizedText}, ${term}) > 0)`,
      );
}

/** `page` when it is a whole number of at least 1, the first page otherwise (IHM-18). */
function pageNumber(page: number | undefined): number {
  return page !== undefined && Number.isSafeInteger(page) && page >= FIRST_PAGE ? page : FIRST_PAGE;
}

/**
 * A page of the follow list in name order, `display.listPageSize` players a page
 * (IHM-18): filtered by status, the active players by default, and searched by name on
 * the normalized display name and variants (JOU-28, CL-JOU-13). Two queries.
 */
export async function list(db: Reader, query: PlayerListQuery = {}): Promise<PlayerListPage> {
  const { status = DEFAULT_LIST_STATUS, search = '' } = query;
  const page = pageNumber(query.page);
  const pageSize = await getParam(db, 'display.listPageSize');
  const rows = await db
    .select({
      id: followedPlayers.id,
      displayName: followedPlayers.displayName,
      currentTeamId: followedPlayers.currentTeamId,
      status: followedPlayers.status,
    })
    .from(followedPlayers)
    .where(and(eq(followedPlayers.status, status), matchingName(search)))
    .orderBy(asc(followedPlayers.displayNameNormalized), asc(followedPlayers.id))
    .limit(pageSize + 1)
    .offset((page - FIRST_PAGE) * pageSize);
  return { players: rows.slice(0, pageSize), page, hasNextPage: rows.length > pageSize };
}

/** A name variant as the player page and the edit screen show it (JOU-08, JOU-09). */
export type NameVariant = Readonly<{
  id: number;
  kind: NameVariantKind;
  text: string;
  isAmbiguous: boolean;
}>;

/** A followed player's identity and state, as his page and his edit screen read it. */
export type PlayerDetail = Readonly<{
  id: string;
  displayName: string;
  currentTeamId: number | null;
  status: PlayerStatus;
  /** The day and month of birth, never a year (JOU-11, CL-JOU-16). */
  birthday: Readonly<{ month: number; day: number }> | null;
  birthdayOrigin: FollowedPlayerRow['birthdayOrigin'];
  addedAt: EpochMs;
  /** When the owner last declined the pause suggestion (JOU-22). */
  pauseSuggestionDeclinedAt: EpochMs | null;
  /** The version a save sends back (CL-IHM-18). */
  rowVersion: number;
  variants: readonly NameVariant[];
}>;

/** The day and month of birth of `row`, when both are known. */
function birthdayOf(row: FollowedPlayerRow): PlayerDetail['birthday'] {
  return row.birthdayMonth === null || row.birthdayDay === null
    ? null
    : { month: row.birthdayMonth, day: row.birthdayDay };
}

/**
 * The followed player `playerId`: his identity, variants in entry order, status,
 * current team, birthday, declined pause suggestion and row version (JOU-08, JOU-22,
 * CL-JOU-16, CL-IHM-18); null when no player has that identifier. Two queries.
 */
export async function get(db: Reader, playerId: string): Promise<PlayerDetail | null> {
  if (!isPlayerId(playerId)) {
    return null;
  }
  const [row] = await db.select().from(followedPlayers).where(eq(followedPlayers.id, playerId));
  if (row === undefined) {
    return null;
  }
  const variants = await db
    .select({
      id: playerNameVariants.id,
      kind: playerNameVariants.kind,
      text: playerNameVariants.text,
      isAmbiguous: playerNameVariants.isAmbiguous,
    })
    .from(playerNameVariants)
    .where(eq(playerNameVariants.playerId, playerId))
    .orderBy(asc(playerNameVariants.id));
  return {
    id: row.id,
    displayName: row.displayName,
    currentTeamId: row.currentTeamId,
    status: row.status,
    birthday: birthdayOf(row),
    birthdayOrigin: row.birthdayOrigin,
    addedAt: instant(row.addedAt),
    pauseSuggestionDeclinedAt:
      row.pauseSuggestionDeclinedAt === null ? null : instant(row.pauseSuggestionDeclinedAt),
    rowVersion: row.rowVersion,
    variants,
  };
}

/** A dated change of status, with its optional reason (JOU-15, CL-JOU-12). */
export type StatusHistoryEntry = Readonly<{
  kind: 'status';
  changedAt: EpochMs;
  fromStatus: PlayerStatus;
  toStatus: PlayerStatus;
  reason: PlayerStatusChangeRow['reason'];
}>;

/** A dated change of team, with its origin and its game (JOU-13, CL-JOU-03). */
export type TeamHistoryEntry = Readonly<{
  kind: 'team';
  changedAt: EpochMs;
  previousTeamId: number | null;
  newTeamId: number | null;
  origin: PlayerTeamChangeRow['origin'];
  gameId: number | null;
}>;

/** One line of a player's history. */
export type PlayerHistoryEntry = StatusHistoryEntry | TeamHistoryEntry;

/**
 * The status and team changes of `playerId`, oldest first, a status change before a
 * team change of the same instant (JOU-13, JOU-15, JOU-25); none for an unknown player.
 * Two queries.
 */
export async function history(
  db: Reader,
  playerId: string,
): Promise<readonly PlayerHistoryEntry[]> {
  if (!isPlayerId(playerId)) {
    return [];
  }
  const statuses = await db
    .select()
    .from(playerStatusChanges)
    .where(eq(playerStatusChanges.playerId, playerId))
    .orderBy(asc(playerStatusChanges.changedAt), asc(playerStatusChanges.id));
  const teams = await db
    .select()
    .from(playerTeamChanges)
    .where(eq(playerTeamChanges.playerId, playerId))
    .orderBy(asc(playerTeamChanges.changedAt), asc(playerTeamChanges.id));
  const entries: PlayerHistoryEntry[] = [
    ...statuses.map((row) => ({
      kind: 'status' as const,
      changedAt: instant(row.changedAt),
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      reason: row.reason,
    })),
    ...teams.map((row) => ({
      kind: 'team' as const,
      changedAt: instant(row.changedAt),
      previousTeamId: row.previousTeamId,
      newTeamId: row.newTeamId,
      origin: row.origin,
      gameId: row.gameId,
    })),
  ];
  // A stable sort keeps each kind's own order, and the status changes first, on a tie.
  return entries.toSorted((left, right) => left.changedAt - right.changedAt);
}

/** A variant that detection searches, with its ambiguous mark (JOU-09, DET-04). */
export type SearchedVariant = Readonly<{
  kind: NameVariantKind;
  text: string;
  normalizedText: string;
  isAmbiguous: boolean;
}>;

/** An active player's names, as the Lot 2 prefilter searches them. */
export type ActivePlayerNames = Readonly<{
  playerId: string;
  displayName: string;
  displayNameNormalized: string;
  variants: readonly SearchedVariant[];
}>;

/**
 * The names of every active player, and of no paused or withdrawn one: his display
 * name and his variants with their ambiguous marks, which the Lot 2 prefilter searches
 * (JOU-09, JOU-18, DET-04). One query.
 */
export async function variantsOfActivePlayers(db: Reader): Promise<readonly ActivePlayerNames[]> {
  const rows = await db
    .select({
      playerId: followedPlayers.id,
      displayName: followedPlayers.displayName,
      displayNameNormalized: followedPlayers.displayNameNormalized,
      variant: playerNameVariants,
    })
    .from(followedPlayers)
    .leftJoin(playerNameVariants, eq(playerNameVariants.playerId, followedPlayers.id))
    .where(eq(followedPlayers.status, 'active'))
    .orderBy(
      asc(followedPlayers.displayNameNormalized),
      asc(followedPlayers.id),
      asc(playerNameVariants.id),
    );
  // The rows come player by player: each player's first row opens his names.
  const players: (ActivePlayerNames & { variants: SearchedVariant[] })[] = [];
  for (const { variant, ...player } of rows) {
    const last = players.at(-1);
    const names = last?.playerId === player.playerId ? last : { ...player, variants: [] };
    if (names !== last) {
      players.push(names);
    }
    if (variant === null) {
      continue;
    }
    const { kind, text, normalizedText, isAmbiguous } = variant;
    names.variants.push({ kind, text, normalizedText, isAmbiguous });
  }
  return players;
}
