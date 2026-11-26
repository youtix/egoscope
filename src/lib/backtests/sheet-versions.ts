// The sheet versions that the prompts of the requests rest on (TAX-23, BKT-15): which
// requested types have a sheet newer than the one their prompt used.
import 'server-only';

import { and, eq } from 'drizzle-orm';

import { backtestRequests, backtestRequestTypes } from '@/lib/db';
import { listByStatus, validatedSheets } from '@/lib/taxonomy';

import { rankedTodo, requestRows } from './request-reads';

import type { Reader, RequestPlayer } from './request-reads';

/** The name of every type, whatever its state (TAX-10). */
export async function typeNames(db: Reader): Promise<ReadonlyMap<string, string>> {
  const groups = await listByStatus(db);
  return new Map(groups.flatMap(({ types }) => types.map(({ id, name }) => [id, name] as const)));
}

/** The name and the version in force of each validated research type (TAX-11, TAX-23). */
export async function validatedVersions(
  db: Reader,
): Promise<ReadonlyMap<string, Readonly<{ name: string; versionNumber: number }>>> {
  const sheets = await validatedSheets(db, 'research_prompt');
  return new Map(sheets.map(({ id, name, versionNumber }) => [id, { name, versionNumber }]));
}

/** A type whose sheet changed since the prompt of a request to do was produced (TAX-23). */
export type OutdatedType = Readonly<{
  eventTypeId: string;
  name: string;
  usedVersionNumber: number;
  currentVersionNumber: number;
}>;

/** A request to do whose prompt rests on an earlier version of the sheet of a requested type (BKT-15, TAX-23). */
export type OutdatedPrompt = Readonly<{
  id: number;
  reference: string;
  player: RequestPlayer;
  types: readonly OutdatedType[];
}>;

/**
 * The requests to do whose prompt rests on an earlier version of the sheet of a requested
 * type, in the order of the to-do list, each with those types and both versions, so that
 * the owner regenerates the prompt before launching the research (TAX-23, BKT-15). A type
 * a reduction took out of the prompt, a type that is no longer a validated research type
 * and a request that is not to do are left out.
 */
export async function outdatedPrompts(db: Reader): Promise<readonly OutdatedPrompt[]> {
  const requests = rankedTodo(await requestRows(db, 'to_do'));
  const requested = await db
    .select({
      requestId: backtestRequestTypes.backtestRequestId,
      eventTypeId: backtestRequestTypes.eventTypeId,
      usedVersionNumber: backtestRequestTypes.sheetVersionNumber,
    })
    .from(backtestRequestTypes)
    .innerJoin(backtestRequests, eq(backtestRequests.id, backtestRequestTypes.backtestRequestId))
    .where(and(eq(backtestRequests.status, 'to_do'), eq(backtestRequestTypes.isRequested, true)))
    .orderBy(backtestRequestTypes.eventTypeId);
  const validated = await validatedVersions(db);
  const outdated = new Map<number, OutdatedType[]>();
  for (const type of requested) {
    const current = validated.get(type.eventTypeId);
    // A type that is no longer a validated research type has no version in force: not outdated.
    if (current !== undefined && current.versionNumber > type.usedVersionNumber) {
      outdated.set(type.requestId, [
        ...(outdated.get(type.requestId) ?? []),
        {
          eventTypeId: type.eventTypeId,
          name: current.name,
          usedVersionNumber: type.usedVersionNumber,
          currentVersionNumber: current.versionNumber,
        },
      ]);
    }
  }
  const prompts: OutdatedPrompt[] = [];
  for (const request of requests) {
    const types = outdated.get(request.id);
    if (types !== undefined) {
      prompts.push({
        id: request.id,
        reference: request.reference,
        player: { id: request.playerId, displayName: request.playerName },
        types,
      });
    }
  }
  return prompts;
}
