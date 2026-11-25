import 'server-only';

import { and, eq, inArray, or } from 'drizzle-orm';

import { backtestRequests, drafts } from '@/lib/db';
import { draftKey } from '@/lib/device-drafts';
import { getParam } from '@/lib/params';
import { toEpochMs } from '@/lib/time';

import { withdrawnEventCount } from './server-drafts';

import type { DraftCheck, DraftTarget } from '@/lib/device-drafts';
import type { Executor } from '@/lib/params';
import type { EpochMs } from '@/lib/time';

/** The requests of the import targets among `targets`. */
function requestIdsOf(targets: readonly DraftTarget[]): number[] {
  return targets
    .filter((target) => target.kind === 'research_result')
    .map((target) => target.requestId);
}

/**
 * The last change of each server copy among those of `requestIds` and every exploration
 * draft, by the key of its target (CL-DSN-17).
 */
async function lastChanges(
  executor: Executor,
  requestIds: number[],
): Promise<Map<string, EpochMs>> {
  const rows = await executor
    .select({
      requestId: drafts.backtestRequestId,
      eventTypeId: drafts.explorationEventTypeId,
      updatedAt: drafts.updatedAt,
    })
    .from(drafts)
    .where(
      or(inArray(drafts.backtestRequestId, requestIds), eq(drafts.kind, 'exploration_response')),
    );
  return new Map(
    rows.map((row) => [
      draftKey(
        row.requestId === null
          ? { kind: 'exploration_response', eventTypeId: row.eventTypeId }
          : { kind: 'research_result', requestId: row.requestId },
      ),
      toEpochMs(row.updatedAt.getTime()),
    ]),
  );
}

/** The requests among `requestIds` whose status is `imported`. */
async function importedRequests(executor: Executor, requestIds: number[]): Promise<Set<number>> {
  const rows = await executor
    .select({ id: backtestRequests.id })
    .from(backtestRequests)
    .where(and(inArray(backtestRequests.id, requestIds), eq(backtestRequests.status, 'imported')));
  return new Set(rows.map((row) => row.id));
}

/**
 * The server's answer at a device's contact (IHM-42, CL-DSN-17, CL-DSN-22, CL-IHM-11): the
 * withdrawn-events counter, the draft retention, and, for each copy that the device had
 * sent, the last change of its server copy, `null` when it no longer exists, and whether
 * its request is imported. The answer names only the targets the device sent, and the
 * server records nothing of the contact.
 */
export async function checkDeviceDrafts(
  executor: Executor,
  sent: readonly DraftTarget[],
): Promise<DraftCheck> {
  const requestIds = requestIdsOf(sent);
  const changes = await lastChanges(executor, requestIds);
  const imported = await importedRequests(executor, requestIds);
  return {
    withdrawnEventCount: await withdrawnEventCount(executor),
    retentionDays: await getParam(executor, 'display.draftRetentionDays'),
    copies: sent.map((target) => ({
      target,
      updatedAt: changes.get(draftKey(target)) ?? null,
      requestImported: target.kind === 'research_result' && imported.has(target.requestId),
    })),
  };
}
