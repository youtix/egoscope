// The alert messages (TEL-11, TEL-12, TEL-21, CL-TEL-21): the alert of a new sheet and the
// update of an open one.

import { formatCount, formatGap, label, sentence } from '@/lib/wording';

import {
  belowThresholdLabel,
  designation,
  eventLine,
  firstLine,
  gameText,
  link,
  LIST_SEPARATOR,
  message,
  plain,
  urgentLine,
  verdictText,
  writtenFor,
} from './text';

import type {
  AlertData,
  AlertSection,
  AlertUpdateData,
  CaveatKind,
  EventDesignation,
  ExpectedGameChangeReason,
  MessageGame,
  MessageProfile,
  MessageTrend,
  ProfileConfidence,
} from './data';
import type { SentenceKey } from '@/lib/wording';

const CONFIDENCES = {
  low: 'sensitivity.lowConfidence',
  medium: 'sensitivity.mediumConfidence',
  high: 'sensitivity.highConfidence',
} as const satisfies Record<ProfileConfidence, SentenceKey>;
// The titles of the caveats (ALE-16, glossary section 4.1, CaveatKind).
const CAVEATS: ReadonlyMap<CaveatKind, () => string> = new Map<CaveatKind, () => string>([
  ['small_sample', () => sentence('notifications.smallSample')],
  ['effect_direction', () => sentence('notifications.effectDirection')],
  ['known_context', () => sentence('notifications.knownContext')],
  ['several_events', () => sentence('notifications.severalEvents')],
  ['confidence_near_threshold', () => sentence('notifications.confidenceNearThreshold')],
  ['dating_to_verify', () => sentence('notifications.datingToVerify')],
  ['incomplete_or_earlier_version', () => sentence('notifications.incompleteOrEarlierVersion')],
  ['late_sheet', () => sentence('notifications.lateSheet')],
  ['type_not_covered', () => sentence('notifications.typeNotCovered')],
  ['confounder_not_separable', () => sentence('notifications.confounderNotSeparable')],
]);

/** How a superseded expected game changed (ALE-23), with the game it was. */
function changeReason(reason: ExpectedGameChangeReason, game: string, player: string): string {
  switch (reason) {
    case 'postponed': {
      return sentence('notifications.gamePostponed', { game });
    }
    case 'brought_forward': {
      return sentence('notifications.gameBroughtForward', { game });
    }
    case 'canceled': {
      return sentence('notifications.gameCanceled', { game });
    }
    case 'player_did_not_play': {
      return sentence('notifications.playerDidNotPlay', { game, player });
    }
  }
}

/** The valid cases split by origin, one origin alone said as such (TEL-11, CL-IHM-24). */
function caseCount(profile: MessageProfile): string {
  const k = formatCount(profile.validCount);
  if (profile.trackedCount === 0) {
    return sentence('interface.historicalOnly', { k });
  }
  if (profile.historicalCount === 0) {
    return sentence('interface.trackedOnly', { k });
  }
  return sentence('interface.bothOrigins', {
    k,
    historical: formatCount(profile.historicalCount),
    tracked: formatCount(profile.trackedCount),
  });
}

/** The general trend, presented as such with its reminder (SEN-30, SEN-31). */
function trendLines(trend: MessageTrend): readonly string[] {
  const values = {
    gap: formatGap(trend.meanGap),
    k: formatCount(trend.validCount),
    p: formatCount(trend.playerCount),
    low: formatGap(trend.rangeLow),
    high: formatGap(trend.rangeHigh),
  };
  return [
    plain(sentence('notifications.trendLine', values)),
    plain(sentence('sensitivity.generalTrendReminder')),
  ];
}

/** A frozen profile: its mean gap and range, its cases, verdict and confidence (TEL-11, SEN-38). */
function profileLines(type: string, profile: MessageProfile): readonly string[] {
  const gap = formatGap(profile.meanGap);
  const low = formatGap(profile.rangeLow);
  const high = formatGap(profile.rangeHigh);
  const verdict = verdictText(profile.verdictLevel, profile.direction);
  const confidence = sentence(CONFIDENCES[profile.profileConfidence]);
  return [
    plain(sentence('notifications.profileFor', { type, gap, low, high })),
    plain(caseCount(profile)),
    plain(sentence('notifications.verdictLine', { verdict })),
    plain(sentence('notifications.confidenceLine', { confidence })),
  ];
}

/** The lines of one section of an alert sheet (TEL-11, SEN-31, SEN-38). */
function sectionLines(section: AlertSection): readonly string[] {
  const type = section.typeName ?? sentence('notifications.sensitiveEvent');
  const { values } = section;
  if (values.kind === 'profile') {
    return profileLines(type, values.profile);
  }
  const thresholdLabel = belowThresholdLabel(values.validCount, values.threshold);
  const profileLine = plain(
    sentence('notifications.profileBelowThreshold', { type, label: thresholdLabel }),
  );
  return values.trend === null ? [profileLine] : [profileLine, ...trendLines(values.trend)];
}

function expectedGameLine(game: MessageGame | null, zone: string): string {
  return plain(
    game === null
      ? sentence('notifications.expectedGameUnknown')
      : sentence('notifications.expectedGameLine', { game: gameText(game, zone) }),
  );
}

/** The titles of the sheet's caveats on one line, or no line without caveats (TEL-11). */
function caveatsLine(kinds: readonly CaveatKind[]): string | null {
  if (kinds.length === 0) {
    return null;
  }
  const caveats = kinds.map((kind) => writtenFor(CAVEATS, kind)).join(LIST_SEPARATOR);
  return plain(sentence('notifications.caveatsLine', { caveats }));
}

const sheetLink = (url: string, sheetNumber: number): string =>
  link(url, sentence('notifications.seeSheet', { n: formatCount(sheetNumber) }));

/**
 * The alert of a new sheet: the events, each section's profile or SEN-31 label, the expected
 * game, the caveats, the link to the sheet and the closing line (TEL-11, TEL-21, VUE-02).
 */
export function alertMessage(data: AlertData, zone: string): string {
  const player = data.playerName;
  const title = data.isUrgent
    ? sentence('notifications.urgentAlertTitle', { player })
    : sentence('notifications.alertTitle', { player });
  return message([
    firstLine(title),
    urgentLine(data.isUrgent),
    ...data.events.map((event) => eventLine(event, zone)),
    ...data.sections.flatMap((section) => sectionLines(section)),
    expectedGameLine(data.expectedGame, zone),
    caveatsLine(data.caveatKinds),
    data.isLate ? plain(sentence('notifications.lateSheet')) : null,
    data.typeNotCovered ? plain(sentence('notifications.typeNotCoveredByBacktest')) : null,
    data.complementaryRequest ? plain(sentence('notifications.supplementaryRequest')) : null,
    sheetLink(data.sheetUrl, data.sheetNumber),
    plain(sentence('notifications.closingLine')),
  ]);
}

/** What changed on the sheet, in one or two lines (TEL-12, CL-TEL-21). */
function changeLines(
  change: AlertUpdateData['change'],
  player: string,
  zone: string,
): readonly (string | null)[] {
  switch (change.kind) {
    case 'new_event': {
      const event = designation(change.event, zone);
      return [plain(sentence('notifications.newEventLine', { event }))];
    }
    case 'expected_game_changed': {
      const previous = change.previousGame;
      const reasonLine =
        previous === null
          ? null
          : plain(changeReason(change.reason, gameText(previous, zone), player));
      return [reasonLine, expectedGameLine(change.expectedGame, zone)];
    }
    case 'event_no_longer_applies': {
      const event: EventDesignation = {
        origin: 'calendar',
        typeName: change.typeName,
        game: change.game,
      };
      return [
        eventLine(event, zone),
        plain(sentence('notifications.eventNoLongerApplies', { reason: change.reason })),
      ];
    }
  }
}

/**
 * The update of an open sheet: what changed, the sheet's status and the link to it (TEL-12,
 * CL-TEL-21).
 */
export function alertUpdate(data: AlertUpdateData, zone: string): string {
  const player = data.playerName;
  const title = data.isUrgent
    ? sentence('notifications.urgentUpdateTitle', { player })
    : sentence('notifications.updateTitle', { player });
  const status = label('AlertSheetStatus', data.sheetStatus);
  return message([
    firstLine(title),
    urgentLine(data.isUrgent),
    ...changeLines(data.change, player, zone),
    plain(sentence('notifications.sheetStatusLine', { status })),
    sheetLink(data.sheetUrl, data.sheetNumber),
  ]);
}
