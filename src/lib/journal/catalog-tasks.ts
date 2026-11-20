// The messages of the scheduled tasks' passes (TRV-26 to TRV-33): their runs and what
// they did, the attempts on the trigger aside.
import type { KeyedMessage } from './message-types';

export const TASK_MESSAGES = [
  // --- Task passes (TRV-26 to TRV-33) --------------------------------------------
  {
    key: 'task_run_succeeded',
    category: 'task_pass',
    subject: 'taskRun',
    params: { task: 'task', trigger: 'trigger' },
    happened: 'The {trigger} run of {task} succeeded.',
    consequence: 'The next run comes at its usual time.',
    whatToDo: 'nothing.',
  },
  {
    key: 'task_run_failed',
    category: 'task_pass',
    level: 'warning',
    subject: 'taskRun',
    params: { task: 'task', trigger: 'trigger' },
    happened: 'The {trigger} run of {task} failed.',
    consequence: 'What it did not finish waits for the next run; nothing is lost.',
    whatToDo:
      'nothing if the next run succeeds; if it fails again, follow the incident that the app status screen shows.',
  },
  {
    key: 'task_run_interrupted',
    category: 'task_pass',
    level: 'warning',
    subject: 'taskRun',
    params: { task: 'task' },
    happened: 'A run of {task} stopped before its end and was closed as interrupted.',
    consequence: 'The next run resumes where this one stopped, so nothing is done twice.',
    whatToDo: 'nothing.',
  },
  {
    key: 'task_run_source_late',
    category: 'task_pass',
    level: 'warning',
    subject: 'taskRun',
    happened: "Last night's games were not yet published by the stats source at the cut-off.",
    consequence:
      'The cases waiting for those games keep the reason "statistics pending"; the update tries again tomorrow.',
    whatToDo:
      'nothing; if the source stays late several days in a row, the incident "Stats source unavailable" opens.',
  },
  {
    key: 'task_run_postponed',
    category: 'task_pass',
    params: { task: 'task' },
    happened: '{task} was due while its previous run was still running.',
    consequence: 'It starts once that run ends, so two runs never overlap.',
    whatToDo: 'nothing.',
  },
  {
    key: 'task_run_missed',
    category: 'task_pass',
    level: 'warning',
    params: { task: 'task', dueAt: 'instant' },
    happened: '{task} did not run in time: it was due at {dueAt}.',
    consequence:
      'A catch-up run starts at once, and the incident "Task not run" stays open until a run succeeds.',
    whatToDo:
      'nothing if the catch-up run succeeds; if tasks keep missing their time, check the task trigger on the app status screen.',
  },
  {
    key: 'data_purged',
    category: 'task_pass',
    subject: 'taskRun',
    params: { count: 'count' },
    happened: 'The data purge deleted {count} {count|item|items} past their retention.',
    consequence: 'Open incidents and the entries tied to them stay.',
    whatToDo: 'nothing.',
  },
  {
    key: 'backup_stored',
    category: 'task_pass',
    subject: 'taskRun',
    happened: 'A backup of all the data was stored, encrypted, in the backup storage.',
    consequence: 'The backups beyond the number kept were deleted.',
    whatToDo: 'nothing.',
  },
  {
    key: 'installation_check_passed',
    category: 'task_pass',
    happened: 'The installation check found every service working.',
    consequence: 'Nothing needs fixing.',
    whatToDo: 'nothing.',
  },
  {
    key: 'installation_check_failed',
    category: 'task_pass',
    level: 'warning',
    params: { failedCount: 'count' },
    happened:
      'The installation check found {failedCount} {failedCount|service|services} not working.',
    consequence: 'What relies on them may not work.',
    whatToDo: 'open the app status screen and follow the steps given for each failed service.',
  },
  {
    key: 'calendar_event_derived',
    category: 'task_pass',
    subject: 'event',
    happened: '{subject} was derived from the calendar.',
    consequence: 'Its case is measured once the game is played and its statistics are in.',
    whatToDo: 'nothing.',
  },
  {
    key: 'calendar_event_dropped',
    category: 'task_pass',
    subject: 'player',
    happened:
      'An event derived from the calendar for {subject} was deleted: its game no longer qualifies.',
    consequence:
      'Its case went with it; a game already started counts among the exits of his profile.',
    whatToDo: 'nothing.',
  },
  {
    key: 'birthday_from_source',
    category: 'task_pass',
    subject: 'player',
    happened: 'The birthday of {subject} was entered from the stats source.',
    consequence: 'His birthday games are derived from the calendar.',
    whatToDo: 'nothing.',
  },
  {
    key: 'links_checked',
    category: 'task_pass',
    subject: 'taskRun',
    params: { checkedCount: 'count', notFoundCount: 'count' },
    happened:
      'The link check read {checkedCount} saved {checkedCount|source|sources}; {notFoundCount} could not be found.',
    consequence: 'A source that cannot be found is marked "not found"; nothing is deleted.',
    whatToDo: 'nothing; you may look at a marked source from its event.',
  },
  {
    key: 'stats_status_unknown',
    category: 'task_pass',
    level: 'warning',
    params: { status: 'code' },
    happened: 'The stats source gave a game a status that the app does not know yet: "{status}".',
    consequence: 'The game keeps what is stored, and its cases wait with "statistics pending".',
    whatToDo: 'ask whoever maintains the app to add this status.',
  },
] as const satisfies readonly KeyedMessage[];
