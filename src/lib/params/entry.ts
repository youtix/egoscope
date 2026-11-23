import type { ValueKind } from './kinds';
import type { OVERRIDABLE_PARAMETER_KEYS } from '@/lib/db';

/** A key of the registry that holds a value, which an override may change (TRV-34, TRV-38). */
export type OverridableKey = (typeof OVERRIDABLE_PARAMETER_KEYS)[number];

/** Where a parameter's default comes from, the glossary's `ParameterOrigin` (TRV-34). */
export type ParameterOrigin = 'journal_decision' | 'journal_hypothesis' | 'local_hypothesis';

/** The lot that reads a parameter (ADR 0001): a Lot 2 one is hidden while only Lot 1 runs (CL-IHM-23). */
export type Lot = 1 | 2;

/** The spec file of each requirement prefix, its owning document (TRV-34, TRV-38). */
const SPEC_FILES = {
  JOU: '01',
  TAX: '02',
  COL: '03',
  DET: '04',
  BKT: '05',
  IMP: '06',
  STA: '07',
  SEN: '08',
  ALE: '09',
  SUI: '10',
  TEL: '11',
  IHM: '12',
  DSN: '13',
  TRV: '14',
} as const;

/** The number of a spec file, "01" to "14". */
export type SpecFile = (typeof SPEC_FILES)[keyof typeof SPEC_FILES];

/** A requirement of the specs, the one that defines a parameter: "JOU-04". */
export type Requirement = `${keyof typeof SPEC_FILES}-${string}`;

/**
 * The screen where a parameter is edited when it is not the parameters screen: the time
 * zone and the research tool's address under Display (CL-IHM-23), the per-type criterion
 * switch on the types (CL-TRV-17).
 */
export type EditScreen = '/settings/display' | '/types';

/** What every entry of the registry says of its parameter (TRV-34, TRV-38, CL-TRV-16). */
export type EntryFacts = Readonly<{
  /** Its name, glossary section 9.3, which the journal and the screens show. */
  label: string;
  /** What it sets, in one plain sentence. */
  sentence: string;
  /** Its unit, as module map section 6 states it. */
  unit: string;
  /** Its allowed values, inclusive (CL-TRV-16), as the screen and a refusal state them. */
  allowed: string;
  /** Its owning spec file and the requirement that defines it. */
  file: SpecFile;
  requirement: Requirement;
  /** The decision, hypothesis, ruling or service sheet that gives its default, and its kind. */
  source: string;
  origin: ParameterOrigin;
  /** A change moves the date of the last calculation change and recalculates (CL-TRV-17). */
  affectsCalculations: boolean;
  /** A change moves a due instant, so it invalidates the wake plan (module map §1.9). */
  movesSchedule: boolean;
  lot: Lot;
  /** Bounds of the engineering, where no spec or ruling gives one. */
  engineeringBounds: boolean;
  /** The screen where it is edited, when it is not the parameters screen. */
  editedOn: EditScreen | null;
}>;

/** One parameter of the registry: its facts, how its values are checked, its default. */
export type RegistryEntry<V> = EntryFacts &
  Readonly<{
    kind: ValueKind<V>;
    defaultValue: V;
  }>;

/**
 * The entries of one family of keys, `players` for `players.*`: every key of the family
 * and no other, which the type check holds each family file to.
 */
export type FamilyEntries<F extends string> = Readonly<
  Record<Extract<OverridableKey, `${F}.${string}`>, RegistryEntry<unknown>>
>;

/** An entry as a family file writes it: what is not stated takes the usual value. */
export type EntryDefinition<V> = Readonly<{
  label: string;
  sentence: string;
  unit: string;
  kind: ValueKind<V>;
  defaultValue: NoInfer<V>;
  requirement: Requirement;
  source: string;
  /** What CL-TRV-16 adds to the bounds of the kind: ", at most the maximum". */
  boundsNote?: string;
  affectsCalculations?: boolean;
  movesSchedule?: boolean;
  lot?: Lot;
  engineeringBounds?: boolean;
  editedOn?: EditScreen;
}>;

/**
 * The origin that the source of a default gives (TRV-34): a decision record of the owner
 * is a decision; a hypothesis of the decision journal, H-03, a journal hypothesis; a
 * hypothesis of one spec file, H-JOU-01, a ruling or a service sheet, a local hypothesis
 * to be confirmed.
 */
export function originOf(source: string): ParameterOrigin {
  if (/^ADR \d{4}$/u.test(source)) {
    return 'journal_decision';
  }
  return /^H-\d+$/u.test(source) ? 'journal_hypothesis' : 'local_hypothesis';
}

const FILES_BY_PREFIX: ReadonlyMap<string, SpecFile> = new Map(Object.entries(SPEC_FILES));

/** The owning spec file of `requirement`, by its prefix; a prefix of no spec file is a bug. */
export function fileOf(requirement: Requirement): SpecFile {
  const file = FILES_BY_PREFIX.get(requirement.slice(0, requirement.indexOf('-')));
  if (file === undefined) {
    throw new Error(`${requirement} is no requirement of a spec file.`);
  }
  return file;
}

/** The facts that a definition states, with the usual values of those it leaves out. */
export function factsOf(
  definition: Omit<EntryDefinition<never>, 'kind' | 'defaultValue'> & Readonly<{ allowed: string }>,
  lot: Lot,
): EntryFacts {
  return {
    label: definition.label,
    sentence: definition.sentence,
    unit: definition.unit,
    allowed: `${definition.allowed}${definition.boundsNote ?? ''}`,
    file: fileOf(definition.requirement),
    requirement: definition.requirement,
    source: definition.source,
    origin: originOf(definition.source),
    affectsCalculations: definition.affectsCalculations ?? false,
    movesSchedule: definition.movesSchedule ?? false,
    lot: definition.lot ?? lot,
    engineeringBounds: definition.engineeringBounds ?? false,
    editedOn: definition.editedOn ?? null,
  };
}

/** The writer of the entries of a family whose parameters `lot` reads, unless one says otherwise. */
export function entriesOf(lot: Lot): <V>(definition: EntryDefinition<V>) => RegistryEntry<V> {
  return (definition) => ({
    ...factsOf({ ...definition, allowed: definition.kind.allowed }, lot),
    kind: definition.kind,
    defaultValue: definition.defaultValue,
  });
}
