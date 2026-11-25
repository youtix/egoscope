import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { followedPlayers, playerNameVariants, playerTeamChanges, teams } from '@/lib/db';
import { record } from '@/lib/journal';
import { getParam } from '@/lib/params';
import { err, ok } from '@/lib/result';
import { now } from '@/lib/time';

import { activeCount, normalizeName, sharedVariants } from './queries';

import type { NameVariantKind, SharedVariant } from './queries';
import type { Transaction } from '@/lib/db';
import type { Result } from '@/lib/result';

// The transaction lock that an addition or a reactivation holds from its count of the
// active players to its write, so that two at once cannot both pass the maximum (JOU-05).
const ACTIVE_PLAYERS_LOCK = 'egoscope.active-players';

/** A variant typed at addition (JOU-08, JOU-09). */
export type NewNameVariant = Readonly<{
  kind: NameVariantKind;
  text: string;
  isAmbiguous: boolean;
}>;

/** The identity typed on the addition screen (JOU-08). */
export type NewPlayer = Readonly<{
  displayName: string;
  /** A team of the team directory, required at addition (CL-JOU-20). */
  currentTeamId: number | null;
  variants: readonly NewNameVariant[];
}>;

/** What is wrong with one typed variant: left empty, or the same as another of his names. */
export type VariantProblem = Readonly<{ index: number; problem: 'required' | 'duplicate' }>;

/** The fields to fix, each with what is wrong with it. */
export type AddFieldErrors = Readonly<{
  displayName?: 'required';
  currentTeamId?: 'required' | 'unknown';
  variants?: readonly VariantProblem[];
}>;

// The ways out of a full list that the refusal offers (JOU-05): pause or withdraw an
// active player, or raise the parameter, knowing that more players use more quota.
const WAYS_OUT_OF_FULL_LIST = [
  'pause_active_player',
  'withdraw_active_player',
  'raise_maximum',
] as const;

/** The refusal of a full list, which an addition and a reactivation share (JOU-05, JOU-20). */
export type MaximumReached = Readonly<{
  kind: 'maximum_reached';
  /** The maximum in force, `players.maxActive`. */
  maxActive: number;
  waysOut: typeof WAYS_OUT_OF_FULL_LIST;
}>;

/** Why an addition is refused. */
export type AddRefusal =
  MaximumReached | Readonly<{ kind: 'invalid_fields'; fields: AddFieldErrors }>;

/** The player added, and the other players who share one of his names (JOU-09). */
export type Added = Readonly<{ playerId: string; sharedVariants: readonly SharedVariant[] }>;

/**
 * The problems of the variants typed at addition or kept at an identity edit, which both
 * call it (JOU-08, JOU-09, CL-JOU-13): empty, or equal, once normalized, to his display name
 * or an earlier variant. The barrel does not export it.
 */
export function variantProblems(
  identity: Readonly<{ displayName: string; variants: readonly Readonly<{ text: string }>[] }>,
): readonly VariantProblem[] {
  const seen = new Set([normalizeName(identity.displayName)]);
  return identity.variants.flatMap((variant, index): VariantProblem[] => {
    const key = normalizeName(variant.text);
    if (key === '') {
      return [{ index, problem: 'required' }];
    }
    if (seen.has(key)) {
      return [{ index, problem: 'duplicate' }];
    }
    seen.add(key);
    return [];
  });
}

/** Whether `teamId` is a team of the directory. */
async function isKnownTeam(tx: Transaction, teamId: number): Promise<boolean> {
  const [team] = await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId));
  return team !== undefined;
}

/** What is wrong with the team chosen: none, or not a team of the directory (CL-JOU-20). */
async function teamError(
  tx: Transaction,
  teamId: number | null,
): Promise<AddFieldErrors['currentTeamId']> {
  if (teamId === null) {
    return 'required';
  }
  return (await isKnownTeam(tx, teamId)) ? undefined : 'unknown';
}

/** The team of `player` once every field is right, or what is wrong field by field. */
async function validTeam(
  tx: Transaction,
  player: NewPlayer,
): Promise<Result<number, AddFieldErrors>> {
  const variants = variantProblems(player);
  const team = await teamError(tx, player.currentTeamId);
  const fields: AddFieldErrors = {
    ...(normalizeName(player.displayName) === '' && { displayName: 'required' as const }),
    ...(team !== undefined && { currentTeamId: team }),
    ...(variants.length > 0 && { variants }),
  };
  return Object.keys(fields).length === 0 && player.currentTeamId !== null
    ? ok(player.currentTeamId)
    : err(fields);
}

/**
 * The refusal of a full list, or none while fewer than `players.maxActive` players are
 * active, paused and withdrawn ones not counted (JOU-04, JOU-05, JOU-20): an addition here
 * and a reactivation in the status operations call it before they write. It first takes, in
 * the caller's transaction `tx`, the lock that every change raising the active count holds
 * until `tx` ends, and counts only then: a count read before the lock could predate another
 * addition or reactivation that commits meanwhile, and both would take the last place.
 */
export async function fullListUnderLock(tx: Transaction): Promise<MaximumReached | undefined> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ACTIVE_PLAYERS_LOCK}))`);
  const maxActive = await getParam(tx, 'players.maxActive');
  return (await activeCount(tx)) < maxActive
    ? undefined
    : { kind: 'maximum_reached', maxActive, waysOut: WAYS_OUT_OF_FULL_LIST };
}

/** Writes the player, his variants and the first row of his team history. */
async function insertPlayer(tx: Transaction, player: NewPlayer, teamId: number): Promise<string> {
  const addedAt = new Date(now());
  const [inserted] = await tx
    .insert(followedPlayers)
    .values({
      displayName: player.displayName.trim(),
      displayNameNormalized: normalizeName(player.displayName),
      currentTeamId: teamId,
      status: 'active',
      addedAt,
    })
    .returning({ id: followedPlayers.id });
  if (inserted === undefined) {
    throw new Error('The insert of a followed player returned no row.');
  }
  const playerId = inserted.id;
  if (player.variants.length > 0) {
    await tx.insert(playerNameVariants).values(
      player.variants.map((variant) => ({
        playerId,
        kind: variant.kind,
        text: variant.text,
        normalizedText: normalizeName(variant.text),
        isAmbiguous: variant.isAmbiguous,
      })),
    );
  }
  // The team chosen, an entered change that his first game judges (CL-JOU-03, CL-STA-05).
  await tx.insert(playerTeamChanges).values({
    playerId,
    changedAt: addedAt,
    previousTeamId: null,
    newTeamId: teamId,
    origin: 'entered',
    gameId: null,
  });
  return playerId;
}

/**
 * Adds a followed player in the caller's transaction `tx` (JOU-04, JOU-05, JOU-07,
 * JOU-08, JOU-09): refused while `players.maxActive` players are active, paused and
 * withdrawn ones not counted, with the maximum and the ways out; refused field by field
 * for an empty display name, a missing or unknown team, or a variant empty or the same
 * as another of his names after normalization (CL-JOU-13). Otherwise writes him active,
 * under a random identifier never derived from his name (CL-JOU-09), with his variants
 * and the team chosen as the first row of his team history, an entered change dated
 * `added_at` (CL-JOU-02, CL-JOU-03, CL-STA-05), and one journal entry; no status change,
 * no backtest request, nothing of another module. Gives the players who share one of
 * his names, which the screen flags (CL-JOU-04).
 */
export async function add(tx: Transaction, player: NewPlayer): Promise<Result<Added, AddRefusal>> {
  const full = await fullListUnderLock(tx);
  if (full !== undefined) {
    return err(full);
  }
  const team = await validTeam(tx, player);
  if (!team.ok) {
    return err({ kind: 'invalid_fields', fields: team.error });
  }
  const playerId = await insertPlayer(tx, player, team.value);
  await record(tx, { messageKey: 'player_added', playerId });
  const names = [player.displayName, ...player.variants.map((variant) => variant.text)];
  return ok({ playerId, sharedVariants: await sharedVariants(tx, names, playerId) });
}
