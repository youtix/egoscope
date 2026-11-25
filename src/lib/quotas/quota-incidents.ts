// The quota incidents of each service (TRV-05, TRV-06, CL-TRV-11): the warning at the
// warning share, and "quota reached" with its causes, opened, updated and closed as its
// causes come and go; never for the language models, whose one incident `detection`
// keeps (CL-DET-04, CL-DET-05).
import { close, listOpen, open, updateQuotaCauses } from '@/lib/incidents';
import { valueAt } from '@/lib/params';

import { reachedSince, rowEnd, writeRow } from './ledger';
import { isShareReached, scaleOf, SERVICES } from './limits';
import { followingEnd } from './periods';

import type { LimitState } from './ledger';
import type { QuotaService } from './limits';
import type { Transaction } from '@/lib/db';
import type { OpenIncident, QuotaIncidentCause, ServiceRole } from '@/lib/incidents';
import type { ParamReader } from '@/lib/params';
import type { EpochMs } from '@/lib/time';

/** What a quota sync knows: the instant and the values in force. */
export type SyncContext = Readonly<{ at: EpochMs; values: ParamReader }>;

/** The causes found by a check or a call, and whether the service's work resumed. */
export type ReachedFindings = Readonly<{
  causes: ReadonlySet<QuotaIncidentCause>;
  /** A call was made without the reserve: deferred work resumes (STA-39, CL-TRV-11). */
  resumed: boolean;
}>;

const CAUSE_ORDER: readonly QuotaIncidentCause[] = [
  'limit_reached',
  'refused_before_limit',
  'not_answering',
];

/** The value in force of a limit in the units of its measure, null while not entered. */
export function allowanceOf(state: LimitState, values: ParamReader): number | null {
  const value = values.get(state.limit.key);
  return value === null ? null : value * scaleOf(state.limit.measure);
}

/** The allowance of a limit that warns and reaches as a quota: entered, enforced, not a rate (TRV-05). */
function quotaAllowanceOf(state: LimitState, values: ParamReader): number | null {
  const { enforced, rate } = state.limit;
  return enforced && !rate ? allowanceOf(state, values) : null;
}

/** Whether the limit of `state` is reached by the app's own count, a rate never (TRV-05). */
export function isReachedByCount(state: LimitState, values: ParamReader): boolean {
  const allowance = quotaAllowanceOf(state, values);
  return allowance !== null && state.used >= allowance;
}

/**
 * Whether every refusal before the declared limit since `incident` opened has cleared:
 * the owner saved a new value for that limit, or a full period passed after the refused
 * one without another (CL-TRV-11).
 */
async function areRefusalsCleared(
  tx: Transaction,
  service: QuotaService,
  context: SyncContext & Readonly<{ incident: OpenIncident }>,
): Promise<boolean> {
  const { limits } = SERVICES[service];
  const rows = await reachedSince(tx, limits, context.incident.openedAt);
  for (const limit of limits) {
    const value = context.values.get(limit.key);
    const refusal = rows.findLast(
      (row) =>
        row.key === limit.key && (value === null || row.used < value * scaleOf(limit.measure)),
    );
    if (refusal?.reachedAt === undefined || refusal.reachedAt === null) {
      continue;
    }
    const isSaved = (await valueAt(tx, limit.key, refusal.reachedAt)) !== value;
    const isQuiet = context.at >= followingEnd(limit.window, rowEnd(limit.window, refusal));
    if (!isSaved && !isQuiet) {
      return false;
    }
  }
  return true;
}

/** The causes of the open `incident` that remain once the service's work resumed or not (CL-TRV-11). */
async function remaining(
  tx: Transaction,
  service: QuotaService,
  context: SyncContext & ReachedFindings & Readonly<{ incident: OpenIncident }>,
): Promise<readonly QuotaIncidentCause[]> {
  if (!context.resumed) {
    return context.incident.quotaCauses;
  }
  if (SERVICES[service].closesOnResume) {
    return [];
  }
  const wasRefused = context.incident.quotaCauses.includes('refused_before_limit');
  return wasRefused && !(await areRefusalsCleared(tx, service, context))
    ? ['refused_before_limit']
    : [];
}

/**
 * Opens, updates or closes the `quota_reached` incident of `service` in the caller's
 * transaction `tx` (TRV-05, TRV-06, CL-TRV-11, STA-39): it opens with the causes found;
 * once work resumes, a limit counted as reached is gone, the stats source's incident
 * closes, and a refusal before the declared limit stays until it clears; nothing for
 * the language models (CL-DET-04, CL-DET-05).
 */
export async function syncReached(
  tx: Transaction,
  service: QuotaService,
  context: SyncContext & ReachedFindings,
): Promise<void> {
  const { role } = SERVICES[service];
  if (role === 'language_model') {
    return;
  }
  const opened = await listOpen(tx);
  const incident = opened.find(
    (each) => each.kind === 'quota_reached' && each.serviceRole === role,
  );
  const kept = incident === undefined ? [] : await remaining(tx, service, { ...context, incident });
  const [first, ...rest] = CAUSE_ORDER.filter(
    (cause) => kept.includes(cause) || context.causes.has(cause),
  );
  if (first === undefined) {
    if (incident !== undefined) {
      await close(tx, { kind: 'quota_reached', serviceRole: role });
    }
  } else if (incident === undefined) {
    await open(tx, {
      kind: 'quota_reached',
      serviceRole: role,
      quotaCauses: [first, ...rest],
      since: context.at,
    });
  } else if ([first, ...rest].join(',') !== incident.quotaCauses.join(',')) {
    await updateQuotaCauses(tx, role, [first, ...rest]);
  }
}

/**
 * Gives the warning of `role` in the caller's transaction `tx` when a limit of its
 * services reaches `quotas.warningShare` of its value, noted once per limit and period
 * instance, and ends it when no limit is there any longer: the period renewed; a rate,
 * which the guard paces, never warns (TRV-05, CL-TRV-12). `context.states` are the
 * states of the role's limits at `context.at`, read by the caller once its use is written.
 */
export async function syncWarning(
  tx: Transaction,
  role: ServiceRole,
  context: SyncContext & Readonly<{ states: readonly LimitState[] }>,
): Promise<void> {
  const share = context.values.get('quotas.warningShare');
  const over = context.states.filter((state) => {
    const allowance = quotaAllowanceOf(state, context.values);
    return allowance !== null && isShareReached(state.used, allowance, share);
  });
  for (const state of over) {
    if (state.rows.at(-1)?.warningGivenAt === null) {
      await writeRow(tx, state, { at: context.at, warningGivenAt: context.at });
    }
  }
  await (over.length > 0
    ? open(tx, { kind: 'quota_warning', serviceRole: role })
    : close(tx, { kind: 'quota_warning', serviceRole: role }));
}
