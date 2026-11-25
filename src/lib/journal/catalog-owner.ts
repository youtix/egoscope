// The owner's actions that change data in Lot 1 (TRV-41) beyond types and research:
// followed players, stats-source mappings, cases, withdrawals, the account. An entry
// about a case names it alone (operations.md section 1.2), and a withdrawal names
// nothing at all (CL-TRV-10).
import { sentence } from '@/lib/wording';

import type { KeyedMessage } from './message-types';

export const OWNER_ACTION_MESSAGES = [
  // --- Followed players (01) ---------------------------------------------------------
  {
    key: 'player_added',
    category: 'user_action',
    subject: 'player',
    happened: 'You added {subject} to the followed players.',
    consequence: 'His game statistics are fetched once his stats-source mapping is established.',
    whatToDo: 'nothing.',
  },
  {
    key: 'player_identity_changed',
    category: 'user_action',
    subject: 'player',
    happened: 'You changed the identity of {subject}.',
    consequence: 'His player page shows the change.',
    whatToDo: 'nothing.',
  },
  {
    key: 'player_birthday_entered',
    category: 'user_action',
    subject: 'player',
    happened: 'You entered the birthday of {subject}.',
    consequence: 'His birthday games are derived from the calendar.',
    whatToDo: 'nothing.',
  },
  {
    key: 'player_birthday_changed',
    category: 'user_action',
    subject: 'player',
    happened: 'You changed the birthday of {subject}.',
    consequence:
      'His birthday games are derived again, and the events that no longer qualify are deleted with their cases.',
    whatToDo: 'nothing.',
  },
  {
    key: 'player_birthday_removed',
    category: 'user_action',
    subject: 'player',
    happened: 'You removed the birthday of {subject}.',
    consequence: 'His birthday events that no longer qualify are deleted with their cases.',
    whatToDo: 'nothing.',
  },
  {
    key: 'birthday_cleared_after_mapping_change',
    category: 'user_action',
    subject: 'player',
    happened:
      'The day and month of birth of {subject}, which came from the stats source, were removed: the new identity gives none.',
    consequence: 'No birthday game is derived for him until a date is known.',
    whatToDo: 'enter his day and month of birth on his page if you know them.',
  },
  {
    key: 'player_team_change_entered',
    category: 'user_action',
    subject: 'player',
    happened: 'You entered a team change for {subject}.',
    consequence: 'His games against a former team are derived again from the calendar.',
    whatToDo: 'nothing.',
  },
  {
    key: 'player_paused',
    category: 'user_action',
    subject: 'player',
    happened: 'You paused {subject}.',
    consequence: 'His profiles stay, and his cases waiting for their game are still measured.',
    whatToDo: 'nothing.',
  },
  {
    key: 'player_reactivated',
    category: 'user_action',
    subject: 'player',
    happened: 'You reactivated {subject}.',
    consequence: 'He is followed as an active player again.',
    whatToDo: 'nothing.',
  },
  {
    key: 'player_withdrawn',
    category: 'user_action',
    subject: 'player',
    happened: 'You withdrew {subject}.',
    consequence:
      'His requests still to do are canceled; his data stay, his profiles shown as archived.',
    whatToDo: 'nothing.',
  },
  {
    key: 'pause_suggestion_declined',
    category: 'user_action',
    subject: 'player',
    happened: 'You kept {subject} active instead of pausing him.',
    consequence: 'The suggestion to pause him is no longer shown for this absence.',
    whatToDo: 'nothing.',
  },
  {
    key: 'player_data_deleted',
    category: 'user_action',
    happened: 'You deleted the data of a withdrawn player.',
    consequence:
      'His events, cases, requests and profiles are erased, and the general trends are recalculated.',
    whatToDo: 'nothing.',
  },
  {
    key: 'mapping_confirmed',
    category: 'user_action',
    subject: 'player',
    happened: 'You confirmed the stats-source mapping of {subject}.',
    consequence: 'His game statistics are fetched from the stats source.',
    whatToDo: 'nothing.',
  },
  {
    key: 'mapping_changed',
    category: 'user_action',
    subject: 'player',
    happened: 'You changed the stats-source mapping of {subject}.',
    consequence: 'His statistics are fetched again, and his profiles are recalculated.',
    whatToDo: 'nothing.',
  },
  {
    key: 'statistics_refetch_requested',
    category: 'user_action',
    happened: 'You asked for statistics to be fetched again from the stats source.',
    consequence: 'They are fetched within the quota, then the profiles concerned are recalculated.',
    whatToDo: 'nothing.',
  },

  // --- Cases (08) ------------------------------------------------------------------
  {
    key: 'case_excluded',
    category: 'user_action',
    subject: 'case',
    happened: 'You excluded {subject} from the calculations.',
    consequence: 'Its profile is recalculated without it.',
    whatToDo: 'nothing.',
  },
  {
    key: 'case_reinstated',
    category: 'user_action',
    subject: 'case',
    happened: 'You reinstated {subject} in the calculations.',
    consequence: 'Its profile is recalculated with it.',
    whatToDo: 'nothing.',
  },

  // --- Withdrawal (13, CL-TRV-10) and the account (14) -------------------------------
  {
    key: 'event_withdrawn',
    category: 'user_action',
    happened: `${sentence('crossCutting.eventWithdrawn')}.`,
    consequence: 'It and every trace of it are erased, and the profiles are recalculated.',
    whatToDo: 'nothing.',
  },
  {
    key: 'password_changed',
    category: 'user_action',
    happened: 'You changed your password.',
    consequence: 'Every other device was logged out.',
    whatToDo: 'nothing.',
  },
  {
    key: 'logged_out_everywhere',
    category: 'user_action',
    happened: 'You logged out of every device.',
    consequence: 'Every device must log in again.',
    whatToDo: 'nothing.',
  },
  {
    key: 'incident_hidden',
    category: 'user_action',
    subject: 'incident',
    params: { incident: 'incident' },
    happened: 'You hid the incident "{incident}".',
    consequence: 'It stays open while its cause lasts and counts among the hidden incidents.',
    whatToDo: 'nothing.',
  },
] as const satisfies readonly KeyedMessage[];
