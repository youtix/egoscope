import 'server-only';

import { io } from 'next/cache';
import { notFound } from 'next/navigation';

import { getDb } from '@/lib/db';
import { logger } from '@/lib/log';
import { paths } from '@/lib/navigation';
import { getParam } from '@/lib/params';
import { getType, sheetHistory, versionCounters } from '@/lib/taxonomy';
import { formatInstant } from '@/lib/time';
import {
  Card,
  DefinitionList,
  EmptyState,
  GlossaryTerm,
  LinkButton,
  Notice,
  StatusPill,
} from '@/lib/ui';
import { formatCount, sentence } from '@/lib/wording';

import type { SheetChangeContent, SheetHistoryEntry, VersionCounters } from '@/lib/taxonomy';
import type { ReactNode } from 'react';

type Scope = NonNullable<VersionCounters['substantiveScope']>;

const DIFFICULTIES: ReadonlyMap<string, string> = new Map([
  ['easy', sentence('taxonomy.difficultyEasy')],
  ['medium', sentence('taxonomy.difficultyMedium')],
  ['hard', sentence('taxonomy.difficultyHard')],
]);

const CRITERIA: ReadonlyMap<string, string> = new Map([
  ['playing_time_too_low', sentence('taxonomy.criterionPlayingTimeTooLow')],
  ['injury_return', sentence('taxonomy.criterionInjuryReturn')],
  ['unusual_stakes', sentence('taxonomy.criterionUnusualStakes')],
  ['opponent_strength', sentence('taxonomy.criterionOpponentStrength')],
  ['co_occurring', sentence('taxonomy.criterionCoOccurring')],
]);

/** The written kind of a version (TAX-20, TAX-27, CL-TAX-06). */
function versionKindLabel(kind: VersionCounters['kind']): string {
  switch (kind) {
    case 'validation': {
      return sentence('taxonomy.versionKindValidation');
    }
    case 'substantive_change': {
      return sentence('taxonomy.substantiveChange');
    }
    case 'merge': {
      return sentence('taxonomy.versionKindMerge');
    }
  }
}

/** The written kind of an entry of the change history (TAX-21, CL-TAX-17). */
function changeKindLabel(kind: SheetHistoryEntry['changeKind']): string {
  switch (kind) {
    case 'formal': {
      return sentence('taxonomy.changeKindFormal');
    }
    case 'substantive': {
      return sentence('taxonomy.substantiveChange');
    }
    case 'criterion_switch': {
      return sentence('taxonomy.changeKindCriterionSwitch');
    }
  }
}

/** The written scope of a substantive change (TAX-22). */
function scopeLabel(scope: Scope): string {
  switch (scope) {
    case 'broadens': {
      return sentence('taxonomy.scopeBroadens');
    }
    case 'narrows': {
      return sentence('taxonomy.scopeNarrows');
    }
    case 'both': {
      return sentence('taxonomy.scopeBoth');
    }
  }
}

const NONE = sentence('taxonomy.valueNone');
const YES = sentence('taxonomy.valueYes');
const NO = sentence('taxonomy.valueNo');

type ContentField = Readonly<{
  key: keyof SheetChangeContent;
  label: string;
  /** The written form of each stored value of a field that holds a closed set. */
  values?: ReadonlyMap<string, string>;
}>;

// The fields of a sheet and of its criterion switch, in the order a sheet shows them.
const CONTENT_FIELDS: readonly ContentField[] = [
  { key: 'name', label: sentence('taxonomy.fieldName') },
  { key: 'definition', label: sentence('taxonomy.fieldDefinition') },
  { key: 'inclusionCriteria', label: sentence('taxonomy.fieldInclusionCriteria') },
  { key: 'exclusionCriteria', label: sentence('taxonomy.fieldExclusionCriteria') },
  { key: 'datingRule', label: sentence('taxonomy.fieldDatingRule') },
  { key: 'knownInAdvance', label: sentence('taxonomy.fieldKnownInAdvance') },
  { key: 'genericExample', label: sentence('taxonomy.fieldExample') },
  {
    key: 'documentationDifficulty',
    label: sentence('taxonomy.fieldDocumentationDifficulty'),
    values: DIFFICULTIES,
  },
  { key: 'cautionNotes', label: sentence('taxonomy.fieldCautionNotes') },
  { key: 'isIntimateSubject', label: sentence('taxonomy.fieldIntimateSubject') },
  {
    key: 'coverageThresholdOutlets',
    label: sentence('taxonomy.fieldCoverageThresholdOutlets'),
  },
  { key: 'coverageThresholdDays', label: sentence('taxonomy.fieldCoverageThresholdDays') },
  {
    key: 'switchedOffCriterion',
    label: sentence('taxonomy.fieldCriterionSwitchedOff'),
    values: CRITERIA,
  },
];

/** A field's value as the owner reads it: empty, yes or no, a count, a closed value's label, or the text. */
function valueText(
  field: ContentField,
  value: SheetChangeContent[keyof SheetChangeContent],
): string {
  if (value === null) {
    return NONE;
  }
  if (typeof value === 'boolean') {
    return value ? YES : NO;
  }
  if (typeof value === 'number') {
    return formatCount(value);
  }
  return field.values?.get(value) ?? value;
}

/** The content before and after of a history entry, on demand: the fields that the change touched (TAX-21). */
function ContentChange({ entry }: Readonly<{ entry: SheetHistoryEntry }>): ReactNode {
  const touched = CONTENT_FIELDS.filter(
    (field) => entry.before[field.key] !== entry.after[field.key],
  );
  return (
    <details>
      <summary className="flex min-h-touch cursor-pointer items-center font-medium underline underline-offset-4">
        {sentence('taxonomy.showContentChange')}
      </summary>
      <DefinitionList
        items={touched.map((field) => ({
          term: field.label,
          details: (
            <div className="flex flex-col gap-1">
              <p>
                <span className="font-medium">{sentence('taxonomy.contentBefore')}</span>{' '}
                {valueText(field, entry.before[field.key])}
              </p>
              <p>
                <span className="font-medium">{sentence('taxonomy.contentAfter')}</span>{' '}
                {valueText(field, entry.after[field.key])}
              </p>
            </div>
          ),
        }))}
      />
    </details>
  );
}

type VersionItemProps = Readonly<{ version: VersionCounters; zone: string; isFirst: boolean }>;

/** One version with its date, kind, scope, reason and the four counts that stay visible whatever happens next (TAX-26). */
function VersionItem({ version, zone, isFirst }: VersionItemProps): ReactNode {
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold">
          <GlossaryTerm term="sheetVersion" plain={!isFirst} /> {formatCount(version.versionNumber)}
        </p>
        <StatusPill label={versionKindLabel(version.kind)} />
        {version.substantiveScope !== null && (
          <StatusPill label={scopeLabel(version.substantiveScope)} tone="info" />
        )}
      </div>
      <DefinitionList
        items={[
          {
            term: sentence('taxonomy.versionDate'),
            details: formatInstant(version.createdAt, zone, 'short'),
          },
          { term: sentence('taxonomy.versionReason'), details: version.reason ?? NONE },
          {
            term: sentence('taxonomy.countConforms'),
            details: formatCount(version.requalifiedConformingCount),
          },
          {
            term: sentence('taxonomy.countReassigned'),
            details: formatCount(version.reassignedCount),
          },
          { term: sentence('taxonomy.countErased'), details: formatCount(version.erasedCount) },
          {
            term: sentence('taxonomy.countSupplements'),
            details: formatCount(version.supplementaryRequestsProposedCount),
          },
        ]}
      />
    </li>
  );
}

type HistoryItemProps = Readonly<{ entry: SheetHistoryEntry; zone: string }>;

/** One entry of the modification history: its date, qualification and reason, and its content on demand (TAX-21). */
function HistoryItem({ entry, zone }: HistoryItemProps): ReactNode {
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold">{formatInstant(entry.changedAt, zone, 'short')}</p>
        <StatusPill label={changeKindLabel(entry.changeKind)} />
        {entry.substantiveScope !== null && (
          <StatusPill label={scopeLabel(entry.substantiveScope)} tone="info" />
        )}
      </div>
      <DefinitionList
        items={[{ term: sentence('taxonomy.versionReason'), details: entry.reason ?? NONE }]}
      />
      <ContentChange entry={entry} />
    </li>
  );
}

type NoVersionProps = Readonly<{ typeId: string; isProposal: boolean }>;

/** What a type that was never validated shows instead of versions, with the action that fills it (TAX-20, IHM-56). */
function NoVersion({ typeId, isProposal }: NoVersionProps): ReactNode {
  const reason = isProposal
    ? sentence('taxonomy.noVersionProposed')
    : sentence('taxonomy.noVersionRejected');
  return (
    <EmptyState
      title={sentence('taxonomy.noVersionTitle')}
      reason={reason}
      action={
        isProposal ? (
          <LinkButton
            href={paths.validateType(typeId)}
            label={sentence('taxonomy.validateTypeAction')}
          />
        ) : null
      }
    />
  );
}

/**
 * The versions of a type's sheet, each with its number, date, kind (a substantive change
 * with its scope), reason and the four counts that no later edit hides, and below them the
 * modification history with the content before and after on demand (TAX-20, TAX-21,
 * TAX-26, CL-TAX-06, CA-TAX-14). A proposal has no version, and the block says so with the
 * action that creates the first one (IHM-56). An unknown type is a missing page; a
 * database that fails is told in words, never hidden (IHM-16).
 */
export async function VersionsBlock({ typeId }: Readonly<{ typeId: string }>): Promise<ReactNode> {
  // The versions are read at the time of the request, never in a prerender.
  await io();
  const database = await getDb();
  if (!database.ok) {
    logger.error('The versions of a type could not be read.', { cause: database.error.kind });
    return <Notice tone="danger" message={sentence('taxonomy.versionsUnavailable')} />;
  }
  const { db } = database;
  const [type, versions, history, zone] = await Promise.all([
    getType(db, typeId),
    versionCounters(db, typeId),
    sheetHistory(db, typeId),
    getParam(db, 'display.timeZone'),
  ]);
  if (type === null) {
    notFound();
  }
  if (versions.length === 0) {
    return <NoVersion typeId={typeId} isProposal={type.status === 'proposed'} />;
  }
  return (
    <>
      <Card title={sentence('taxonomy.versionsTitle')}>
        <ol className="flex flex-col gap-3">
          {versions.map((version, index) => (
            <VersionItem
              key={version.versionNumber}
              version={version}
              zone={zone}
              isFirst={index === 0}
            />
          ))}
        </ol>
      </Card>
      <Card title={sentence('taxonomy.changeHistoryTitle')}>
        {history.length === 0 ? (
          <EmptyState
            title={sentence('taxonomy.noChangeTitle')}
            reason={sentence('taxonomy.noChangeReason')}
            headingLevel="h3"
          />
        ) : (
          <ol className="flex flex-col gap-3">
            {history.map((entry) => (
              <HistoryItem
                key={`${String(entry.changedAt)}-${entry.changeKind}`}
                entry={entry}
                zone={zone}
              />
            ))}
          </ol>
        )}
      </Card>
    </>
  );
}
