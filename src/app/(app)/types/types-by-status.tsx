import { paths } from '@/lib/navigation';
import { EmptyState, GlossaryTerm, LinkButton, PageHeader, TextLink } from '@/lib/ui';
import { formatCount, label, sentence } from '@/lib/wording';

import type { EventTypeOrigin, EventTypeStatus, ListedType, StatusGroup } from '@/lib/taxonomy';
import type { SentenceKey } from '@/lib/wording';
import type { ReactNode } from 'react';

// The states in the order of the Types screen (IHM-31), and the order without a validated
// type, which puts the proposals to review first (IHM-55).
const SCREEN_ORDER: readonly EventTypeStatus[] = ['validated', 'proposed', 'rejected', 'withdrawn'];
const PROPOSALS_FIRST: readonly EventTypeStatus[] = [
  'proposed',
  'validated',
  'rejected',
  'withdrawn',
];

// The fewest validated research types that a merge takes (TAX-27); calendar-derived types
// take part in none (CL-TAX-20).
const MERGE_MINIMUM = 2;

// The UI label of each origin of the EventTypeOrigin set (TAX-15, glossary section 4.1).
const ORIGIN_LABELS = {
  scoping: 'taxonomy.originScoping',
  exploration: 'taxonomy.originExploration',
  detection: 'taxonomy.originDetection',
} as const satisfies Record<EventTypeOrigin, SentenceKey>;

const isCalendarDerived = (type: ListedType): boolean => type.calendarDerivation !== null;

/** One fact of a listed type: its term, muted, and its value beside it. */
function Fact({ term, details }: Readonly<{ term: ReactNode; details: string }>): ReactNode {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-ink-muted">{term}</dt>
      <dd>{details}</dd>
    </div>
  );
}

type TypeItemProps = Readonly<{
  type: ListedType;
  /** Whether the "Dating rule" label is a later occurrence of the term on the screen. */
  plainDatingRule: boolean;
}>;

/** A type of a group: its name, which opens its sheet, its origin and, for a calendar-derived type, its mark. */
function TypeItem({ type, plainDatingRule }: TypeItemProps): ReactNode {
  return (
    <li className="flex flex-col gap-1 py-3">
      <h3 className="text-base font-medium">
        <TextLink href={paths.typeSheet(type.id)} label={type.name} />
      </h3>
      <dl className="flex flex-col gap-1">
        <Fact term={sentence('taxonomy.origin')} details={sentence(ORIGIN_LABELS[type.origin])} />
        {isCalendarDerived(type) && (
          <Fact
            term={<GlossaryTerm term="datingRule" plain={plainDatingRule} />}
            details={sentence('taxonomy.derivedFromCalendar')}
          />
        )}
      </dl>
    </li>
  );
}

type StatusSectionProps = Readonly<{
  group: StatusGroup;
  /** The calendar-derived type whose "Dating rule" is the first on the screen, if any. */
  firstDerivedId: string | undefined;
}>;

/** The types of one state, under the state's label and their number. */
function StatusSection({ group, firstDerivedId }: StatusSectionProps): ReactNode {
  const headingId = `types-${group.status}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h2 id={headingId} className="text-lg leading-snug font-semibold">
        {label('EventTypeStatus', group.status)}
      </h2>
      <p className="text-ink-muted">
        {sentence('taxonomy.typeCount', { k: formatCount(group.count) })}
      </p>
      {group.types.length > 0 && (
        <ul className="flex flex-col divide-y divide-line">
          {group.types.map((type) => (
            <TypeItem key={type.id} type={type} plainDatingRule={type.id !== firstDerivedId} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The Types screen (IHM-31, TAX-10, TAX-15): the types by state, validated, proposed,
 * rejected and withdrawn, each state with its number of types, each type with its origin
 * and a link to its sheet, and the "derived from the calendar" mark of a calendar-derived
 * type (CL-TAX-20). Without a validated type it says so, recalls that no backtest can be
 * requested without one and puts the proposals first (IHM-55). "Explore new types" opens
 * the exploration, and "Merge" is offered only with two validated research types to merge
 * (TAX-27, CL-TAX-20). `groups` are those of `listByStatus`.
 */
export function TypesByStatus({ groups }: Readonly<{ groups: readonly StatusGroup[] }>): ReactNode {
  const validated = groups
    .filter((group) => group.status === 'validated')
    .flatMap((group) => group.types);
  const hasValidated = validated.length > 0;
  const canMerge = validated.filter((type) => !isCalendarDerived(type)).length >= MERGE_MINIMUM;
  const ordered = (hasValidated ? SCREEN_ORDER : PROPOSALS_FIRST).flatMap((status) =>
    groups.filter((group) => group.status === status),
  );
  const firstDerivedId = ordered
    .flatMap((group) => group.types)
    .find((type) => isCalendarDerived(type))?.id;
  return (
    <>
      <PageHeader
        title={sentence('interface.types')}
        actions={
          <>
            <LinkButton href={paths.exploreTypes()} label={sentence('interface.exploreNewTypes')} />
            {canMerge && (
              <LinkButton href={paths.mergeTypes()} label={sentence('interface.merge')} />
            )}
          </>
        }
      />
      {!hasValidated && (
        <EmptyState
          title={sentence('interface.noValidatedType')}
          reason={sentence('backtests.noRequestPossible')}
        />
      )}
      {ordered.map((group) => (
        <StatusSection key={group.status} group={group} firstDerivedId={firstDerivedId} />
      ))}
    </>
  );
}
