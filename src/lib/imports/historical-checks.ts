// The checks of a historical correction (IMP-32, CL-IMP-31): the event that the correction
// would leave, run through the import's checks of IMP-11 to IMP-14 against the player's
// NBA career. They sit apart from historical-edit.ts only to keep each file within the
// size limits.
import 'server-only';

import { checkEvents } from '@/lib/ai-exchange';
import { firstNbaGame } from '@/lib/games';
import { getParams } from '@/lib/params';
import { err, ok } from '@/lib/result';
import { cleanLink } from '@/lib/stats-engine';
import { resolveTypeId } from '@/lib/taxonomy';
import {
  canonicalTimeZone,
  localOccurrenceInstant,
  now,
  parseIsoDate,
  parseTimeOfDay,
  toEpochMs,
  toIsoDate,
  toZoned,
  userDay,
} from '@/lib/time';

import type {
  AcceptedEvent,
  CheckedSource,
  DateReading,
  EventCheck,
  EventCheckContext,
  ExchangeDate,
  ImportIgnoreReason,
  ImportRefusal,
  ImportWarning,
  ResearchEvent,
  ResearchSource,
  SourceWarning,
  TaxonomyType,
} from '@/lib/ai-exchange';
import type { Transaction } from '@/lib/db';
import type {
  CorrectedSource,
  DateOrInstant,
  EventChanges,
  EventCorrection,
  HistoricalEvent,
  PublicDate,
} from '@/lib/events';
import type { ParamReader } from '@/lib/params';
import type { Result } from '@/lib/result';
import type { TypeResolution } from '@/lib/taxonomy';
import type { EpochMs } from '@/lib/time';

/**
 * A date as the owner types it (CL-IMP-31): a day written `YYYY-MM-DD`, an optional time
 * written `HH:MM`, and with a time its time zone, his own (`display.timeZone`) when none
 * is given.
 */
export type TypedDate = Readonly<{ on: string; time: string | null; timeZone: string | null }>;

/** A source as the owner types it: its link, outlet and title as written, and its publication date. */
export type TypedSource = Readonly<{
  url: string;
  outlet: string | null;
  title: string | null;
  publication: TypedDate;
}>;

/**
 * A correction as the edit screen sends it, with the `row_version` it showed (CL-IHM-18):
 * each field given replaces the stored value, a field left out keeps it. `sources` lists
 * every source the event keeps: one left out is removed.
 */
export type HistoricalCorrection = Pick<
  EventChanges,
  | 'playerId'
  | 'eventTypeId'
  | 'description'
  | 'injuryReturn'
  | 'gameStakes'
  | 'researchConfidence'
  | 'unverifiedNote'
> &
  Readonly<{
    expectedVersion: number;
    publicDate?: TypedDate;
    sources?: readonly TypedSource[];
  }>;

/**
 * A check of IMP-11 to IMP-14 that the corrected event fails, under the code that the
 * import gives it (IMP-32): a refusal, a reason to ignore the event, a source that the
 * import would not keep, or more sources than an import keeps (`backtests.maxSourcesPerEvent`).
 */
export type CorrectionProblem =
  | Readonly<{ kind: 'refused'; refusal: ImportRefusal }>
  | Readonly<{ kind: 'ignored'; reason: ImportIgnoreReason }>
  | Extract<SourceWarning, Readonly<{ kind: 'source_dropped' }>>
  | Readonly<{ kind: 'too_many_sources'; maxSourcesPerEvent: number }>;

/** The checks that a correction fails, each with the import's code. */
export type FailedChecks = Readonly<{
  kind: 'failed_checks';
  problems: readonly CorrectionProblem[];
}>;

type SourceDrop = Extract<CorrectionProblem, Readonly<{ kind: 'source_dropped' }>>;

const UTC = 'UTC';
const MS_PER_MINUTE = 60_000;
// The career has no lower bound while the first NBA game is unknown (CL-IMP-31): every
// calendar date written YYYY-MM-DD sorts after this one.
const NO_LOWER_BOUND = '0000-01-01';
// Any status but validated makes the checks ignore an event alike (IMP-11): the one that
// stands for a type the owner cannot choose, not validated, absorbed by a merge or split.
const NOT_CHOOSABLE = 'proposed';

/** A date as read, with its text. */
function reading(text: string, date: ExchangeDate): DateReading {
  return { ok: true, text, date, warning: undefined };
}

/** The offset from UTC, in minutes, of `zone` at `at`. */
function offsetAt(at: EpochMs, zone: string): number {
  const local = toZoned(at, zone);
  return (localOccurrenceInstant(local.on, local.time, UTC) - at) / MS_PER_MINUTE;
}

/**
 * A date typed by the owner as the checks read it (CL-IMP-31): its time, 00:00 included,
 * read in its zone, his own by default; a day, a time or a zone that cannot be read makes
 * it malformed or nonexistent, as at an import.
 */
function typedReading(typed: TypedDate, ownerZone: string): DateReading {
  const day = parseIsoDate(typed.on);
  if (!day.ok) {
    return { ok: false, error: { kind: day.error.kind, text: typed.on } };
  }
  if (typed.time === null) {
    return reading(typed.on, { kind: 'date', on: day.on });
  }
  const time = parseTimeOfDay(typed.time);
  if (!time.ok) {
    return { ok: false, error: { kind: time.error.kind, text: typed.time } };
  }
  const zoneName = typed.timeZone ?? ownerZone;
  const zone = canonicalTimeZone(zoneName);
  if (!zone.ok) {
    return { ok: false, error: { kind: 'malformed', text: zoneName } };
  }
  const at = localOccurrenceInstant(day.on, typed.time, zone.zone);
  const offsetMinutes = offsetAt(at, zone.zone);
  return reading(`${typed.on}T${typed.time}`, { kind: 'instant', on: day.on, at, offsetMinutes });
}

/** A stored date as the checks read it. */
function storedReading(date: DateOrInstant): DateReading {
  return date.at === null
    ? reading(date.on, { kind: 'date', on: date.on })
    : reading(date.on, { kind: 'instant', ...date });
}

/** A source as the checks read it: its texts as written, and its publication date as read. */
function researchSource(
  source: Readonly<{ url: string; outlet: string | null; title: string | null }>,
  publicationDate: DateReading,
): ResearchSource {
  const { url, outlet, title } = source;
  return { url, outlet: outlet ?? undefined, title: title ?? undefined, publicationDate };
}

/**
 * The event as the correction would leave it, as the checks read it: its context, its
 * research confidence and its unverified note left out, since they refuse nothing (IMP-15)
 * and `applyCorrection` checks the note (DSN-20, DSN-21).
 */
function correctedEvent(
  event: HistoricalEvent,
  correction: HistoricalCorrection,
  ownerZone: string,
): ResearchEvent {
  const { publicDate, sources } = correction;
  const description = (correction.description ?? event.description).trim();
  return {
    eventType: correction.eventTypeId ?? event.eventTypeId,
    publicDate:
      publicDate === undefined
        ? storedReading(event.referenceDate)
        : typedReading(publicDate, ownerZone),
    description: description === '' ? undefined : description,
    sources:
      sources === undefined
        ? event.sources.map((source) =>
            researchSource(source, storedReading(source.publicationDate)),
          )
        : sources.map((source) =>
            researchSource(source, typedReading(source.publication, ownerZone)),
          ),
    context: { injuryReturn: undefined, gameStakes: undefined, detail: undefined },
    researchConfidence: undefined,
    unverifiedNote: undefined,
  };
}

/** The type as the checks know it (IMP-11): only a validated type is one the owner can choose. */
function taxonomyOf(resolution: TypeResolution): readonly TaxonomyType[] {
  switch (resolution.kind) {
    case 'unknown': {
      return [];
    }
    case 'validated': {
      return [{ id: resolution.typeId, standing: 'research', status: 'validated' }];
    }
    case 'calendar_derived': {
      return [{ id: resolution.typeId, standing: 'calendar_derived' }];
    }
    case 'not_validated':
    case 'merged':
    case 'split': {
      return [{ id: resolution.typeId, standing: 'research', status: NOT_CHOOSABLE }];
    }
  }
}

/**
 * What the checks of a correction depend on (IMP-32, CL-IMP-31): the type of the event as
 * the only one requested, over the player's NBA career up to the owner's day of the
 * correction, from his first NBA game or with no lower bound while it is unknown; the
 * parameters of the import, and the instant of the correction (CL-IMP-10). The covered
 * types and the sheet version only give warnings and a version that a correction does not
 * keep, `applyCorrection` stamping the version in force (CL-TAX-22): none is declared
 * covered, and the version is the event's own.
 */
async function checkContext(
  tx: Transaction,
  event: HistoricalEvent,
  of: Readonly<{ eventType: string; params: ParamReader }>,
): Promise<EventCheckContext> {
  const { params } = of;
  const taxonomy = taxonomyOf(await resolveTypeId(tx, of.eventType));
  const sheetVersion = event.sheetVersionNumber;
  const at = now();
  const career = { startOn: NO_LOWER_BOUND, endOn: userDay(at, params.get('display.timeZone')) };
  const first = await firstNbaGame(tx, event.playerId);
  return {
    taxonomy,
    requestedTypes: taxonomy.map(({ id }) => ({ id, period: career, sheetVersion })),
    coveredTypes: [],
    declaredPeriod: career,
    firstNbaGameOn: first?.firstNbaGameOn,
    splitChoices: [],
    maxDescriptionLength: params.get('events.maxDescriptionLength'),
    maxSourcesPerEvent: params.get('backtests.maxSourcesPerEvent'),
    maxSourceLeadDays: params.get('imports.maxSourceLeadDays'),
    sourceRules: {
      cleanLink,
      disallowedDomains: params.get('imports.disallowedSourceDomains'),
      checkedAt: at,
    },
  };
}

/** The sources that the import would not keep, each with its position and cause (IMP-14). */
function droppedSources(warnings: readonly ImportWarning[]): readonly SourceDrop[] {
  return warnings.filter((warning): warning is SourceDrop => warning.kind === 'source_dropped');
}

/**
 * The accepted event, or the problems of its check (IMP-11 to IMP-14, IMP-19), followed
 * by the `others` that the correction has besides.
 */
function verdict(
  check: EventCheck,
  others: readonly CorrectionProblem[],
): Result<AcceptedEvent, readonly CorrectionProblem[]> {
  if (check.outcome === 'ignored') {
    return err([{ kind: 'ignored', reason: check.reason }, ...others]);
  }
  const dropped = [...droppedSources(check.warnings), ...others];
  if (check.outcome === 'refused') {
    const refusals = check.refusals.map((refusal): CorrectionProblem => ({
      kind: 'refused',
      refusal,
    }));
    return err([...refusals, ...dropped]);
  }
  return dropped.length > 0 ? err(dropped) : ok(check.event);
}

/** A date that the checks accepted, as `events` stores it (CL-IMP-09). */
function publicDateOf(date: ExchangeDate): PublicDate {
  const on = toIsoDate(date.on);
  return date.kind === 'date'
    ? { on, at: null }
    : { on, at: toEpochMs(date.at), offsetMinutes: date.offsetMinutes };
}

/** A source that the checks kept, with its cleaned link (CL-IMP-14, CL-IMP-25). */
function correctedSource(source: CheckedSource): CorrectedSource {
  const { url, cleanedUrl, outlet, title } = source;
  const publication = publicDateOf(source.publicationDate);
  return { url, cleanedUrl, outlet: outlet ?? null, title: title ?? null, publication };
}

/**
 * The correction of the historical event `event` that `events.applyCorrection` takes,
 * once the event it would leave passes the import's checks of IMP-11 to IMP-14 against
 * the player's NBA career up to the owner's day (IMP-32, CL-IMP-31), or every check it
 * fails, with the import's code: its typed dates read in their zones, and its sources
 * trimmed, with their cleaned links, oldest first (CL-IMP-14, CL-IMP-16).
 */
export async function checkedCorrection(
  tx: Transaction,
  event: HistoricalEvent,
  correction: HistoricalCorrection,
): Promise<Result<EventCorrection, FailedChecks>> {
  const params = await getParams(tx);
  const corrected = correctedEvent(event, correction, params.get('display.timeZone'));
  const eventType = correction.eventTypeId ?? event.eventTypeId;
  const context = await checkContext(tx, event, { eventType, params });
  const { maxSourcesPerEvent } = context;
  const others: readonly CorrectionProblem[] =
    corrected.sources.length > maxSourcesPerEvent
      ? [{ kind: 'too_many_sources', maxSourcesPerEvent }]
      : [];
  const results = checkEvents([corrected], context).map((check) => verdict(check, others));
  const [accepted] = results.flatMap((result) => (result.ok ? [result.value] : []));
  if (accepted === undefined) {
    const problems = results.flatMap((result) => (result.ok ? [] : result.error));
    return err({ kind: 'failed_checks', problems });
  }
  const { publicDate, sources, ...plain } = correction;
  return ok({
    ...plain,
    ...(publicDate !== undefined && { publicDate: publicDateOf(accepted.publicDate) }),
    ...(sources !== undefined && {
      sources: accepted.sources.map((kept) => correctedSource(kept)),
    }),
  });
}
