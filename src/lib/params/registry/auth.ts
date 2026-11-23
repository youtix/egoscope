import { entriesOf } from '../entry';
import { integer } from '../kinds';
import { CHARACTERS, DAYS, DAYS_PER_YEAR, MINUTES, MINUTES_PER_DAY, noun } from '../units';

import type { FamilyEntries } from '../entry';

// The defaults and bounds of the access rules of 14 Cross-cutting requirements (module
// map §6, CL-TRV-16): the password floor cannot go below 12.
const PASSWORD_MIN_LENGTH = 12;
const LONGEST_PASSWORD_MIN_LENGTH = 128;
const FAILURE_THRESHOLD = 5;
const FEWEST_FAILURES = 3;
const MOST_FAILURES = 20;
const FAILURE_WINDOW_MINUTES = 15;
const LOCKOUT_MINUTES = 15;
const SESSION_IDLE_DAYS = 30;

const entry = entriesOf(1);

/** The parameters of the single account and its sessions (TRV-60 to TRV-62). */
export const AUTH = {
  'auth.passwordMinLength': entry({
    label: 'Minimum password length',
    sentence: 'The shortest password the account accepts.',
    unit: 'characters',
    kind: integer(PASSWORD_MIN_LENGTH, LONGEST_PASSWORD_MIN_LENGTH, CHARACTERS),
    defaultValue: PASSWORD_MIN_LENGTH,
    requirement: 'TRV-60',
    source: 'H-TRV-10',
  }),
  'auth.loginFailureThreshold': entry({
    label: 'Login failures',
    sentence: 'After this many failed logins within the observation period, logging in is locked.',
    unit: 'failures',
    kind: integer(FEWEST_FAILURES, MOST_FAILURES, noun('failure', 'failures')),
    defaultValue: FAILURE_THRESHOLD,
    requirement: 'TRV-61',
    source: 'H-TRV-10',
  }),
  'auth.loginFailureWindowMinutes': entry({
    label: 'Observation period',
    sentence: 'The period over which failed logins are counted.',
    unit: 'minutes',
    kind: integer(1, MINUTES_PER_DAY, MINUTES),
    defaultValue: FAILURE_WINDOW_MINUTES,
    requirement: 'TRV-61',
    source: 'H-TRV-10',
  }),
  'auth.lockoutMinutes': entry({
    label: 'Lockout duration',
    sentence: 'How long logging in stays locked after too many failures.',
    unit: 'minutes',
    kind: integer(1, MINUTES_PER_DAY, MINUTES),
    defaultValue: LOCKOUT_MINUTES,
    requirement: 'TRV-61',
    source: 'H-TRV-10',
  }),
  'auth.sessionIdleDays': entry({
    label: 'Idle session duration',
    sentence: 'A session unused for this long ends.',
    unit: 'days without use',
    kind: integer(1, DAYS_PER_YEAR, DAYS),
    defaultValue: SESSION_IDLE_DAYS,
    requirement: 'TRV-62',
    source: 'H-TRV-10',
  }),
} as const satisfies FamilyEntries<'auth'>;
