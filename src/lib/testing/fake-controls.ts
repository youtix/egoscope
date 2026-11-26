import { z } from 'zod';

import { fakeBackupStorage } from '@/lib/backup-storage';
import { fakeLinkCheck } from '@/lib/link-check';
import { err, ok } from '@/lib/result';
import { processFakeRuntimeCache } from '@/lib/runtime-cache';
import { fakeStatsSource } from '@/lib/stats-source';
import { PLAN_KEY } from '@/lib/wake-plan';

import { control, invalidCommand, plain } from './commands';
import { lot2FakeControls, LOT_2_CONTROLS } from './fake-controls-lot2';
import { isoInstant } from './fixed-clock';

import type { Control, InvalidCommand } from './commands';
import type { Result } from '@/lib/result';

/**
 * The controls of the process's fakes, which the tests and the hermetic end-to-end
 * control `/api/test/fakes` script (TRV-15, TRV-47): the runtime cache's, which evict
 * the wake plan, lose everything the cache held, or make the cache unavailable or
 * available again; and the fakes of the statistics source, the link check and the
 * backup storage, then those of Lot 2, the press feeds, the language model and Telegram
 * (TRV-16, TRV-17, TRV-18), each with its own controls.
 */
export const fakeControls = {
  runtimeCache: {
    evictWakePlan: () => {
      processFakeRuntimeCache().evict(PLAN_KEY);
    },
    loseWakePlan: () => {
      processFakeRuntimeCache().loseAll();
    },
    setAvailable: (isAvailable: boolean) => {
      processFakeRuntimeCache().setAvailable(isAvailable);
    },
  },
  statsSource: fakeStatsSource,
  linkCheck: fakeLinkCheck,
  backupStorage: fakeBackupStorage,
  // --- Lot 2 (F-test-support-lot2): the controls of the press feeds, the language model and Telegram.
  ...lot2FakeControls,
} as const;

const count = z.int().nonnegative();
const fault = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['outage', 'slow']), times: count }),
  z.object({ kind: z.literal('rate_limited'), afterCalls: count, retryAfterMs: count.nullable() }),
  z.object({
    kind: z.enum(['schema_changed', 'not_published']),
    resource: z.enum(['season_games', 'season_box_scores', 'season_players', 'player_records']),
    season: z.string(),
  }),
]);
const linkAnswer = z.union([
  z.object({ status: z.int() }),
  z.object({ redirectTo: z.url() }),
  z.enum(['timeout', 'unresolved']),
]);
const storageError = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('unauthorized'),
    cause: z.enum(['not_configured', 'token_rejected']),
  }),
  z.object({ kind: z.enum(['not_found', 'too_large', 'rate_limited', 'unavailable']) }),
]);
const storageOperation = z.enum([
  'checkHealth',
  'ensureContainer',
  'upload',
  'list',
  'delete',
  'download',
]);
// The arguments of the controls that take some.
const availability = z.object({ available: z.boolean() });
const injection = z.object({ fault });
const refresh = z.object({ at: isoInstant });
const scriptedLink = z.object({ url: z.url(), answer: linkAnswer });
const storageAccess = z.object({ access: z.enum(['granted', 'token_expired', 'not_configured']) });
const storagePrivacy = z.object({ private: z.boolean() });
const scriptedFailure = z.object({
  operation: storageOperation,
  error: storageError,
  rateLimitResetsAt: isoInstant.optional(),
});

// Every control of `/api/test/fakes`, by its name, `<fake>.<control>`.
const CONTROL_LIST: readonly (readonly [string, Control])[] = [
  ['runtime-cache.evict-wake-plan', plain(fakeControls.runtimeCache.evictWakePlan)],
  ['runtime-cache.lose-wake-plan', plain(fakeControls.runtimeCache.loseWakePlan)],
  [
    'runtime-cache.set-available',
    control(availability, ({ available }) => {
      fakeControls.runtimeCache.setAvailable(available);
    }),
  ],
  [
    'stats-source.inject',
    control(injection, (args) => {
      fakeStatsSource().inject(args.fault);
    }),
  ],
  [
    'stats-source.clear-faults',
    plain(() => {
      fakeStatsSource().clearFaults();
    }),
  ],
  [
    'stats-source.refresh',
    control(refresh, ({ at }) => {
      fakeStatsSource().refresh(at);
    }),
  ],
  [
    'link-check.answer',
    control(scriptedLink, ({ url, answer }) => {
      fakeLinkCheck().answer(url, answer);
    }),
  ],
  [
    'link-check.reset',
    plain(() => {
      fakeLinkCheck().reset();
    }),
  ],
  [
    'backup-storage.set-access',
    control(storageAccess, ({ access }) => {
      fakeBackupStorage().setAccess(access);
    }),
  ],
  [
    'backup-storage.set-private',
    control(storagePrivacy, (args) => {
      fakeBackupStorage().setPrivate(args.private);
    }),
  ],
  [
    'backup-storage.fail-next',
    control(scriptedFailure, ({ operation, error, rateLimitResetsAt }) => {
      fakeBackupStorage().failNext(operation, error, rateLimitResetsAt);
    }),
  ],
  [
    'backup-storage.interrupt-next-upload',
    plain(() => {
      fakeBackupStorage().interruptNextUpload();
    }),
  ],
  [
    'backup-storage.keep-next-deletion',
    plain(() => {
      fakeBackupStorage().keepNextDeletion();
    }),
  ],
  // Lot 2 (F-test-support-lot2): the controls of the press feeds, the language model and Telegram.
  ...LOT_2_CONTROLS,
];
const CONTROLS = new Map(CONTROL_LIST);
const CONTROL_NAMES = CONTROL_LIST.map(([name]) => name).join(', ');

// The control that a command names, with its name.
const namedControl = z.object({
  control: z.string().transform((name, context) => {
    const run = CONTROLS.get(name);
    if (run === undefined) {
      context.addIssue({
        code: 'custom',
        message: `Expected a control of a fake: ${CONTROL_NAMES}.`,
      });
      return z.NEVER;
    }
    return { name, run };
  }),
});

/** The control that `/api/test/fakes` ran, by its name, with what the fake answered when it answers. */
export type ScriptedFake = Readonly<{ ran: string; answer?: unknown }>;

/**
 * Scripts a fake of the process as a command of `/api/test/fakes` says (TRV-15):
 * `{ "control": "<fake>.<control>", ...arguments }`, instants in ISO 8601 with their
 * offset. Gives the name of the control run, with what the fake answered when it
 * answers, such as the messages of a Telegram chat, or why the command is invalid,
 * running nothing.
 */
export function scriptFake(command: unknown): Result<ScriptedFake, InvalidCommand> {
  const named = namedControl.safeParse(command);
  if (!named.success) {
    return err(invalidCommand(named.error));
  }
  const { name, run } = named.data.control;
  const ran = run(command);
  if (!ran.ok) {
    return err(invalidCommand(ran.error));
  }
  return ok(ran.value === undefined ? { ran: name } : { ran: name, answer: ran.value });
}
