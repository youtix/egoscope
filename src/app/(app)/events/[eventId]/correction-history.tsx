import { formatInstant, parseTimestamp } from '@/lib/time';
import { sentence } from '@/lib/wording';

import { correctionFieldLabel, INDICATION_LABELS, PRECISION_LABELS } from './event-labels';

import type { CorrectionEntry } from './queries';
import type { ReactElement } from 'react';

export type CorrectionHistoryProps = Readonly<{
  entries: readonly CorrectionEntry[];
  /** The names of the types and players that the kept values designate, by identifier. */
  names: ReadonlyMap<string, string>;
  /** The owner's zone, which the page states once at its top (CL-IHM-04). */
  zone: string;
}>;

const INDICATIONS: ReadonlyMap<string, string> = new Map(Object.entries(INDICATION_LABELS));
const PRECISIONS: ReadonlyMap<string, string> = new Map(Object.entries(PRECISION_LABELS));
// A kept reference date has three parts, of which the history writes the first two.
const VALUE_PARTS = 3;

/** A value that the service writes in one form only, found in another: a bug. */
function unknownForm(entry: CorrectionEntry, value: string): never {
  throw new Error(`The correction ${String(entry.id)} kept a value in an unknown form: ${value}.`);
}

/** A kept reference date, `<ISO instant> <precision> <rule>`, as its instant and its precision. */
function referenceDateValue(entry: CorrectionEntry, value: string, zone: string): string {
  const [instant = '', precision = ''] = value.split(' ', VALUE_PARTS);
  const parsed = parseTimestamp(instant);
  const label = PRECISIONS.get(precision);
  if (label === undefined || !parsed.ok || parsed.timestamp.kind !== 'instant') {
    return unknownForm(entry, value);
  }
  const date = formatInstant(parsed.timestamp.at, zone, 'short');
  return sentence('interface.datedValue', { date, precision: label });
}

/** A kept value of `entry`, written for the owner: a label, a date or a name. */
function valueOf(entry: CorrectionEntry, value: string, props: CorrectionHistoryProps): string {
  if (entry.field === 'injury_return' || entry.field === 'game_stakes') {
    return INDICATIONS.get(value) ?? unknownForm(entry, value);
  }
  if (entry.field === 'reference_date') {
    return referenceDateValue(entry, value, props.zone);
  }
  return props.names.get(value) ?? sentence('interface.indicationUnknown');
}

/** One entry: its instant, its field, and the values it kept before and after (CL-DSN-15). */
function entryText(entry: CorrectionEntry, props: CorrectionHistoryProps): string {
  const date = formatInstant(entry.correctedAt, props.zone, 'short');
  const field = correctionFieldLabel(entry.field);
  const written = (value: string | null) =>
    value === null ? sentence('interface.indicationUnknown') : valueOf(entry, value, props);
  return entry.before === null && entry.after === null
    ? sentence('interface.correctionEntry', { date, field })
    : sentence('interface.correctionWithValues', {
        date,
        field,
        before: written(entry.before),
        after: written(entry.after),
      });
}

/**
 * An event's correction history, oldest first: the instant of each correction, the field
 * or the action it names, and for a detected event's structured fields and a calendar-
 * derived event's context the values before and after it, never an earlier free text
 * (IMP-32, DET-52, CL-DSN-15).
 */
export function CorrectionHistory(props: CorrectionHistoryProps): ReactElement | string {
  if (props.entries.length === 0) {
    return sentence('interface.neverCorrected');
  }
  return (
    <ol className="flex flex-col gap-1">
      {props.entries.map((entry) => (
        <li key={entry.id}>{entryText(entry, props)}</li>
      ))}
    </ol>
  );
}
