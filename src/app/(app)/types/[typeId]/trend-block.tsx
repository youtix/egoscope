import { getDb } from '@/lib/db';
import { paths } from '@/lib/navigation';
import { getParam } from '@/lib/params';
import { getTrend } from '@/lib/sensitivity';
import { formatInstant } from '@/lib/time';
import {
  Banner,
  Card,
  DefinitionList,
  EmptyState,
  GlossaryTerm,
  LinkButton,
  StatusPill,
  Verdict,
} from '@/lib/ui';
import { formatCount, sentence } from '@/lib/wording';

import type { SwitchableCriterion, TrendDetail } from '@/lib/sensitivity';
import type { ReactNode } from 'react';

/** The glossary's label of a criterion that a type sheet can switch off (section 4.1, `DoubtfulCaseCriterion`). */
function criterionLabel(criterion: SwitchableCriterion): string {
  switch (criterion) {
    case 'playing_time_too_low': {
      return sentence('sensitivity.playingTimeTooLow');
    }
    case 'injury_return': {
      return sentence('sensitivity.injuryReturn');
    }
    case 'unusual_stakes': {
      return sentence('sensitivity.unusualStakes');
    }
    case 'opponent_strength': {
      return sentence('sensitivity.opponentStrength');
    }
    case 'co_occurring': {
      return sentence('sensitivity.coOccurring');
    }
  }
}

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

/** The trend of the type: its verdict with its valid cases and confidence, its distinct players, the reminder, its notices and its warning (IHM-31, IHM-48, SEN-28 to SEN-30, SEN-38, CL-SEN-13, CL-SEN-16). */
function TrendSummary({
  typeId,
  trend,
  timeZone,
}: Readonly<{ typeId: string; trend: TrendDetail; timeZone: string }>): ReactNode {
  const { values } = trend;
  const isRecalculating = trend.notices.includes('recalculating');
  const isAwaitingStatistics = trend.notices.includes('awaiting_statistics');
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
      {isRecalculating && (
        <StatusPill label={sentence('sensitivity.recalculationInProgress')} tone="info" />
      )}
      {isAwaitingStatistics && (
        <StatusPill label={sentence('sensitivity.awaitingStatistics')} tone="info" />
      )}
      {(isRecalculating || isAwaitingStatistics) && (
        <p className="text-sm text-ink-muted">
          {sentence('sensitivity.lastCompleteValuesOf', {
            date: formatInstant(values.computedAt, timeZone, 'full'),
          })}
        </p>
      )}
      {trend.warnings.map((warning) =>
        warning.kind === 'confounder_not_separable' ? (
          <Banner
            key={warning.kind}
            tone="warning"
            message={sentence('sensitivity.criterionSwitchedOff', {
              criterion: criterionLabel(warning.criterion),
            })}
          />
        ) : null,
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
 * SEN-38, IHM-48, SEN-36, CL-SEN-13, CL-SEN-16): the trend's verdict with its valid cases,
 * its profile confidence and its distinct players, the reminder that it describes all
 * observed players, and the link to the trend screen; marked archived for a withdrawn
 * type; marked "Recalculation in progress" or "Awaiting statistics", with the date of the
 * last complete values, while it is; with the permanent warning of a criterion switched
 * off for the type; for a type without any case, why there is none and the backtest
 * that fills it.
 */
export async function TrendBlock({ typeId }: Readonly<{ typeId: string }>): Promise<ReactNode> {
  const database = await getDb();
  if (!database.ok) {
    throw new Error(`The general trend cannot be read: ${database.error.kind}.`);
  }
  const trend = await getTrend(database.db, { eventTypeId: typeId });
  if (trend === null) {
    return <NoTrend />;
  }
  const timeZone = await getParam(database.db, 'display.timeZone');
  return <TrendSummary typeId={typeId} trend={trend} timeZone={timeZone} />;
}
