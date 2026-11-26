import { Badge, Card, GlossaryTerm, StatusPill } from '@/lib/ui';
import {
  definition,
  formatCount,
  formatDecimal,
  formatGap,
  formatIndex,
  label,
  sentence,
} from '@/lib/wording';

import { factOf, Facts, Part, TermHeading, TermSubheading } from './case-block-facts';

import type { Fact } from './case-block-facts';
import type { CaseDetail } from '@/lib/sensitivity';
import type { ReactElement, ReactNode } from 'react';

// The decimals of a Game Score and of minutes: the source gives minutes whole, the
// playing-time threshold has a half (17.5), and a Game Score has tenths (STA-11, STA-14).
const ONE_DECIMAL = 1;

/** A value followed by its mention, "rounded minutes" or "partial", when it has one. */
function withMention(value: string, mention: string | null): ReactElement {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span>{value}</span>
      {mention !== null && <Badge label={mention} />}
    </span>
  );
}

/** The gap with its status, then the numbers of the index: the Game Score, the minutes and the playing-time threshold (SEN-09, STA-11, STA-12, STA-14). */
function indexFacts(detail: CaseDetail): readonly Fact[] {
  const rounded = detail.hasRoundedMinutes === true ? sentence('sensitivity.roundedMinutes') : null;
  return [
    ...factOf(
      { key: 'gap', term: <GlossaryTerm term="normalizedGap" plain /> },
      detail.normalizedGap,
      (gap) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-2xl font-semibold">{formatGap(gap)}</span>
          {detail.gapStatus !== null && <StatusPill label={label('GapStatus', detail.gapStatus)} />}
        </span>
      ),
    ),
    ...factOf(
      { key: 'index', term: <GlossaryTerm term="performanceIndex" /> },
      detail.performanceIndex,
      formatIndex,
    ),
    ...factOf(
      { key: 'score', term: sentence('sensitivity.gameScore') },
      detail.measuredGameScore,
      (score) => formatDecimal(score, ONE_DECIMAL),
    ),
    ...factOf(
      { key: 'minutes', term: sentence('sensitivity.minutesPlayed') },
      detail.minutes,
      (minutes) => withMention(formatDecimal(minutes, ONE_DECIMAL), rounded),
    ),
    ...factOf(
      { key: 'threshold', term: <GlossaryTerm term="playingTimeThreshold" /> },
      detail.playingTimeThresholdMinutes,
      (threshold) => formatDecimal(threshold, ONE_DECIMAL),
    ),
  ];
}

/** The baseline the gap was computed against: its season, phase, games, mean, deviation and status (STA-16 to STA-24). */
function baselineFacts({ baseline }: CaseDetail): readonly Fact[] {
  const partial = baseline.isPartial === true ? sentence('sensitivity.partialBaseline') : null;
  return [
    ...factOf(
      { key: 'season', term: sentence('sensitivity.season') },
      baseline.season,
      (season) => season,
    ),
    ...factOf(
      { key: 'phase', term: sentence('sensitivity.baselinePhase') },
      baseline.phase,
      (phase) => (
        <>
          <span>{label('BaselinePhase', phase)}</span>
          {baseline.gameCount !== null && (
            <span>
              {sentence('sensitivity.baselineGames', { k: formatCount(baseline.gameCount) })}
            </span>
          )}
        </>
      ),
    ),
    ...factOf(
      { key: 'mean', term: sentence('sensitivity.seasonMean') },
      baseline.mean,
      formatIndex,
    ),
    ...factOf(
      { key: 'deviation', term: sentence('sensitivity.seasonStandardDeviation') },
      baseline.standardDeviation,
      formatIndex,
    ),
    ...factOf(
      { key: 'status', term: <GlossaryTerm term="seasonBaselineStatus" /> },
      baseline.status,
      (status) => withMention(label('SeasonBaselineStatus', status), partial),
    ),
  ];
}

/**
 * The calculation of a case's gap (IHM-25, IHM-52, SEN-09, SEN-10, STA-12): the gap
 * with its status, and the three numbers it is made of, the index of the measured game
 * and the mean and standard deviation of the baseline, with the Game Score and the
 * minutes behind the index, and the rest of the baseline used. A case that reached no
 * calculation shows none.
 */
export function CaseCalculation({ detail }: Readonly<{ detail: CaseDetail }>): ReactNode {
  const numbers = indexFacts(detail);
  const baseline = baselineFacts(detail);
  if ([...numbers, ...baseline].length === 0) {
    return null;
  }
  return (
    <Part name={definition('normalizedGap').label}>
      <Card>
        <TermHeading>
          <GlossaryTerm term="normalizedGap" />
        </TermHeading>
        <Facts facts={numbers} />
        {baseline.length > 0 && (
          <>
            <TermSubheading>
              <GlossaryTerm term="seasonBaseline" />
            </TermSubheading>
            <Facts facts={baseline} />
          </>
        )}
      </Card>
    </Part>
  );
}
