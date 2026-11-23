import { outboxFacts } from '@/lib/db';

/**
 * The complete list of the facts Telegram may announce, the glossary's `OutboxFactKind`
 * (module map §2.1; TEL-09 to TEL-15). The export reminder has none of its own: it is the
 * incident `export_reminder`, whose `incident_opened` fact gives its one message (CL-TRV-22).
 */
export const OUTBOX_FACT_KINDS = outboxFacts.kind.enumValues;

/** A kind of notifiable fact (TEL-02). */
export type OutboxFactKind = (typeof OUTBOX_FACT_KINDS)[number];

/** The kinds whose subject is a Lot 2 object, named by its identifier without a foreign key. */
export type Lot2FactKind = Extract<
  OutboxFactKind,
  'alert_sheet_produced' | 'alert_sheet_updated' | 'tracked_result_ready'
>;

/** A fact about a Lot 2 object: the sheet, the sheet's update entry or the tracked game result. */
export type Lot2Fact = Readonly<{ kind: Lot2FactKind; lot2SubjectId: number }>;

/**
 * One notifiable fact, with exactly the subject its kind names (operations.md §1.15): the
 * fact is its kind and its subject, the new deadline game and the event that moved it
 * being the version of a deadline change, so that the same fact is never recorded twice
 * and a rerun never yields a second message (TRV-29, TEL-17).
 */
export type OutboxFact =
  | Readonly<{ kind: 'backtest_request_to_do'; backtestRequestId: number }>
  | Readonly<{
      kind: 'backtest_request_deadline_changed';
      backtestRequestId: number;
      deadlineGameId: number;
      playerEventId: number;
    }>
  | Readonly<{ kind: 'type_proposal_new'; eventTypeId: string }>
  | Readonly<{ kind: 'incident_opened' | 'incident_closed'; incidentId: number }>
  | Lot2Fact;
