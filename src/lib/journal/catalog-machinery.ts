// The messages that the application writes by itself besides task passes:
// recalculations, service failures, incidents, refusals, parameter changes and logins
// (TRV-41), and the attempts counted without the database (CL-TRV-21, CL-TRV-25).
import type { KeyedMessage } from './message-types';

export const MACHINERY_MESSAGES = [
  // --- Recalculations (SEN-34, CL-SEN-16) ----------------------------------------
  {
    key: 'profiles_recalculated',
    category: 'profile_recalculation',
    params: { cause: 'cause', profileCount: 'count' },
    happened: 'A recalculation of the profiles ended; its cause: {cause}.',
    consequence:
      '{profileCount} {profileCount|profile|profiles} and the trends that depend on them are up to date.',
    whatToDo: 'nothing.',
  },

  // --- Service failures (TRV-41) ---------------------------------------------------
  {
    key: 'service_call_failed',
    category: 'service_failure',
    level: 'warning',
    params: { service: 'service' },
    happened: 'A call to the {service} failed.',
    consequence: 'The work that needs it is kept and tried again later; nothing is lost.',
    whatToDo: 'nothing if it happens once; if it lasts, an incident opens and says what to do.',
  },

  // --- Incidents (TRV-45) ----------------------------------------------------------
  {
    key: 'incident_opened',
    category: 'incident',
    level: 'incident',
    subject: 'incident',
    params: { incident: 'incident' },
    happened: 'The incident "{incident}" opened.',
    consequence: 'It stays open while its cause lasts and closes by itself once the cause is gone.',
    whatToDo: 'follow what the incident says on Home or on the app status screen.',
  },
  {
    key: 'warning_opened',
    category: 'incident',
    level: 'warning',
    subject: 'incident',
    params: { incident: 'incident' },
    happened: 'The warning "{incident}" was given.',
    consequence: 'Nothing is lost yet; it ends by itself once its cause is gone.',
    whatToDo: 'look at it on the app status screen.',
  },
  {
    // Nothing is lost, but attention is useful (TRV-43): the export reminder (TRV-54).
    key: 'reminder_opened',
    category: 'incident',
    level: 'warning',
    subject: 'incident',
    params: { incident: 'incident' },
    happened: 'The reminder "{incident}" was given.',
    consequence: 'It stays on the app status screen until what it asks is done.',
    whatToDo: 'do what it asks on the app status screen.',
  },
  {
    key: 'incident_closed',
    category: 'incident',
    subject: 'incident',
    params: { incident: 'incident' },
    happened: '"{incident}" closed: its cause is gone.',
    consequence: 'What it concerned works again.',
    whatToDo: 'nothing.',
  },

  // --- Imports refused in full (IMP-31, CL-IMP-33) ---------------------------------
  {
    key: 'import_refused',
    category: 'import_refused',
    level: 'warning',
    subject: 'backtestRequest',
    params: { refusal: 'refusal', sizeBytes: 'count' },
    happened:
      'A research result of {sizeBytes} {sizeBytes|byte|bytes} pasted for {subject} was refused in full: {refusal}.',
    consequence: 'Nothing was saved, and the request stays as it was.',
    whatToDo: 'correct the result as the import screen explains, then paste it again.',
  },

  // --- Parameter changes (TRV-35, CL-TRV-17) ---------------------------------------
  {
    key: 'parameter_changed',
    category: 'parameter_change',
    params: { parameter: 'parameter', oldValue: 'value', newValue: 'value' },
    happened: '{parameter} changed from {oldValue} to {newValue}.',
    consequence: 'The new value applies from now on.',
    whatToDo: 'nothing.',
  },
  {
    key: 'calculation_parameter_changed',
    category: 'parameter_change',
    params: { parameter: 'parameter', oldValue: 'value', newValue: 'value' },
    happened: '{parameter} changed from {oldValue} to {newValue}.',
    consequence:
      'Every profile is recalculated with it, and the date of the last parameter change moves.',
    whatToDo: 'nothing.',
  },
  {
    key: 'parameter_reset',
    category: 'parameter_change',
    params: { parameter: 'parameter', oldValue: 'value', newValue: 'value' },
    happened: '{parameter} went back to its default value, {newValue}; it was {oldValue}.',
    consequence: 'The default value applies from now on.',
    whatToDo: 'nothing.',
  },
  {
    key: 'criterion_switch_changed',
    category: 'parameter_change',
    subject: 'eventType',
    happened: 'The doubtful-case criterion switched off on {subject} changed.',
    consequence: 'Every profile is recalculated, and the date of the last parameter change moves.',
    whatToDo: 'nothing.',
  },

  // --- Logins (TRV-61, TRV-63, IHM-07) ---------------------------------------------
  {
    key: 'login_refused',
    category: 'login_refused',
    level: 'warning',
    happened: 'A login attempt was refused: the password was wrong.',
    consequence: 'After repeated failures, logins are refused for a while.',
    whatToDo: 'nothing if it was you; otherwise change your password in the account settings.',
  },
  {
    key: 'login_refused_while_locked',
    category: 'login_refused',
    level: 'warning',
    params: { lockedUntilAt: 'instant' },
    happened: 'A login attempt was refused while logins are locked, until {lockedUntilAt}.',
    consequence: 'No password is examined until then, the right one included.',
    whatToDo: 'wait until then; if it was not you, change your password once you are logged in.',
  },
  {
    // A wrong current password at a password change counts as a refused login (TRV-61, IHM-09).
    key: 'password_change_refused',
    category: 'login_refused',
    level: 'warning',
    happened: 'A password change was refused: the current password was wrong.',
    consequence: 'After repeated failures, logins are refused for a while.',
    whatToDo:
      'nothing if it was you; otherwise change your password in the account settings, which closes every other session.',
  },
  {
    key: 'password_change_refused_while_locked',
    category: 'login_refused',
    level: 'warning',
    params: { lockedUntilAt: 'instant' },
    happened: 'A password change was refused while logins are locked, until {lockedUntilAt}.',
    consequence: 'No password is examined until then, the right one included.',
    whatToDo:
      'wait until then; if it was not you, change your password as soon as the lock ends, which closes every other session.',
  },
  {
    key: 'login_locked',
    category: 'login_lockout',
    level: 'incident',
    params: { lockedUntilAt: 'instant' },
    happened: 'Logins were locked after repeated failed attempts, until {lockedUntilAt}.',
    consequence:
      'No password is examined until then, and the incident "Logins refused" stays open until the next successful login.',
    whatToDo: 'if it was not you, change your password as soon as you are logged in.',
  },
  {
    key: 'password_reset',
    category: 'login_lockout',
    level: 'warning',
    happened: 'The password was reset from the deployment configuration.',
    consequence:
      'Every session was closed and logins are allowed again; the next login asks you to choose a new password.',
    whatToDo:
      'nothing if you reset it; otherwise change the initial password of the deployment configuration at once.',
  },

  // --- Attempts counted without the database (TRV-65, CL-TRV-21, CL-TRV-25) ---------
  {
    key: 'trigger_refused',
    category: 'trigger_refused',
    level: 'warning',
    happened:
      'A call to start the scheduled tasks was refused: it did not carry the trigger secret.',
    consequence: 'No task ran, and the database was not woken.',
    whatToDo:
      'nothing if it happens rarely; if refusals keep coming, check that the task trigger sends the secret of the deployment configuration.',
  },
  {
    key: 'trigger_refusals_counted',
    category: 'trigger_refused',
    level: 'warning',
    params: { count: 'count', firstAt: 'instant', lastAt: 'instant' },
    happened:
      'Between {firstAt} and {lastAt}, {count} more {count|call|calls} to start the scheduled tasks {count|was|were} refused; beyond 1,000 at once, only their number is kept.',
    consequence: 'No task ran, and the database was not woken.',
    whatToDo:
      'check that the task trigger sends the secret of the deployment configuration; a flood of refused calls uses up the hosting allowance.',
  },
  {
    key: 'telegram_update_ignored',
    category: 'telegram_message',
    level: 'warning',
    params: { conversation: 'conversation' },
    happened: 'Someone other than you wrote to the Telegram bot from {conversation}.',
    consequence: 'The bot did not answer, and nothing of the message was kept.',
    whatToDo: 'nothing.',
  },
  {
    key: 'telegram_updates_counted',
    category: 'telegram_message',
    level: 'warning',
    params: {
      privateCount: 'count',
      groupCount: 'count',
      channelCount: 'count',
      firstAt: 'instant',
      lastAt: 'instant',
    },
    happened:
      'Between {firstAt} and {lastAt}, more updates from strangers reached the Telegram bot: {privateCount} from private chats, {groupCount} from groups and {channelCount} from channels; beyond 1,000 at once, only their number is kept.',
    consequence: 'The bot answered none of them, and nothing of them was kept.',
    whatToDo: 'nothing.',
  },
] as const satisfies readonly KeyedMessage[];
