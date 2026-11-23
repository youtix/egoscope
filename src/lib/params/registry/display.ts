import { entriesOf } from '../entry';
import { integer, optionalHttpsAddress, timeZone } from '../kinds';
import { DAYS, DAYS_PER_MONTH, HOURS, noun } from '../units';

import type { FamilyEntries } from '../entry';

// The defaults and bounds of 12 Interface and access (module map §6, CL-TRV-16).
const TIME_ZONE_DEFAULT = 'Europe/Paris';
const LIST_PAGE_SIZE = 50;
const SMALLEST_PAGE = 10;
const LARGEST_PAGE = 200;
const DEADLINE_SOON_HOURS = 24;
const LONGEST_DEADLINE_SOON_HOURS = 168;
const DRAFT_RETENTION_DAYS = 7;

const entry = entriesOf(1);

/** The parameters of 12 Interface and access (IHM-14 to IHM-44). */
export const DISPLAY = {
  'display.timeZone': entry({
    label: 'Time zone',
    sentence: 'The zone in which instants are shown and the scheduled tasks run.',
    unit: 'IANA time zone',
    kind: timeZone(),
    defaultValue: TIME_ZONE_DEFAULT,
    requirement: 'IHM-14',
    source: 'ADR 0010',
    movesSchedule: true,
    editedOn: '/settings/display',
  }),
  'display.listPageSize': entry({
    label: 'List page size',
    sentence: 'How many items a long list shows at a time.',
    unit: 'items',
    kind: integer(SMALLEST_PAGE, LARGEST_PAGE, noun('item', 'items')),
    defaultValue: LIST_PAGE_SIZE,
    requirement: 'IHM-18',
    source: 'H-IHM-03',
  }),
  'display.deadlineSoonHours': entry({
    label: '"Deadline soon" delay',
    sentence: 'An item of the to-do list due within this delay is marked "deadline soon".',
    unit: 'hours',
    kind: integer(1, LONGEST_DEADLINE_SOON_HOURS, HOURS),
    defaultValue: DEADLINE_SOON_HOURS,
    requirement: 'IHM-20',
    source: 'H-IHM-03',
  }),
  'display.draftRetentionDays': entry({
    label: 'Draft retention',
    sentence: 'A draft left unchanged for this long is erased.',
    unit: "days after the draft's last change (CL-IHM-11)",
    kind: integer(1, DAYS_PER_MONTH, DAYS),
    defaultValue: DRAFT_RETENTION_DAYS,
    requirement: 'IHM-42',
    source: 'H-IHM-03',
    movesSchedule: true,
  }),
  'display.researchToolUrl': entry({
    label: 'Research tool address',
    sentence: 'The address of the research tool that the backtest screens open, if you set one.',
    unit: 'address, optional',
    kind: optionalHttpsAddress(),
    defaultValue: '',
    requirement: 'IHM-44',
    source: 'H-IHM-04',
    editedOn: '/settings/display',
  }),
} as const satisfies FamilyEntries<'display'>;
