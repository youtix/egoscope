// The row and insert types of the table of the calendar derivation (module map, section
// 2.4), as Drizzle derives them from the schema of `@/lib/db`, and the type of the
// derivation reactions (section 1.10).
import type { calendarDerivationRequests, Transaction } from '@/lib/db';
import type { Result } from '@/lib/result';
import type { CaseId, PlayerEventId } from '@/lib/stats-engine';

export type CalendarDerivationRequestRow = typeof calendarDerivationRequests.$inferSelect;
export type NewCalendarDerivationRequestRow = typeof calendarDerivationRequests.$inferInsert;

/**
 * Why the game of a calendar-derived event no longer qualifies: its date or its opponent
 * changed, it was canceled, the player is no longer with that team, or his birthday or
 * his team history was corrected (CL-TAX-19, CL-SUI-14).
 */
export type DerivationDropReason =
  | 'date_changed'
  | 'opponent_changed'
  | 'game_canceled'
  | 'player_left_team'
  | 'birthday_corrected'
  | 'team_history_corrected';

/** A calendar-derived event that the derivation is about to delete with its case. */
export type DerivationDrop = Readonly<{
  eventId: PlayerEventId;
  caseId: CaseId;
  reason: DerivationDropReason;
  /**
   * The `follows_owner_change` flag of the run's request: true when every need it holds
   * came from an owner action, so that no alert update follows the drop (events-and-cases.md
   * §1.13, CL-TEL-21, TEL-18).
   */
  followsOwnerChange: boolean;
}>;

/**
 * The derivation reactions of the module map (section 1.10), which
 * `calendarEvents.processDerivations(ctx, reactions)` calls in its transaction before it
 * deletes a calendar-derived event and its case, whether its game is upcoming or started.
 * A Lot 1 build passes the empty list, which does nothing; a failure rolls the drop back.
 */
export type DerivationReactions<E = never> = (
  tx: Transaction,
  drop: DerivationDrop,
) => Promise<Result<undefined, E>>;
