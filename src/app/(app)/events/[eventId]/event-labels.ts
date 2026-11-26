// The labels of the stored values that the event page shows, from the glossary's sets
// (section 4.1), as `@/lib/wording` holds them (IHM-15, IHM-67).
import { definition, sentence } from '@/lib/wording';

import type { CorrectionEntry } from './queries';
import type { ContextIndicationOrigin, EventRow } from '@/lib/events';

/** The glossary's EventOrigin labels. */
export const ORIGIN_LABELS: Readonly<Record<EventRow['origin'], string>> = {
  historical: sentence('interface.originHistorical'),
  detected: sentence('interface.originDetected'),
  calendar: sentence('interface.originCalendar'),
};

/** The glossary's DatePrecision labels. */
export const PRECISION_LABELS: Readonly<
  Record<NonNullable<EventRow['referenceDatePrecision']>, string>
> = {
  exact: sentence('interface.precisionExact'),
  approximate: sentence('interface.precisionApproximate'),
  none: sentence('interface.precisionNone'),
};

/** The glossary's InjuryReturn and GameStakes labels, by value. */
export const INDICATION_LABELS: Readonly<
  Record<EventRow['injuryReturn'] | EventRow['gameStakes'], string>
> = {
  yes: sentence('interface.indicationYes'),
  no: sentence('interface.indicationNo'),
  high: sentence('interface.indicationHigh'),
  normal: sentence('interface.indicationNormal'),
  unknown: sentence('interface.indicationUnknown'),
};

/** The glossary's ContextIndicationOrigin labels. */
export const INDICATION_ORIGIN_LABELS: Readonly<Record<ContextIndicationOrigin, string>> = {
  research: sentence('interface.indicationOriginResearch'),
  classification: sentence('interface.indicationOriginClassification'),
  user: sentence('interface.indicationOriginUser'),
};

/** An action that DET-52 traces, as against a field that a correction changes. */
type TracedAction = Extract<
  CorrectionEntry['field'],
  'unverified_note' | 'article_detached' | 'event_merged_in' | 'player_added' | 'rescued'
>;

const TRACED_ACTIONS: readonly string[] = [
  'unverified_note',
  'article_detached',
  'event_merged_in',
  'player_added',
  'rescued',
] satisfies readonly TracedAction[];

function isTracedAction(field: CorrectionEntry['field']): field is TracedAction {
  return TRACED_ACTIONS.includes(field);
}

/** The glossary's EventCorrectionField label of an action that DET-52 traces. */
function tracedActionLabel(field: TracedAction): string {
  switch (field) {
    case 'unverified_note': {
      return sentence('interface.correctedUnverifiedNote');
    }
    case 'article_detached': {
      return sentence('interface.correctedArticleDetached');
    }
    case 'event_merged_in': {
      return sentence('interface.correctedEventMergedIn');
    }
    case 'player_added': {
      return sentence('interface.correctedPlayerAdded');
    }
    case 'rescued': {
      return sentence('interface.correctedRescued');
    }
  }
}

/** The glossary's EventCorrectionField label of a field that a correction changes. */
function changedFieldLabel(field: Exclude<CorrectionEntry['field'], TracedAction>): string {
  switch (field) {
    case 'player': {
      return definition('followedPlayer').label;
    }
    case 'event_type': {
      return definition('eventType').label;
    }
    case 'reference_date': {
      return sentence('interface.referenceDate');
    }
    case 'description': {
      return sentence('interface.description');
    }
    case 'sources': {
      return sentence('interface.sources');
    }
    case 'injury_return': {
      return sentence('interface.returnFromInjury');
    }
    case 'game_stakes': {
      return sentence('interface.gameStakes');
    }
    case 'research_confidence': {
      return definition('researchConfidence').label;
    }
  }
}

/** The glossary's EventCorrectionField label of `field` (IHM-67). */
export function correctionFieldLabel(field: CorrectionEntry['field']): string {
  return isTracedAction(field) ? tracedActionLabel(field) : changedFieldLabel(field);
}
