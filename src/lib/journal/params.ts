import { z } from 'zod';

import { incidents, taskRuns } from '@/lib/db';
import { formatDuration, formatInstant, toEpochMs } from '@/lib/time';
import { formatCount } from '@/lib/wording';

import {
  BLOCKING_ERROR_WORDS,
  CAUSE_WORDS,
  codesOf,
  CONVERSATION_WORDS,
  INCIDENT_NAMES,
  NOTIFICATION_CATEGORY_WORDS,
  SERVICE_LABELS,
  SERVICE_WORDS,
  TASK_NAMES,
  TRIGGER_WORDS,
  wordsFor,
} from './labels';

import type { ParamKind } from './message-types';
import type { EpochMs } from '@/lib/time';

// The two incident kinds whose name ends with the service they concern (glossary 9.2).
const QUOTA_INCIDENT_KINDS = ['quota_reached', 'quota_warning'] as const;

/** The kinds of the parameters of a message, and the values each holds (CL-TRV-10, DSN-11). */
const PARAM_SCHEMAS = {
  count: z.number().int().nonnegative(),
  instant: z
    .number()
    .int()
    .transform((value) => toEpochMs(value)),
  duration: z.number().nonnegative(),
  task: z.enum(taskRuns.taskKey.enumValues),
  trigger: z.enum(taskRuns.trigger.enumValues),
  service: z.enum(incidents.serviceRole.enumValues),
  incident: z.union([
    z.object({
      kind: z.enum(QUOTA_INCIDENT_KINDS),
      service: z.enum(incidents.serviceRole.enumValues),
    }),
    z.object({ kind: z.enum(incidents.kind.enumValues).exclude(QUOTA_INCIDENT_KINDS) }),
  ]),
  parameter: z.string(),
  value: z.string(),
  conversation: z.enum(codesOf(CONVERSATION_WORDS)),
  refusal: z.enum(codesOf(BLOCKING_ERROR_WORDS)),
  cause: z.enum(codesOf(CAUSE_WORDS)),
  notificationCategory: z.enum(codesOf(NOTIFICATION_CATEGORY_WORDS)),
  code: z.string(),
} as const satisfies Readonly<Record<ParamKind, z.ZodType>>;

type Schemas = typeof PARAM_SCHEMAS;

/**
 * The value each kind of parameter holds, as the caller of `record` gives it: counts,
 * instants, durations, the codes of stored sets, a parameter's label and its values as
 * the registry writes them, with their unit (TRV-42); never a player, a type, a date, a
 * description, a title, a link, a birthday or a request reference, which the display
 * reads through the entry's subject (CL-TRV-10, DSN-11).
 */
export type ParamValues = {
  readonly [K in ParamKind]: K extends 'instant' ? EpochMs : z.input<Schemas[K]>;
};

/** Writes a stored parameter for people, or says that it does not fit its kind. */
type Writer = (value: unknown, timeZone: string) => string | undefined;

/** The writer of the values that `schema` accepts. */
function writer<S extends z.ZodType>(
  schema: S,
  write: (value: z.output<S>, timeZone: string) => string,
): Writer {
  return (value, timeZone) => {
    const parsed = schema.safeParse(value);
    return parsed.success ? write(parsed.data, timeZone) : undefined;
  };
}

// A quota incident's name ends with its service: "Quota reached — Language model".
const writeIncident = (incident: z.output<Schemas['incident']>): string =>
  'service' in incident
    ? `${wordsFor(INCIDENT_NAMES, incident.kind)} — ${wordsFor(SERVICE_LABELS, incident.service)}`
    : wordsFor(INCIDENT_NAMES, incident.kind);

// How each kind reads in a sentence: an instant in the owner's zone, a code by its words.
const WRITERS: Readonly<Record<ParamKind, Writer>> = {
  count: writer(PARAM_SCHEMAS.count, (value) => formatCount(value)),
  instant: writer(PARAM_SCHEMAS.instant, (value, zone) => formatInstant(value, zone, 'short')),
  duration: writer(PARAM_SCHEMAS.duration, (value) => formatDuration(value)),
  task: writer(PARAM_SCHEMAS.task, (value) => wordsFor(TASK_NAMES, value)),
  trigger: writer(PARAM_SCHEMAS.trigger, (value) => wordsFor(TRIGGER_WORDS, value)),
  service: writer(PARAM_SCHEMAS.service, (value) => wordsFor(SERVICE_WORDS, value)),
  incident: writer(PARAM_SCHEMAS.incident, writeIncident),
  parameter: writer(PARAM_SCHEMAS.parameter, (value) => value),
  value: writer(PARAM_SCHEMAS.value, (value) => value),
  conversation: writer(PARAM_SCHEMAS.conversation, (value) => wordsFor(CONVERSATION_WORDS, value)),
  refusal: writer(PARAM_SCHEMAS.refusal, (value) => wordsFor(BLOCKING_ERROR_WORDS, value)),
  cause: writer(PARAM_SCHEMAS.cause, (value) => wordsFor(CAUSE_WORDS, value)),
  notificationCategory: writer(PARAM_SCHEMAS.notificationCategory, (value) =>
    wordsFor(NOTIFICATION_CATEGORY_WORDS, value),
  ),
  code: writer(PARAM_SCHEMAS.code, (value) => value),
};

/**
 * A stored parameter written for people, by the kind its message declares (TRV-42): a
 * count with its thousands separator, an instant in the owner's zone, a stored code by
 * its English words. A value that does not fit its kind, which only a damaged row can
 * hold, is shown as it is stored rather than hiding the whole entry.
 */
export function writeParam(kind: ParamKind, value: unknown, timeZone: string): string {
  return WRITERS[kind](value, timeZone) ?? JSON.stringify(value ?? null);
}
