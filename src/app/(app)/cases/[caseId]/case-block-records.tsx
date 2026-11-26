import { formatInstant } from '@/lib/time';
import { formatGap, label, sentence } from '@/lib/wording';

import { Facts, NamedCard } from './case-block-facts';

import type { Fact } from './case-block-facts';
import type { CaseDecisionItem, CaseHistoryItem } from '@/lib/sensitivity';
import type { ReactNode } from 'react';

/** A line under a label: the label, muted, then its text. */
function Labeled({ name, text }: Readonly<{ name: string; text: string }>): ReactNode {
  return (
    <span>
      <span className="text-ink-muted">{name}</span> {text}
    </span>
  );
}

/**
 * The reason of a decision, from the closed list of its kind (SEN-17): an exclusion has
 * an exclusion reason and a reinstatement a reinstatement reason, never both.
 */
function reasonsOf({ exclusionReason, reinstatementReason }: CaseDecisionItem): readonly string[] {
  return [
    ...(exclusionReason === null ? [] : [label('ManualExclusionReason', exclusionReason)]),
    ...(reinstatementReason === null
      ? []
      : [label('ManualReinstatementReason', reinstatementReason)]),
  ];
}

/** A manual decision: when, what, why, its comment and the status it found (SEN-17). */
function decisionFact(decision: CaseDecisionItem, zone: string): Fact {
  return {
    key: `${String(decision.decidedAt)}-${decision.kind}`,
    term: formatInstant(decision.decidedAt, zone, 'short'),
    details: (
      <>
        <span className="font-medium">{label('ManualDecisionKind', decision.kind)}</span>
        {reasonsOf(decision).map((reason) => (
          <span key={reason}>{reason}</span>
        ))}
        {decision.comment !== null && (
          <Labeled name={sentence('sensitivity.comment')} text={decision.comment} />
        )}
        <span className="text-ink-muted">
          {sentence('sensitivity.statusBeforeDecision', {
            status: label('CaseStatus', decision.previousStatus),
          })}
        </span>
      </>
    ),
  };
}

/** A change of the case: when, its status with its reason, its gap with its status, and its cause (SEN-07, SEN-08, SEN-37). */
function historyFact(entry: CaseHistoryItem, zone: string): Fact {
  return {
    key: `${String(entry.recordedAt)}-${entry.status}-${entry.cause}`,
    term: formatInstant(entry.recordedAt, zone, 'short'),
    details: (
      <>
        <span className="font-medium">{label('CaseStatus', entry.status)}</span>
        {entry.statusReason !== null && (
          <span>{label('CaseStatusReason', entry.statusReason)}</span>
        )}
        {entry.normalizedGap !== null && (
          <span>
            {formatGap(entry.normalizedGap)}
            {entry.gapStatus !== null && <> {label('GapStatus', entry.gapStatus)}</>}
          </span>
        )}
        <Labeled
          name={sentence('sensitivity.changeCause')}
          text={label('VerdictChangeCause', entry.cause)}
        />
      </>
    ),
  };
}

/** The manual decisions on a case, oldest first, each with its date, kind, reason, comment and the status it found (SEN-17, SEN-18). */
export function CaseDecisions({
  decisions,
  zone,
}: Readonly<{ decisions: readonly CaseDecisionItem[]; zone: string }>): ReactNode {
  return decisions.length === 0 ? null : (
    <NamedCard title={sentence('sensitivity.manualDecision')}>
      <Facts facts={decisions.map((decision) => decisionFact(decision, zone))} />
    </NamedCard>
  );
}

/** The history of a case, oldest first: each change of its status, game or gap, with its cause (SEN-07, SEN-08, SEN-37). */
export function CaseHistory({
  history,
  zone,
}: Readonly<{ history: readonly CaseHistoryItem[]; zone: string }>): ReactNode {
  return history.length === 0 ? null : (
    <NamedCard title={sentence('sensitivity.caseHistory')}>
      <Facts facts={history.map((entry) => historyFact(entry, zone))} />
    </NamedCard>
  );
}
