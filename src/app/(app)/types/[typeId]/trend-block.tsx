import { getDb } from '@/lib/db';
import { paths } from '@/lib/navigation';
import { getTrend } from '@/lib/sensitivity';
import {
  Card,
  DefinitionList,
  EmptyState,
  GlossaryTerm,
  LinkButton,
  StatusPill,
  Verdict,
} from '@/lib/ui';
import { formatCount, sentence } from '@/lib/wording';

import type { TrendDetail } from '@/lib/sensitivity';
import type { ReactNode } from 'react';

/** The heading of the block, whose label is the first occurrence of the term "general trend" (IHM-15). */
function TrendHeading(): ReactNode {
  return (
    <h2 className="text-lg leading-snug font-semibold">
      <GlossaryTerm term="generalTrend" />
    </h2>
  );
}

/** The empty state of a type with no case, which says why and offers the backtest that fills it (IHM-56). */
function NoTrend(): ReactNode {
  return (
    <Card>
      <TrendHeading />
      <EmptyState
        title={sentence('sensitivity.noCaseForType')}
        reason={sentence('sensitivity.noCaseForTypeReason')}
        action={
          <LinkButton
            href={paths.backtestRequests()}
            label={sentence('interface.requestBacktest')}
          />
        }
        headingLevel="h3"
      />
    </Card>
  );
}

/** The trend of the type: its verdict with its valid cases and confidence, its distinct players and the reminder (IHM-31, SEN-28 to SEN-30, SEN-38). */
function TrendSummary({
  typeId,
  trend,
}: Readonly<{ typeId: string; trend: TrendDetail }>): ReactNode {
  const { values } = trend;
  return (
    <Card
      actions={
        <LinkButton
          href={paths.generalTrend(typeId)}
          label={sentence('sensitivity.openGeneralTrend')}
        />
      }
    >
      <TrendHeading />
      {trend.notices.includes('archived') && (
        <StatusPill label={sentence('sensitivity.archived')} />
      )}
      <Verdict
        verdict={values.verdict}
        confidence={values.profileConfidence}
        validCount={values.tally.validCount}
      />
      <DefinitionList
        items={[
          {
            term: sentence('sensitivity.distinctPlayers'),
            details: formatCount(trend.distinctPlayerCount),
          },
        ]}
      />
      <p className="text-sm text-ink-muted">{sentence('sensitivity.generalTrendReminder')}</p>
    </Card>
  );
}

/**
 * The general-trend block of the type sheet (IHM-31, IHM-56, SEN-19, SEN-28 to SEN-30,
 * SEN-38): the trend's verdict with its valid cases, its profile confidence and its
 * distinct players, the reminder that it describes all observed players, and the link
 * to the trend screen; marked archived for a withdrawn type; for a type without any case,
 * why there is none and the backtest that fills it.
 */
export async function TrendBlock({ typeId }: Readonly<{ typeId: string }>): Promise<ReactNode> {
  const database = await getDb();
  if (!database.ok) {
    throw new Error(`The general trend cannot be read: ${database.error.kind}.`);
  }
  const trend = await getTrend(database.db, { eventTypeId: typeId });
  return trend === null ? <NoTrend /> : <TrendSummary typeId={typeId} trend={trend} />;
}
