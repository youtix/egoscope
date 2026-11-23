// The limits of each guarded service, with what each counts and how its period runs, as
// the service sheets give them (TRV-03, CL-TRV-12). The values are parameters of the
// `quotas` family: none is written here.
import type { ServiceRole } from '@/lib/incidents';
import type { OverridableKey } from '@/lib/params';

/** A quota limit's parameter key, such as `quotas.workersAi.neuronsPerDay` (TRV-03). */
export type LimitKey = Exclude<
  Extract<OverridableKey, `quotas.${string}`>,
  'quotas.warningShare' | 'quotas.databaseWarningShare'
>;

/** What a limit counts: requests, bytes (its limit in megabytes), tokens, neurons or messages. */
export type Measure = 'requests' | 'bytes' | 'tokens' | 'neurons' | 'messages';

/** A fixed period on UTC boundaries, the month from 00:00 UTC on the 1st (CL-TRV-12). */
export type FixedUnit = 'second' | 'minute' | 'day' | 'month';

/**
 * How a limit's period runs (CL-TRV-12): a fixed period on its declared boundary; a
 * rolling window counted in one-minute buckets, which no provider reports; or a window
 * whose reset the provider reports with its answers, of a nominal length until it does.
 */
export type Window =
  | Readonly<{ kind: 'fixed'; unit: FixedUnit }>
  | Readonly<{ kind: 'rolling'; lengthMs: number }>
  | Readonly<{ kind: 'reported'; lengthMs: number }>;

/** A limit that is counted per period (TRV-03, TRV-04). */
export type CountedLimit = Readonly<{
  key: LimitKey;
  measure: Measure;
  window: Window;
  /** False for a reference value, counted but never a reason to defer a call. */
  enforced: boolean;
}>;

/** The services that `withQuota` guards, by the names of their parameters (TRV-03). */
export const QUOTA_SERVICES = [
  'statsSource',
  'workersAi',
  'groq',
  'backupStorage',
  'telegram',
] as const;

/** A service that `withQuota` guards. */
export type QuotaService = (typeof QUOTA_SERVICES)[number];

/** A guarded service: its role in incidents, its counted limits and its rules (TRV-04 to TRV-06). */
export type ServiceDeclaration = Readonly<{
  role: ServiceRole;
  limits: readonly CountedLimit[];
  /** The service's size limit of one call, checked against the call's estimate of bytes. */
  callSizeKey: LimitKey | null;
  /** Whether non-priority calls leave the stats source's reserve to priority ones (STA-39). */
  reserve: boolean;
  /** Whether its incident closes as soon as its requests resume (STA-39, CL-STA-15). */
  closesOnResume: boolean;
}>;

/** The bytes of a megabyte, the unit of the size limits and of the stats source's daily volume. */
export const BYTES_PER_MEGABYTE = 1_000_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const fixed = (unit: FixedUnit): Window => ({ kind: 'fixed', unit });
const counted = (key: LimitKey, measure: Measure, window: Window): CountedLimit => ({
  key,
  measure,
  window,
  enforced: true,
});
const plain = { callSizeKey: null, reserve: false, closesOnResume: false };
const languageModel = { ...plain, role: 'language_model' } as const;

/** Each guarded service and its limits, as its service sheet gives them (CL-TRV-12). */
export const SERVICES: Readonly<Record<QuotaService, ServiceDeclaration>> = {
  statsSource: {
    ...plain,
    role: 'stats_source',
    reserve: true,
    closesOnResume: true,
    limits: [
      counted('quotas.statsSource.requestsPerDay', 'requests', fixed('day')),
      counted('quotas.statsSource.megabytesPerDay', 'bytes', fixed('day')),
    ],
  },
  workersAi: {
    ...languageModel,
    limits: [
      counted('quotas.workersAi.neuronsPerDay', 'neurons', fixed('day')),
      counted('quotas.workersAi.requestsPerMinute', 'requests', fixed('minute')),
    ],
  },
  groq: {
    ...languageModel,
    limits: [
      counted('quotas.groq.requestsPerMinute', 'requests', {
        kind: 'rolling',
        lengthMs: MINUTE_MS,
      }),
      counted('quotas.groq.requestsPerDay', 'requests', { kind: 'reported', lengthMs: DAY_MS }),
      counted('quotas.groq.tokensPerMinute', 'tokens', { kind: 'reported', lengthMs: MINUTE_MS }),
      counted('quotas.groq.tokensPerDay', 'tokens', { kind: 'rolling', lengthMs: DAY_MS }),
    ],
  },
  backupStorage: {
    ...plain,
    role: 'backup_storage',
    callSizeKey: 'quotas.backupStorage.maxFileMegabytes',
    limits: [
      {
        key: 'quotas.backupStorage.requestsPerHour',
        measure: 'requests',
        window: { kind: 'reported', lengthMs: HOUR_MS },
        enforced: false,
      },
    ],
  },
  telegram: {
    ...plain,
    role: 'notifications',
    limits: [counted('quotas.telegram.messagesPerSecond', 'messages', fixed('second'))],
  },
};

/** The units of `measure` in one unit of its limit: a megabyte's bytes, else one. */
export function scaleOf(measure: Measure): number {
  return measure === 'bytes' ? BYTES_PER_MEGABYTE : 1;
}

/**
 * The values that the status screen shows as references, which the app does not enforce
 * (TRV-03; hosting, database and backup storage sheets).
 */
export const REFERENCE_KEYS: ReadonlySet<LimitKey> = new Set<LimitKey>([
  'quotas.database.transferMegabytesPerMonth',
  'quotas.hosting.invocationsPerMonth',
  'quotas.hosting.activeCpuHoursPerMonth',
  'quotas.hosting.memoryGbHoursPerMonth',
  'quotas.hosting.runtimeCacheReadsPerMonth',
  'quotas.hosting.runtimeCacheWritesPerMonth',
  'quotas.hosting.schedulesRunsPerMonth',
  'quotas.backupStorage.requestsPerHour',
]);

/** The guarded services that share `role`, whose warning is one incident (TRV-05). */
export function servicesOf(role: ServiceRole): readonly QuotaService[] {
  return QUOTA_SERVICES.filter((service) => SERVICES[service].role === role);
}
