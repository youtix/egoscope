// The quota guard around every outbound call (TRV-04): checked before the call against
// the service's limits, deferred instead of exceeding one, recorded after it (module
// map §2.1, quotas).
import { sql } from 'drizzle-orm';

import { getParams } from '@/lib/params';
import { err, ok } from '@/lib/result';
import { now } from '@/lib/time';

import { check } from './check';
import { hold, readStates, release } from './ledger';
import { SERVICES } from './limits';
import { syncReached } from './quota-incidents';
import { usageOf } from './readers';
import { addUsage, settle } from './record';

import type { Estimate, Verdict } from './check';
import type { Hold, LimitState } from './ledger';
import type { QuotaService } from './limits';
import type { OutcomeOf } from './readers';
import type { Database, Transaction } from '@/lib/db';
import type { ParamReader } from '@/lib/params';
import type { Result } from '@/lib/result';
import type { EpochMs } from '@/lib/time';

type Executor = Database | Transaction;

/** A call to guard: its service, what it expects to use, and whether it is priority work (STA-39, STA-40). */
export type QuotaRequest<S extends QuotaService> = Readonly<{
  service: S;
  estimate: Estimate;
  priority: boolean;
}>;

/**
 * A call not made, since it would exceed a limit or a refusal still holds (TRV-04):
 * the instant it may be made, or null when no reset ever makes room for it.
 */
export type Deferred = Readonly<{ kind: 'deferred'; availableAt: EpochMs | null }>;

type Checked = Readonly<{ verdict: Verdict; values: ParamReader; states: readonly LimitState[] }>;

/** A call let through: its verdict, the values in force and the estimate it holds. */
type Admission = Readonly<{ verdict: Verdict; values: ParamReader; holds: readonly Hold[] }>;

/** The verdict on `request` at `at`, with the values in force and the states it was reached with. */
async function verdictOf(
  db: Executor,
  request: QuotaRequest<QuotaService>,
  at: EpochMs,
): Promise<Checked> {
  const declaration = SERVICES[request.service];
  const values = await getParams(db);
  const states = await readStates(db, declaration.limits, at);
  const views = states.map((state) => ({ state, value: values.get(state.limit.key) }));
  const verdict = check(
    views,
    {
      estimate: request.estimate,
      priority: request.priority,
      reserveShare: declaration.reserve ? values.get('games.quotaReserveShare') : 0,
      callSize: declaration.callSizeKey === null ? null : values.get(declaration.callSizeKey),
    },
    at,
  );
  return { verdict, values, states };
}

/**
 * Makes the calls of the services of `service`'s role wait for each other's check and
 * record until `tx` ends, since they share the counts, the warning and the incident.
 */
async function lockService(tx: Transaction, service: QuotaService): Promise<void> {
  const key = `quotas.${SERVICES[service].role}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
}

/**
 * Checks `request` at `at` in `tx`, under its service's lock: a call let through holds
 * its estimate on the counts, so that a call checked while it runs sees it; a call
 * deferred by a limit reached opens "quota reached" (TRV-04, TRV-05).
 */
async function admit(
  tx: Transaction,
  request: QuotaRequest<QuotaService>,
  at: EpochMs,
): Promise<Result<Admission, Deferred>> {
  await lockService(tx, request.service);
  const { verdict, values, states } = await verdictOf(tx, request, at);
  if (!verdict.allowed) {
    if (verdict.reached) {
      const causes = new Set(['limit_reached'] as const);
      await syncReached(tx, request.service, { at, values, causes, resumed: false });
    }
    return err({ kind: 'deferred', availableAt: verdict.availableAt });
  }
  return ok({ verdict, values, holds: await hold(tx, states, { estimate: request.estimate, at }) });
}

/**
 * Makes `call` to `request.service` only when no limit would be exceeded (TRV-04): a
 * call that would exceed a limit entered, or that a refusal still holds back, is not
 * made and comes back deferred with the instant it may be, a non-priority call leaving
 * the stats source's reserve to priority ones (STA-39); a deferral by a limit reached
 * opens "quota reached" (TRV-05). Calls made at once never share the last unit: each
 * holds its estimate from its check until its use is recorded, and the call runs
 * outside any transaction, which is why `db` is never one. After the call, records the
 * use its port reported in place of the estimate, a refusal for quota marking the limit
 * reached (TRV-03, TRV-06), and settles the incidents and the warning (CL-TRV-11). A
 * limit not entered is counted, never defers (CL-TRV-12).
 */
export async function withQuota<S extends QuotaService, O extends OutcomeOf[S]>(
  db: Database,
  request: QuotaRequest<S>,
  call: () => Promise<O>,
): Promise<Result<O, Deferred>> {
  const admission = await db.transaction(async (tx) => admit(tx, request, now()));
  if (!admission.ok) {
    return admission;
  }
  const { verdict, values, holds } = admission.value;
  const outcome = await call();
  const at = now();
  const usage = usageOf(request.service, outcome, at);
  await db.transaction(async (tx) => {
    await lockService(tx, request.service);
    await release(tx, holds);
    await addUsage(tx, request.service, { usage, at });
    await settle(tx, request.service, {
      at,
      values,
      resumed: verdict.resumes,
      refused: usage.refusal !== null,
    });
  });
  return ok(outcome);
}

/**
 * The instant from which a call of `service` may be made, which due computations use,
 * such as the classification queue's resumption: now when nothing holds it back, the
 * reset of the limit that defers it otherwise, or null when no reset makes room
 * (TRV-04, CL-TRV-12, CL-DET-04).
 */
export async function nextAvailableAt(
  db: Executor,
  service: QuotaService,
): Promise<EpochMs | null> {
  const { verdict } = await verdictOf(db, { service, estimate: {}, priority: false }, now());
  return verdict.availableAt;
}
