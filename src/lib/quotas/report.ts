// The quota use in plain words for the status screen (TRV-46, CL-TRV-12): each limit's
// use against its value with its reset in the owner's zone, the month's compute
// estimate, each limit not entered yet, and the reference values the app does not
// enforce.
import { getParams, listRegistry } from '@/lib/params';
import { formatInstant, now, toZoned } from '@/lib/time';
import { formatCount, formatDecimal, sentence } from '@/lib/wording';

import { computeEstimate } from './compute';
import { readStates } from './ledger';
import { isShareReached, QUOTA_SERVICES, REFERENCE_KEYS, scaleOf, SERVICES } from './limits';
import { allowanceOf } from './quota-incidents';

import type { ComputeEstimate } from './compute';
import type { LimitState } from './ledger';
import type { FixedUnit, LimitKey, QuotaService, Window } from './limits';
import type { Database, Transaction } from '@/lib/db';
import type { Lot, ParameterKey, ParamReader, RegistryRow } from '@/lib/params';
import type { EpochMs } from '@/lib/time';

type Executor = Database | Transaction;

/** A limit's status, glossary `QuotaStatus` (TRV-04 to TRV-06). */
export type QuotaStatus = 'normal' | 'warning' | 'reached';

/**
 * One line of the report: a quota limit's use with its status; a rate's use, which has
 * no status, since the guard keeps a rate by spacing its calls and it never warns nor
 * reaches (TRV-05); a limit not entered yet, which fails the installation check
 * (CL-TRV-12); or a reference value.
 */
export type UsageLine =
  | Readonly<{ kind: 'usage'; key: LimitKey; status: QuotaStatus; text: string }>
  | Readonly<{ kind: 'rate'; key: LimitKey; text: string }>
  | Readonly<{ kind: 'not_entered' | 'reference'; key: LimitKey; text: string }>;

const DAY_MS = 86_400_000;
const COMPUTE_DECIMALS = 1;
const COMPUTE_KEY = 'quotas.database.computeHoursPerMonth';

const SERVICE_NAMES = {
  statsSource: 'crossCutting.quotaServiceStatsSource',
  workersAi: 'crossCutting.quotaServiceWorkersAi',
  groq: 'crossCutting.quotaServiceGroq',
  backupStorage: 'crossCutting.quotaServiceBackupStorage',
  telegram: 'crossCutting.quotaServiceTelegram',
} as const;

/** The service whose counted limit is `key`. */
const SERVICE_OF: ReadonlyMap<string, QuotaService> = new Map(
  QUOTA_SERVICES.flatMap((service) =>
    SERVICES[service].limits.map((limit) => [limit.key, service] as const),
  ),
);

/** What a usage sentence says: the service, the use and the limit written, the reset. */
type UsageParts = Readonly<{ service: string; used: string; limit: string; resetsAt: EpochMs }>;

/** The period a fixed or reported window is read as: Groq reports a minute and a day. */
function unitOf(window: Exclude<Window, Readonly<{ kind: 'rolling' }>>): FixedUnit {
  if (window.kind === 'fixed') {
    return window.unit;
  }
  return window.lengthMs < DAY_MS ? 'minute' : 'day';
}

/** The sentence of a limit's use over its window, its reset in `zone` (TRV-46). */
function usageText(window: Window, parts: UsageParts, zone: string): string {
  const { service, used, limit } = parts;
  if (window.kind === 'rolling') {
    return window.lengthMs < DAY_MS
      ? sentence('crossCutting.quotaUseLastMinute', { service, used, limit })
      : sentence('crossCutting.quotaUseLast24Hours', { service, used, limit });
  }
  const { time } = toZoned(parts.resetsAt, zone);
  switch (unitOf(window)) {
    case 'second': {
      return sentence('crossCutting.quotaUseThisSecond', { service, used, limit });
    }
    case 'minute': {
      return sentence('crossCutting.quotaUseThisMinute', { service, used, limit, time });
    }
    case 'day': {
      return sentence('crossCutting.quotaUseToday', { service, used, limit, time });
    }
    case 'month': {
      const date = formatInstant(parts.resetsAt, zone, 'short');
      return sentence('crossCutting.quotaUseThisMonth', { service, used, limit, date });
    }
  }
}

/** The status of a quota limit: reached by its count or a refusal that holds, at its warning share, or normal. */
function statusOf(state: LimitState, values: ParamReader): QuotaStatus {
  const allowance = allowanceOf(state, values) ?? Infinity;
  if (state.blockedUntil !== null || state.used >= allowance) {
    return 'reached';
  }
  const share = values.get('quotas.warningShare');
  return isShareReached(state.used, allowance, share) ? 'warning' : 'normal';
}

/** What the report reads for its usage lines: the counted limits' states, the compute estimate. */
type ReportData = Readonly<{
  states: ReadonlyMap<string, LimitState>;
  compute: ComputeEstimate;
  values: ParamReader;
  zone: string;
}>;

/** The line of the compute estimate against its limit written `written` (TRV-03, TRV-05). */
function computeLine(key: LimitKey, written: string, data: ReportData): UsageLine {
  const parts = {
    service: sentence('crossCutting.quotaServiceDatabase'),
    used: formatDecimal(data.compute.computeHours, COMPUTE_DECIMALS),
    limit: written,
    resetsAt: data.compute.month.end,
  };
  return {
    kind: 'usage',
    key,
    status: data.compute.warning ? 'warning' : 'normal',
    text: usageText({ kind: 'fixed', unit: 'month' }, parts, data.zone),
  };
}

/** The usage line of the entered limit `key`, written `written`, if the report shows its use. */
function usageLine(key: LimitKey, written: string, data: ReportData): UsageLine[] {
  if (key === COMPUTE_KEY) {
    return [computeLine(key, written, data)];
  }
  const state = data.states.get(key);
  const service = SERVICE_OF.get(key);
  if (state === undefined || service === undefined) {
    return [];
  }
  const parts = {
    service: sentence(SERVICE_NAMES[service]),
    used: formatCount(Math.floor(state.used / scaleOf(state.limit.measure))),
    limit: written,
    resetsAt: state.blockedUntil ?? state.period.end,
  };
  const text = usageText(state.limit.window, parts, data.zone);
  return state.limit.rate
    ? [{ kind: 'rate', key, text }]
    : [{ kind: 'usage', key, status: statusOf(state, data.values), text }];
}

/** The line of the registry row of the limit `key`: not entered, a reference, or its use. */
function lineOf(row: RegistryRow, key: LimitKey, data: ReportData): UsageLine[] {
  const { setting, label } = row;
  if (setting?.value === null || setting?.value === undefined) {
    const text = sentence('crossCutting.quotaLimitNotEntered', { limit: label });
    return [{ kind: 'not_entered', key, text }];
  }
  if (REFERENCE_KEYS.has(key)) {
    const value = setting.written;
    const text = sentence('crossCutting.quotaReferenceValue', { limit: label, value });
    return [{ kind: 'reference', key, text }];
  }
  return usageLine(key, setting.written, data);
}

/** Whether `key` is a quota limit, rather than one of the warning shares. */
function isLimitKey(key: ParameterKey): key is LimitKey {
  return (
    key.startsWith('quotas.') &&
    key !== 'quotas.warningShare' &&
    key !== 'quotas.databaseWarningShare'
  );
}

/**
 * The quota use in plain words for the status screen, in the order of the parameter
 * registry, for the parameters of the lots up to `display.lot`: "Workers AI: 4,120 of
 * 10,000 neurons today, resets at 01:00", the reset in `display.timeZone`, with its
 * status, a rate's without one (TRV-05); the month's
 * compute estimate; each limit not entered yet, which the installation check reports;
 * and each reference value, which the app does not enforce (TRV-03, TRV-04, TRV-46,
 * CL-TRV-12).
 */
export async function usageReport(
  db: Executor,
  display: Readonly<{ timeZone: string; lot: Lot }>,
): Promise<readonly UsageLine[]> {
  const at = now();
  const rows = await listRegistry(db, display.lot);
  const limits = QUOTA_SERVICES.flatMap((service) => SERVICES[service].limits);
  const states = await readStates(db, limits, at);
  const data = {
    states: new Map(states.map((state) => [state.limit.key, state] as const)),
    compute: await computeEstimate(db, at),
    values: await getParams(db),
    zone: display.timeZone,
  };
  return rows.flatMap((row) => (isLimitKey(row.key) ? lineOf(row, row.key, data) : []));
}
