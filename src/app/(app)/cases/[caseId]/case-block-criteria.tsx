import { z } from 'zod';

import { Badge } from '@/lib/ui';
import { formatCount, formatDecimal, label, sentence } from '@/lib/wording';

import { Facts, NamedCard } from './case-block-facts';

import type { Fact } from './case-block-facts';
import type { CaseCriterion, CaseDetail } from '@/lib/sensitivity';
import type { ReactNode } from 'react';

// The decimals of minutes: whole from the source, a half in the threshold (SEN-12).
const MINUTE_DECIMALS = 1;

// The stored shape of each criterion's triggering values, one per criterion and
// condition (data model, case_triggered_criteria.triggering_values).
const PLAYING_TIME = z.object({ minutes: z.number(), threshold: z.number() });
const FLAGGED_INJURY = z.object({ injuryReturn: z.literal('yes') });
const MISSED_RUN = z.object({ runLength: z.number(), gamesWithoutBoxScore: z.number() });
const FLAGGED_STAKES = z.object({ gameStakes: z.literal('high') });
const CALCULATED_STAKES = z.discriminatedUnion('phase', [
  z.object({ phase: z.literal('play_in') }),
  z.object({ phase: z.literal('playoffs'), isEliminationGame: z.boolean().nullable() }),
]);
const OPPONENT_RECORD = z.object({
  wins: z.number(),
  losses: z.number(),
  isPreviousSeason: z.boolean(),
});

type Values = CaseCriterion['triggeringValues'];

/** The calculated stakes of a play-in game or a playoff game (SEN-14, CL-STA-18). */
function stakesOf(values: Values): string {
  const stakes = CALCULATED_STAKES.parse(values);
  if (stakes.phase === 'play_in') {
    return sentence('sensitivity.playInGameValues');
  }
  return stakes.isEliminationGame === true
    ? sentence('sensitivity.eliminationGameValues')
    : sentence('sensitivity.playoffGameValues');
}

/** The opponent's record behind its share of wins, this season's or the previous one's (SEN-15). */
function recordOf(values: Values): string {
  const { wins, losses, isPreviousSeason } = OPPONENT_RECORD.parse(values);
  const counts = { w: formatCount(wins), l: formatCount(losses) };
  return isPreviousSeason
    ? sentence('sensitivity.previousOpponentRecordValues', counts)
    : sentence('sensitivity.opponentRecordValues', counts);
}

/** The return from injury, flagged by an indication or calculated from the games he missed (SEN-13, CL-SEN-09). */
function injuryOf(criterion: CaseCriterion): string {
  if (criterion.condition === 'calculated') {
    const { runLength, gamesWithoutBoxScore } = MISSED_RUN.parse(criterion.triggeringValues);
    return sentence('sensitivity.injuryReturnCalculatedValues', {
      k: formatCount(runLength),
      m: formatCount(gamesWithoutBoxScore),
    });
  }
  const { injuryReturn } = FLAGGED_INJURY.parse(criterion.triggeringValues);
  return sentence('sensitivity.injuryReturnFlaggedValues', {
    value: label('InjuryReturn', injuryReturn),
  });
}

/** The game's stakes, flagged by an indication or calculated from its phase (SEN-14). */
function unusualStakesOf(criterion: CaseCriterion): string {
  if (criterion.condition === 'calculated') {
    return stakesOf(criterion.triggeringValues);
  }
  const { gameStakes } = FLAGGED_STAKES.parse(criterion.triggeringValues);
  return sentence('sensitivity.gameStakesFlaggedValues', {
    value: label('GameStakes', gameStakes),
  });
}

/** The values that triggered a criterion, written for the owner (SEN-11 to SEN-15, SEN-06). */
function valuesOf(
  criterion: CaseCriterion,
  coOccurringTypes: readonly string[],
): readonly string[] {
  switch (criterion.criterion) {
    case 'playing_time_too_low': {
      const { minutes, threshold } = PLAYING_TIME.parse(criterion.triggeringValues);
      return [
        sentence('sensitivity.playingTimeValues', {
          minutes: formatDecimal(minutes, MINUTE_DECIMALS),
          threshold: formatDecimal(threshold, MINUTE_DECIMALS),
        }),
      ];
    }
    case 'injury_return': {
      return [injuryOf(criterion)];
    }
    case 'unusual_stakes': {
      return [unusualStakesOf(criterion)];
    }
    case 'opponent_strength': {
      return [recordOf(criterion.triggeringValues)];
    }
    case 'co_occurring': {
      return coOccurringTypes.map((type) => sentence('sensitivity.coOccurringValues', { type }));
    }
    case 'manual': {
      return [];
    }
  }
}

/** A criterion met: its condition, flagged or calculated, then the values that triggered it. */
function criterionFact(criterion: CaseCriterion, coOccurringTypes: readonly string[]): Fact {
  const condition =
    criterion.condition === null ? [] : [label('CriterionCondition', criterion.condition)];
  const lines = [...condition, ...valuesOf(criterion, coOccurringTypes)];
  return {
    key: [criterion.criterion, ...condition].join('-'),
    term: label('DoubtfulCaseCriterion', criterion.criterion),
    details: lines.map((line) => <span key={line}>{line}</span>),
  };
}

/** The criteria that could not be evaluated and that the case mentions (SEN-14, SEN-15). */
function notEvaluable(detail: CaseDetail): readonly Fact[] {
  const note = sentence('sensitivity.notEvaluable');
  const criteria = [
    ...(detail.opponentStrengthNotEvaluable ? (['opponent_strength'] as const) : []),
    ...(detail.stakesNotEvaluable ? (['unusual_stakes'] as const) : []),
  ];
  return criteria.map((criterion) => ({
    key: `not-evaluable-${criterion}`,
    term: label('DoubtfulCaseCriterion', criterion),
    details: note,
  }));
}

/**
 * The doubtful-case criteria met on a case, each with its condition and the values that
 * triggered it, and the criteria it could not evaluate (SEN-11 to SEN-15, SEN-18). A case
 * that meets none and could evaluate all shows none.
 */
export function CaseCriteria({
  detail,
  coOccurringTypes,
}: Readonly<{ detail: CaseDetail; coOccurringTypes: readonly string[] }>): ReactNode {
  const facts = [
    ...detail.criteria.map((criterion) => criterionFact(criterion, coOccurringTypes)),
    ...notEvaluable(detail),
  ];
  return facts.length === 0 ? null : (
    <NamedCard title={sentence('sensitivity.criteriaMet')}>
      <Facts facts={facts} />
    </NamedCard>
  );
}

/**
 * The review flags of a case, then its mentions, "uncertain precedence" for a reference
 * instant shifted for an uncertain precedence and "co-occurring" for a case that shares
 * its game with a case of another type, then the statement that the source reports no
 * ejections, always beside the flags (SEN-06, SEN-16, SEN-44, CL-SEN-07, CL-SEN-11,
 * CL-SEN-12).
 */
export function CaseFlags({ detail }: Readonly<{ detail: CaseDetail }>): ReactNode {
  const mentions = [
    ...(detail.referenceInstantOrigin === 'uncertain_precedence_shift'
      ? [sentence('sensitivity.uncertainPrecedence')]
      : []),
    ...(detail.criteria.some(({ criterion }) => criterion === 'co_occurring')
      ? [sentence('sensitivity.coOccurring')]
      : []),
  ];
  const flags = new Set(detail.reviewFlags.map(({ flag }) => label('ReviewFlag', flag)));
  const badges = [...flags, ...mentions];
  return (
    <NamedCard title={sentence('sensitivity.flaggedForReview')}>
      {badges.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {badges.map((badge) => (
            <li key={badge}>
              <Badge label={badge} />
            </li>
          ))}
        </ul>
      )}
      <p className="text-ink-muted">{sentence('sensitivity.noEjectionReported')}</p>
    </NamedCard>
  );
}
