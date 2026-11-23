import { z } from 'zod';

import { deploymentId } from '@/lib/env';
import { runtimeCache } from '@/lib/runtime-cache';
import { toEpochMs } from '@/lib/time';

import { storedInstant } from './stored-values';

import type { CacheWrite } from '@/lib/runtime-cache';
import type { EpochMs } from '@/lib/time';

/** The keys of the scheduled tasks (module map §4), the only names that the plan holds. */
export const TASK_KEYS = [
  'statistics-update',
  'statistics-fetch',
  'calendar-derivation',
  'recalculation',
  'link-check',
  'purge',
  'backup',
  'news-collection',
  'detection',
  'classification-resume',
  'game-tracking',
  'notification-dispatch',
] as const;

/** A scheduled task, by its key (module map §4). */
export type TaskKey = (typeof TASK_KEYS)[number];

// The calls a tick may make without the database (module map §1.9): the stats
// source's refresh while the daily update waits for it, and Telegram polling while a
// link code is pending. A new kind is a coordinator decision (module map §9).
const PROBE_KINDS = ['stats-source-refresh', 'telegram-polling'] as const;

/** A call that a tick may make without the database (module map §1.9). */
export type ProbeKind = (typeof PROBE_KINDS)[number];

/** When a task is next due: the plan holds one entry per task (module map §1.9). */
export type WakeEntry = Readonly<{ task: TaskKey; dueAt: EpochMs }>;

/**
 * What a probe keeps between its calls, which its owner declares and the plan never
 * reads (coordinator decision, gap f): instants and counts as numbers, versions and
 * hashes as short texts, never personal data. It may hold no offset at all.
 */
export type ProbeState = Readonly<Record<string, number | string>>;

/** A call that a tick makes without the database from `dueAt` on, with its owner's state. */
export type WakeProbe = Readonly<{ kind: ProbeKind; dueAt: EpochMs; state: ProbeState }>;

/**
 * The wake plan (module map §1.9): the deployment that wrote it, `null` when the host
 * gives no deployment id; when the database pass computed it; when each task is next
 * due; and the probes a tick may make without the database. It holds task keys,
 * instants, counts, versions and hashes, never personal data.
 */
export type WakePlan = Readonly<{
  deploymentId: string | null;
  computedAt: EpochMs;
  entries: readonly WakeEntry[];
  probes: readonly WakeProbe[];
}>;

/** What a writer gives of the plan: the deployment that writes it is this one. */
export type PlanContent = Omit<WakePlan, 'deploymentId'>;

/** Why a tick must check the database: no plan it can trust, or no cache to read it from. */
export type PlanUnusable = Readonly<{
  kind: 'missing' | 'unreadable' | 'foreign' | 'stale' | 'unavailable';
}>;

/** A plan that a tick can trust, with its earliest due instant, or the reason to check the database. */
export type PlanReading =
  | Readonly<{ ok: true; plan: WakePlan; earliestDueAt: EpochMs | null }>
  | Readonly<{ ok: false; error: PlanUnusable }>;

/** The cache key of the plan. */
export const PLAN_KEY = 'wake:plan';

/** How old a plan may be before a tick checks the database anyway: the hourly safety check. */
export const PLAN_MAX_AGE_MS = 3_600_000;

// A day: the plan is never trusted beyond an hour, so this only bounds a forgotten entry.
const PLAN_TTL_SECONDS = 86_400;

// The longest text a probe keeps, enough for a source's version or a hexadecimal hash.
const PROBE_TEXT_MAX_LENGTH = 256;

const entrySchema = z.strictObject({ task: z.enum(TASK_KEYS), dueAt: storedInstant });

const probeValueSchema = z.union([z.int(), z.string().max(PROBE_TEXT_MAX_LENGTH)]);

const probeSchema = z.strictObject({
  kind: z.enum(PROBE_KINDS),
  dueAt: storedInstant,
  state: z.record(z.string(), probeValueSchema),
});

const planSchema = z.strictObject({
  deploymentId: z.string().nullable(),
  computedAt: storedInstant,
  entries: z.array(entrySchema),
  probes: z.array(probeSchema),
});

const unusable = (kind: PlanUnusable['kind']): PlanReading => ({ ok: false, error: { kind } });

/** The deployment id that this deployment's plans carry: the host's, or none (module map §1.9). */
const thisDeployment = (): string | null => deploymentId() ?? null;

/** The earliest due instant of `entries`, or `null` when no task is due. */
function earliestOf(entries: readonly WakeEntry[]): EpochMs | null {
  return entries.length === 0 ? null : toEpochMs(Math.min(...entries.map(({ dueAt }) => dueAt)));
}

/**
 * Reads the wake plan for a tick at `at`, without the database (module map §1.6 step 4,
 * §1.9): the plan, with its earliest due instant, when the tick can trust it; otherwise
 * the reason to check the database: no plan, one the cache garbled, one another
 * deployment wrote, one computed more than an hour away from `at` (the hourly safety
 * check, which runs the run check, TRV-31), or a cache that fails. Without a deployment
 * id from the host, plans carry none, and a new deployment is caught by the hourly check.
 */
export async function readPlan(at: EpochMs): Promise<PlanReading> {
  const read = await runtimeCache().get(PLAN_KEY);
  if (!read.ok) {
    return unusable('unavailable');
  }
  if (read.value === null) {
    return unusable('missing');
  }
  const parsed = planSchema.safeParse(read.value);
  if (!parsed.success) {
    return unusable('unreadable');
  }
  const plan = parsed.data;
  if (plan.deploymentId !== thisDeployment()) {
    return unusable('foreign');
  }
  if (Math.abs(at - plan.computedAt) > PLAN_MAX_AGE_MS) {
    return unusable('stale');
  }
  return { ok: true, plan, earliestDueAt: earliestOf(plan.entries) };
}

/**
 * Writes the wake plan in full, as this deployment's (module map §1.9): the database
 * pass at its end, with every due instant it computed (TRV-25), and a probe that moves
 * to its next instant, which keeps the plan's `computedAt` so that the hourly check
 * still comes. A content that `readPlan` could not read, such as a fraction or a text
 * too long in a probe's state, is a caller's bug that would send every tick to the
 * database, and throws without writing.
 */
export async function writePlan(content: PlanContent): Promise<CacheWrite> {
  const plan = planSchema.parse({ deploymentId: thisDeployment(), ...content });
  return runtimeCache().set(PLAN_KEY, plan, PLAN_TTL_SECONDS);
}
