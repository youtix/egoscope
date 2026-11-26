// The public API of the event detection (module map, section 2.5): the types of types.ts,
// then one slot per other file that the plan gives the module, with the operations
// it will export. A task adds its exports in its own file's slot only (section 9).

// types.ts
export type {
  ArticleAttachmentRow,
  ArticlePartRow,
  ClassificationFactRow,
  ClassificationIncidentDetailRow,
  ClassificationResultRow,
  DetectionRunRow,
  ExposureCountRow,
  NewArticleAttachmentRow,
  NewArticlePartRow,
  NewClassificationFactRow,
  NewClassificationIncidentDetailRow,
  NewClassificationResultRow,
  NewDetectionRunRow,
  NewExposureCountRow,
} from './types';

// prefilter.ts: prefilterNew, reprefilterForPlayer, reprefilterForVariant
// exposure.ts: purgeExpiredExposure
// queue.ts: processQueue, nextDueAt, recordStop, closeIfEmpty
// classify.ts: the classification of one item through the language-model chain (no operation of its own exposed)
// grouping.ts: the grouping of the facts into events (no operation of its own exposed)
// routing.ts: the routing of each new event (no operation of its own exposed)
// proposals.ts: requeueProposalArticles, releaseRejectedProposalArticles, moveProposalFacts
// owner-actions.ts: classifyManually, requestReclassification, rescue, markNotSameFact, moveReferenceDateEarlier, liftDatingToVerify
// dismissal.ts: dismiss, reinstate
// corrections.ts: correct
// runs.ts: purgeExpiredRuns, addRunCounters
// queries.ts: queue, queueSummary, classificationIncidentSummary, notRelevant, runs, qualityIndicators, dismissalRateByBand, articleFate, exposure, instructions, detectedEvents, detectedEventDetail, previewDismissal, previewOwnerClassification
// erase.ts: eraseEventData, erasePlayerData, previewErasure
// merge.ts is internal to the module (the merge of two detected events, DET-47): nothing of it is exported here.
