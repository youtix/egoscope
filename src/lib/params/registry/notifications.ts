import { entriesOf } from '../entry';
import { increasingMinutes, integer, timeRange, toggle } from '../kinds';
import {
  DAYS,
  DAYS_PER_MONTH,
  HOURS,
  MESSAGES,
  MINUTES,
  MINUTES_PER_DAY,
  MINUTES_PER_HOUR,
  noun,
} from '../units';

import type { EntryDefinition, FamilyEntries } from '../entry';

// The defaults and bounds of 11 Telegram notifications (module map §6, CL-TRV-16).
const QUIET_HOURS = { start: '23:00', end: '08:00' } as const;
const REMINDER_LEAD_HOURS = 6;
const LONGEST_REMINDER_LEAD_HOURS = 48;
const ALERT_GROUPING = 3;
const MOST_ALERT_GROUPING = 20;
const DETAILED_FACTS = 10;
const MOST_DETAILED_FACTS = 50;
const DAILY_CAP = 20;
const HIGHEST_DAILY_CAP = 200;
const SECOND_RETRY_MINUTES = 5;
const THIRD_RETRY_MINUTES = 15;
const FOURTH_RETRY_MINUTES = 30;
const RETRY_INTERVALS_MINUTES = [
  1,
  SECOND_RETRY_MINUTES,
  THIRD_RETRY_MINUTES,
  FOURTH_RETRY_MINUTES,
  MINUTES_PER_HOUR,
] as const;
const MOST_RETRY_INTERVALS = 10;
const CATCH_UP_MINUTES = 60;
const SHORTEST_CATCH_UP_MINUTES = 15;
const INCIDENT_REMINDER_DAYS = 3;
const RECURRENCE_GRACE_HOURS = 6;
const LONGEST_RECURRENCE_GRACE_HOURS = 48;
const LINK_CODE_MINUTES = 15;
const SHORTEST_LINK_CODE_MINUTES = 5;

const entry = entriesOf(2);

/** A switch of TEL-24, on by default. */
const onByDefault = (
  definition: Pick<
    EntryDefinition<boolean>,
    'label' | 'sentence' | 'requirement' | 'source' | 'movesSchedule'
  >,
) => entry({ ...definition, unit: 'on / off', kind: toggle(), defaultValue: true });

/** A notification category of TEL-24, named by its label. */
const category = (name: string, what: string) =>
  onByDefault({
    label: `Notification categories — ${name}`,
    sentence: `Whether you are notified of ${what}.`,
    requirement: 'TEL-24',
    source: 'H-TEL-03',
  });

/** The parameters of 11 Telegram notifications (TEL-10 to TEL-36), read in Lot 2 only. */
export const NOTIFICATIONS = {
  'notifications.enabled': onByDefault({
    label: 'Send notifications (master switch)',
    sentence: 'Whether any Telegram message is sent at all.',
    requirement: 'TEL-25',
    source: 'TEL-25',
    movesSchedule: true,
  }),
  'notifications.quietHours': entry({
    label: 'Quiet hours',
    sentence: 'Messages that are not urgent wait until the end of this range of the day.',
    unit: 'local time range',
    kind: timeRange(),
    defaultValue: QUIET_HOURS,
    requirement: 'TEL-20',
    source: 'H-TEL-03',
    movesSchedule: true,
  }),
  'notifications.urgentException': onByDefault({
    label: 'Urgent exception',
    sentence: 'Whether urgent messages are sent during the quiet hours.',
    requirement: 'TEL-21',
    source: 'H-TEL-03',
  }),
  'notifications.category.backtestRequests': category('Backtest requests', 'backtest requests'),
  'notifications.category.alerts': category('Alerts', 'alerts'),
  'notifications.category.trackedResults': category('Tracked results', 'tracked results'),
  'notifications.category.typeProposals': category('Type proposals', 'type proposals'),
  'notifications.category.incidents': category('Incidents', 'incidents'),
  'notifications.inconclusiveAlerts': onByDefault({
    label: 'Sub-options — inconclusive alerts',
    sentence: 'Whether alerts whose profile is inconclusive are notified too.',
    requirement: 'TEL-24',
    source: 'TEL-24',
  }),
  'notifications.incidentEnd': onByDefault({
    label: 'Sub-options — end of an incident',
    sentence: 'Whether the end of an incident is notified.',
    requirement: 'TEL-24',
    source: 'TEL-24',
  }),
  'notifications.reminderEnabled': onByDefault({
    label: 'Sub-options — reminder before the deadline',
    sentence: 'Whether a reminder is sent before the deadline of an alert.',
    requirement: 'TEL-24',
    source: 'TEL-24',
    movesSchedule: true,
  }),
  'notifications.reminderLeadHours': entry({
    label: 'Reminder before the deadline',
    sentence: 'How long before tip-off the deadline reminder is sent.',
    unit: 'hours before tip-off',
    kind: integer(1, LONGEST_REMINDER_LEAD_HOURS, HOURS),
    defaultValue: REMINDER_LEAD_HOURS,
    requirement: 'TEL-10',
    source: 'H-TEL-03',
    movesSchedule: true,
  }),
  'notifications.alertGroupingThreshold': entry({
    label: 'Alert grouping threshold',
    sentence: 'From this many alerts in one pass, they are sent as one grouped message.',
    unit: 'alerts per pass',
    kind: integer(1, MOST_ALERT_GROUPING, noun('alert', 'alerts')),
    defaultValue: ALERT_GROUPING,
    requirement: 'TEL-19',
    source: 'H-TEL-03',
  }),
  'notifications.maxDetailedFacts': entry({
    label: 'Facts detailed per digest',
    sentence: 'How many facts a grouped message details before it counts the rest.',
    unit: 'facts per digest',
    kind: integer(1, MOST_DETAILED_FACTS, noun('fact', 'facts')),
    defaultValue: DETAILED_FACTS,
    requirement: 'TEL-19',
    source: 'H-TEL-03',
  }),
  'notifications.dailyCap': entry({
    label: 'Daily cap',
    sentence: 'The most messages sent in one day of your time zone.',
    unit: "messages per day of the owner's zone",
    kind: integer(1, HIGHEST_DAILY_CAP, MESSAGES),
    defaultValue: DAILY_CAP,
    requirement: 'TEL-22',
    source: 'H-TEL-03',
  }),
  'notifications.retryIntervalsMinutes': entry({
    label: 'Retry intervals',
    sentence: 'The waits before each new attempt to send a message that failed.',
    unit: 'minutes, minimums (the first tick after each is when it happens)',
    kind: increasingMinutes({ maxCount: MOST_RETRY_INTERVALS, eachMax: MINUTES_PER_DAY }),
    defaultValue: RETRY_INTERVALS_MINUTES,
    requirement: 'TEL-35',
    source: 'H-TEL-03',
    movesSchedule: true,
  }),
  'notifications.catchUpIntervalMinutes': entry({
    label: 'Catch-up interval',
    sentence:
      'The wait between two attempts to send the messages held while Telegram was unreachable.',
    unit: 'minutes between two catch-up attempts while messages wait (TEL-36)',
    kind: integer(SHORTEST_CATCH_UP_MINUTES, MINUTES_PER_DAY, MINUTES),
    defaultValue: CATCH_UP_MINUTES,
    requirement: 'TEL-36',
    source: 'CL-TEL-12',
    movesSchedule: true,
  }),
  'notifications.incidentReminderDays': entry({
    label: 'Incident reminder frequency',
    sentence: 'How often an incident still open is recalled.',
    unit: 'days',
    kind: integer(1, DAYS_PER_MONTH, DAYS),
    defaultValue: INCIDENT_REMINDER_DAYS,
    requirement: 'TEL-15',
    source: 'H-TEL-03',
    movesSchedule: true,
  }),
  'notifications.incidentRecurrenceGraceHours': entry({
    label: 'Incident recurrence window',
    sentence: 'An incident that comes back within this window after its end is not notified again.',
    unit: 'hours',
    kind: integer(0, LONGEST_RECURRENCE_GRACE_HOURS, HOURS),
    defaultValue: RECURRENCE_GRACE_HOURS,
    requirement: 'TEL-15',
    source: 'H-TEL-03',
    movesSchedule: true,
  }),
  'notifications.linkCodeValidityMinutes': entry({
    label: 'Link code validity',
    sentence: 'How long a code to link the Telegram conversation stays valid.',
    unit: 'minutes',
    kind: integer(SHORTEST_LINK_CODE_MINUTES, MINUTES_PER_HOUR, MINUTES),
    defaultValue: LINK_CODE_MINUTES,
    requirement: 'TEL-29',
    source: 'H-TEL-03',
  }),
} as const satisfies FamilyEntries<'notifications'>;
