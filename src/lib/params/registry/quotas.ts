import { entriesOf } from '../entry';
import { integer, quotaLimit } from '../kinds';
import { HOURS, MEGABYTES, MESSAGES, noun, PERCENT, REQUESTS } from '../units';

import type { EntryDefinition, FamilyEntries, Lot } from '../entry';
import type { Unit } from '../units';

// The shares of 14 Cross-cutting requirements (module map §6, CL-TRV-16). A quota limit
// has no default: the owner enters the value its service sheet gives (CL-TRV-12).
const WARNING_SHARE = 80;
const HIGHEST_WARNING_SHARE = 99;

const lotOne = entriesOf(1);
const lotTwo = entriesOf(2);
const NEURONS = noun('neuron', 'neurons');
const TOKENS = noun('token', 'tokens');

/** The limit of one service, unset until the owner enters it (TRV-03, CL-TRV-16). */
function limit(
  definition: Pick<EntryDefinition<number | null>, 'unit' | 'source'> &
    Readonly<{ service: string; measure: string; of: Unit; lot?: Lot; reference?: true }>,
) {
  const entry = definition.lot === 2 ? lotTwo : lotOne;
  const use =
    definition.reference === true
      ? 'the status screen shows it as a reference, which the app does not enforce'
      : 'the app keeps its use within it';
  return entry({
    label: `Quota limits per service — ${definition.service}, ${definition.measure}`,
    sentence: `The ${definition.measure} that ${definition.service} allows; ${use}.`,
    unit: definition.unit,
    kind: quotaLimit(definition.of),
    defaultValue: null,
    requirement: 'TRV-03',
    source: definition.source,
  });
}

const STATS_SOURCE = { service: 'the stats source', source: 'statistics-source sheet' } as const;
const WORKERS_AI = { service: 'Workers AI', source: 'detection-model sheet', lot: 2 } as const;
const GROQ = { service: 'Groq', source: 'detection-model sheet', lot: 2 } as const;
const DATABASE = { service: 'the database', source: 'database sheet' } as const;
const HOSTING = { service: 'the host', source: 'hosting sheet', reference: true } as const;
const BACKUP_STORAGE = { service: 'the backup storage', source: 'backup storage sheet' } as const;
const MONTHLY = 'per calendar month from 00:00 UTC on the 1st';

/** The quotas of 14 Cross-cutting requirements (TRV-03 to TRV-07). */
export const QUOTAS = {
  'quotas.statsSource.requestsPerDay': limit({
    ...STATS_SOURCE,
    measure: 'requests a day',
    of: REQUESTS,
    unit: 'file requests answered 200 or 304, the redirect not counted, per UTC day, reset at 00:00 UTC',
  }),
  'quotas.statsSource.megabytesPerDay': limit({
    ...STATS_SOURCE,
    measure: 'megabytes a day',
    of: MEGABYTES,
    unit: 'MB downloaded, per UTC day, reset at 00:00 UTC',
  }),
  'quotas.workersAi.neuronsPerDay': limit({
    ...WORKERS_AI,
    measure: 'neurons a day',
    of: NEURONS,
    unit: 'neurons, reset at 00:00 UTC',
  }),
  'quotas.workersAi.requestsPerMinute': limit({
    ...WORKERS_AI,
    measure: 'requests a minute',
    of: REQUESTS,
    unit: 'requests, per minute (a rate)',
  }),
  'quotas.groq.requestsPerMinute': limit({
    ...GROQ,
    measure: 'requests a minute',
    of: REQUESTS,
    unit: 'requests, over a rolling minute',
  }),
  'quotas.groq.requestsPerDay': limit({
    ...GROQ,
    measure: 'requests a day',
    of: REQUESTS,
    unit: "requests a day, reset at the instant Groq's x-ratelimit-reset-requests header reports",
  }),
  'quotas.groq.tokensPerMinute': limit({
    ...GROQ,
    measure: 'tokens a minute',
    of: TOKENS,
    unit: "tokens (cached tokens not counted), reset at the instant Groq's x-ratelimit-reset-tokens header reports",
  }),
  'quotas.groq.tokensPerDay': limit({
    ...GROQ,
    measure: 'tokens a day',
    of: TOKENS,
    unit: 'tokens (cached tokens not counted), over a rolling 24 hours',
  }),
  'quotas.database.capacityMegabytes': limit({
    ...DATABASE,
    measure: 'capacity in megabytes',
    of: MEGABYTES,
    unit: 'MB (a capacity, no period)',
  }),
  'quotas.database.computeHoursPerMonth': limit({
    ...DATABASE,
    measure: 'compute-hours a month',
    of: noun('compute-hour', 'compute-hours'),
    unit: `compute-hours (the app's estimate at 0.25 CU; Neon's console is the authority), ${MONTHLY}`,
  }),
  'quotas.database.transferMegabytesPerMonth': limit({
    ...DATABASE,
    reference: true,
    measure: 'transfer megabytes a month',
    of: MEGABYTES,
    unit: `MB of egress (reference: not measured), ${MONTHLY}`,
  }),
  'quotas.hosting.invocationsPerMonth': limit({
    ...HOSTING,
    measure: 'invocations a month',
    of: noun('invocation', 'invocations'),
    unit: `invocations (reference, metered by the host), ${MONTHLY}`,
  }),
  'quotas.hosting.activeCpuHoursPerMonth': limit({
    ...HOSTING,
    measure: 'active CPU hours a month',
    of: HOURS,
    unit: `active CPU hours (reference, metered by the host), ${MONTHLY}`,
  }),
  'quotas.hosting.memoryGbHoursPerMonth': limit({
    ...HOSTING,
    measure: 'memory GB-hours a month',
    of: noun('GB-hour', 'GB-hours'),
    unit: `GB-hours of memory (reference, metered by the host), ${MONTHLY}`,
  }),
  'quotas.hosting.runtimeCacheReadsPerMonth': limit({
    ...HOSTING,
    measure: 'runtime cache reads a month',
    of: noun('read', 'reads'),
    unit: `runtime cache reads (reference, metered by the host), ${MONTHLY}`,
  }),
  'quotas.hosting.runtimeCacheWritesPerMonth': limit({
    ...HOSTING,
    measure: 'runtime cache writes a month',
    of: noun('write', 'writes'),
    unit: `runtime cache writes (reference, metered by the host), ${MONTHLY}`,
  }),
  'quotas.hosting.schedulesRunsPerMonth': limit({
    service: 'the host',
    source: 'scheduler sheet',
    reference: true,
    measure: 'scheduled runs a month',
    of: noun('run', 'runs'),
    unit: `scheduled runs (reference, metered by the host), ${MONTHLY}`,
  }),
  'quotas.telegram.messagesPerSecond': limit({
    service: 'Telegram',
    source: 'telegram sheet',
    lot: 2,
    measure: 'messages a second',
    of: MESSAGES,
    unit: 'messages in one chat, per second (a rate, no reset)',
  }),
  'quotas.backupStorage.maxFileMegabytes': limit({
    ...BACKUP_STORAGE,
    measure: 'megabytes a file',
    of: MEGABYTES,
    unit: 'MB per asset (a size, no period)',
  }),
  'quotas.backupStorage.requestsPerHour': limit({
    ...BACKUP_STORAGE,
    reference: true,
    measure: 'requests an hour',
    of: REQUESTS,
    unit: "requests (reference), per hourly window reset at the instant GitHub's x-ratelimit-reset header reports",
  }),
  'quotas.warningShare': lotOne({
    label: 'Quota warning share',
    sentence: 'A warning is given when the use of a quota reaches this share of its limit.',
    unit: '% of a limit',
    kind: integer(1, HIGHEST_WARNING_SHARE, PERCENT),
    defaultValue: WARNING_SHARE,
    requirement: 'TRV-05',
    source: 'H-TRV-02',
  }),
  'quotas.databaseWarningShare': lotOne({
    label: 'Database volume warning share',
    sentence: "A warning is given when the database's volume reaches this share of its capacity.",
    unit: '% of the capacity',
    kind: integer(1, HIGHEST_WARNING_SHARE, PERCENT),
    defaultValue: WARNING_SHARE,
    requirement: 'TRV-07',
    source: 'H-TRV-03',
  }),
} as const satisfies FamilyEntries<'quotas'>;
