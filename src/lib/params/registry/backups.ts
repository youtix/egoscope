import { entriesOf } from '../entry';
import { choice, integer, timeOfDay } from '../kinds';
import { DAYS, DAYS_PER_YEAR, noun } from '../units';

import type { FamilyEntries } from '../entry';

// The defaults and bounds of the backups of 14 Cross-cutting requirements (module map
// §6, CL-TRV-16).
const BACKUP_TIME = '05:00';
const BACKUPS_KEPT = 8;
const MOST_BACKUPS_KEPT = 52;
const EXPORT_REMINDER_DAYS = 30;

const entry = entriesOf(1);

/** The day of the backup: a weekday, or every day, which makes the backup interval one day. */
const BACKUP_DAYS = [
  ['monday', 'Monday'],
  ['tuesday', 'Tuesday'],
  ['wednesday', 'Wednesday'],
  ['thursday', 'Thursday'],
  ['friday', 'Friday'],
  ['saturday', 'Saturday'],
  ['sunday', 'Sunday'],
  ['every_day', 'every day'],
] as const;

/** The parameters of the backups (TRV-50, TRV-54). */
export const BACKUPS = {
  'backups.weekday': entry({
    label: 'Backup day and time — day',
    sentence: 'The day of the automatic backup: one day a week, or every day.',
    unit: 'a weekday, or every day (the backup interval is then 1 day)',
    kind: choice(BACKUP_DAYS),
    defaultValue: 'monday',
    requirement: 'TRV-50',
    source: 'H-TRV-09',
    movesSchedule: true,
  }),
  'backups.time': entry({
    label: 'Backup day and time — time',
    sentence: 'The time of day, in your time zone, of the automatic backup.',
    unit: 'local time',
    kind: timeOfDay('a time of day'),
    defaultValue: BACKUP_TIME,
    requirement: 'TRV-50',
    source: 'H-TRV-09',
    movesSchedule: true,
  }),
  'backups.kept': entry({
    label: 'Backups kept',
    sentence:
      'How many backups are kept, all kinds together; with the backup interval, it sets how long withdrawal fingerprints last.',
    unit: 'backups, all kinds counted together; times the backup interval it gives the fingerprint horizon (CL-DSN-07)',
    kind: integer(1, MOST_BACKUPS_KEPT, noun('backup', 'backups')),
    defaultValue: BACKUPS_KEPT,
    requirement: 'TRV-50',
    source: 'H-TRV-09',
  }),
  'backups.exportReminderDays': entry({
    label: 'Export reminder delay',
    sentence:
      'After this long without a full export downloaded, the to-do list reminds you to make one.',
    unit: 'days since the last full export downloaded or, when none was, since the first start (CL-TRV-22)',
    kind: integer(1, DAYS_PER_YEAR, DAYS),
    defaultValue: EXPORT_REMINDER_DAYS,
    requirement: 'TRV-54',
    source: 'H-TRV-09',
  }),
} as const satisfies FamilyEntries<'backups'>;
