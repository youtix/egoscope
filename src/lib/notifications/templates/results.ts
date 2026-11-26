// The message of a tracked game result (TEL-13, CL-TEL-16): the gap and its mention, the
// category of the case, and the profile with its verdict.

import { formatCount, formatGap, sentence } from '@/lib/wording';

import {
  belowThresholdLabel,
  firstLine,
  gameText,
  link,
  message,
  plain,
  verdictText,
  writtenFor,
} from './text';

import type { CaseCategory, TrackedGameResultData, TrackedResultContent } from './data';

// Between a value and its mention: "+1.07, provisional".
const MENTION_SEPARATOR = ', ';
// A tracked game result alone is titled as the results of one game (notifications §5).
const ONE_RESULT = 1;
// The terms of file 10 for a case's category (SUI-22, glossary section 4.1, CaseCategory).
const CATEGORIES: ReadonlyMap<CaseCategory, () => string> = new Map<CaseCategory, () => string>([
  ['confirmed', () => sentence('notifications.confirmed')],
  ['refuted', () => sentence('notifications.refuted')],
  ['neutral', () => sentence('notifications.neutral')],
  ['no_forecast', () => sentence('notifications.noForecast')],
]);

/** The mention after a gap: indicative, or provisional (SUI-15, SUI-20). */
function gapMention(result: TrackedResultContent): string | null {
  if (result.kind === 'indicative') {
    return sentence('notifications.indicative');
  }
  return result.gapStatus === 'provisional' ? sentence('notifications.provisional') : null;
}

/** The gap obtained with its mention: the indicative comparison for an indicative result. */
function measuredValue(result: TrackedResultContent): string {
  const gap = result.kind === 'indicative' ? result.indicativeComparison : result.normalizedGap;
  if (gap === null) {
    throw new Error('A tracked result without a reason for its measurement needs its gap.');
  }
  const mention = gapMention(result);
  return mention === null ? formatGap(gap) : [formatGap(gap), mention].join(MENTION_SEPARATOR);
}

/** SEN-31's label under the case threshold, otherwise the change of verdict or its absence. */
function resultVerdict(data: TrackedGameResultData): string {
  const { profile } = data.result;
  const { belowThreshold } = data;
  if (belowThreshold !== null) {
    return belowThresholdLabel(belowThreshold.validCount, belowThreshold.threshold);
  }
  return profile.verdictChanged
    ? sentence('notifications.newVerdict', {
        verdict: verdictText(profile.verdictLevel, profile.direction),
      })
    : sentence('notifications.verdictUnchanged');
}

/** The new profile values and the verdict (TEL-13, CL-TEL-16). */
function resultProfile(data: TrackedGameResultData): string {
  const { profile } = data.result;
  return sentence('notifications.resultProfile', {
    gap: formatGap(profile.meanGap),
    k: formatCount(profile.validCount),
    low: formatGap(profile.rangeLow),
    high: formatGap(profile.rangeHigh),
    verdict: resultVerdict(data),
  });
}

/** The case's category, which one case alone does not prove, when it has one (SUI-22, TEL-13). */
function categoryLines(category: CaseCategory | null): readonly string[] {
  if (category === null) {
    return [];
  }
  const name = writtenFor(CATEGORIES, category);
  return [
    plain(sentence('notifications.categoryLine', { category: name })),
    plain(sentence('notifications.oneCaseAlone')),
  ];
}

/**
 * The result of one tracked game: the value or the reason that replaces it, the case's
 * category, then the profile and its verdict, with the links to the result and to the
 * validation table (TEL-13, CL-TEL-16).
 */
export function trackedGameResult(data: TrackedGameResultData, zone: string): string {
  const { result, game } = data;
  const player = data.playerName;
  const value = data.statusReasonLabel ?? measuredValue(result);
  const title = sentence('notifications.resultsTitle', { n: formatCount(ONE_RESULT) });
  const resultLine =
    game === null
      ? sentence('notifications.resultWithoutGame', { player, value })
      : sentence('notifications.resultFor', { player, game: gameText(game, zone), value });
  return message([
    firstLine(title),
    plain(resultLine),
    result.recordedAfterTipOff ? plain(sentence('notifications.recordedAfterTipOff')) : null,
    result.lateForecast ? plain(sentence('notifications.lateForecast')) : null,
    ...categoryLines(result.category),
    plain(resultProfile(data)),
    result.noBacktestYet ? plain(sentence('notifications.noBacktestYetCase')) : null,
    link(data.targetUrl, sentence('notifications.seeResult')),
    link(data.validationTableUrl, sentence('interface.validationTable')),
  ]);
}
