// The quota guard around every outbound call (TRV-04): checked before the call against
// the service's limits, deferred instead of exceeding one, recorded after it (module
// map §2.1, quotas).
import { getParams } from '@/lib/params';
import { err, ok } from '@/lib/result';
import { now } from '@/lib/time';

import { check } from './check';
import { readStates } from './ledger';
import { SERVICES } from './limits';
import { syncReached } from './quota-incidents';
import { usageOf } from './readers';
import { addUsage, settle } from './record';

import type { Estimate, Verdict } from './check';
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

/** The verdict on `request` at `at`, with the values in force it was reached with. */
async function verdictOf(
  db: Executor,
  request: QuotaRequest<QuotaService>,
  at: EpochMs,
): Promise<Readonly<{ verdict: Verdict; values: ParamReader }>> {
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
  return { verdict, values };
}

/**
 * Makes `call` to `request.service` only when no limit would be exceeded (TRV-04): a
 * call that would exceed a limit entered, or that a refusal still holds back, is not
 * made and comes back deferred with the instant it may be, a non-priority call leaving
 * the stats source's reserve to priority ones (STA-39); a deferral by the app's count
 * opens "quota reached" (TRV-05). After the call, records the use its port reported, a
 * refusal for quota marking the limit reached (TRV-03, TRV-06), and settles the
 * incidents and the warning (CL-TRV-11). A limit not entered is counted, never defers
 * (CL-TRV-12).
 */
export async function withQuota<S extends QuotaService, O extends OutcomeOf[S]>(
  db: Executor,
  request: QuotaRequest<S>,
  call: () => Promise<O>,
): Promise<Result<O, Deferred>> {
  const { verdict, values } = await verdictOf(db, request, now());
  if (!verdict.allowed) {
    if (verdict.byCount) {
      const causes = new Set(['limit_reached'] as const);
      await db.transaction(async (tx) =>
        syncReached(tx, request.service, { at: now(), values, causes, resumed: false }),
      );
    }
    return err({ kind: 'deferred', availableAt: verdict.availableAt });
  }
  const outcome = await call();
  const at = now();
  const usage = usageOf(request.service, outcome, at);
  await db.transaction(async (tx) => {
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
