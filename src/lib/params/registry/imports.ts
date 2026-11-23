import { entriesOf } from '../entry';
import { decimal, domainList, integer, toggle } from '../kinds';
import { DAYS, DAYS_PER_WEEK, MEGABYTES, MINUTES_PER_HOUR, SECONDS, SOURCES } from '../units';

import type { FamilyEntries } from '../entry';

// The defaults and bounds of 06 Research-result import (module map §6, CL-TRV-16).
const MAX_PASTED_MEGABYTES = 2;
const PASTED_MEGABYTES_STEP = 0.5;
const LARGEST_PASTED_MEGABYTES = 4;
const DUPLICATE_DATE_GAP_DAYS = 2;
const SOURCE_LEAD_DAYS = 1;
const SPOT_CHECK_SOURCES = 3;
const MOST_SPOT_CHECK_SOURCES = 20;
const LINK_CHECK_TIMEOUT_SECONDS = 10;
const MOST_DISALLOWED_DOMAINS = 500;
// Section 6 makes the seed list `data/seeds/disallowed-source-domains.json` the default
// (H-IMP-13 leaves the list to the technical design). Task F-seed (#71) writes that list
// and makes it this default; until then no domain is disallowed.
const DISALLOWED_DOMAINS: readonly string[] = [];

const entry = entriesOf(1);

/** The parameters of 06 Research-result import (IMP-02 to IMP-25). */
export const IMPORTS = {
  'imports.maxPastedTextMegabytes': entry({
    label: 'Maximum pasted size',
    sentence: 'The largest research result that can be pasted or chosen as a file.',
    unit: 'MB of the pasted text or the chosen file, UTF-8, 1 MB = 1,000,000 bytes (CL-IMP-27)',
    kind: decimal(
      { min: PASTED_MEGABYTES_STEP, max: LARGEST_PASTED_MEGABYTES, step: PASTED_MEGABYTES_STEP },
      MEGABYTES,
    ),
    defaultValue: MAX_PASTED_MEGABYTES,
    requirement: 'IMP-02',
    source: 'H-IMP-02',
  }),
  'imports.duplicateMaxDateGapDays': entry({
    label: 'Correspondence window',
    sentence:
      'Two events of one player and one type whose public dates are this close may be the same event.',
    unit: 'days',
    kind: integer(0, DAYS_PER_WEEK, DAYS),
    defaultValue: DUPLICATE_DATE_GAP_DAYS,
    requirement: 'IMP-25',
    source: 'H-IMP-02',
  }),
  'imports.maxSourceLeadDays': entry({
    label: 'Tolerated source lead',
    sentence: "How many days before an event's public date one of its sources may be published.",
    unit: 'days',
    kind: integer(0, DAYS_PER_WEEK, DAYS),
    defaultValue: SOURCE_LEAD_DAYS,
    requirement: 'IMP-14',
    source: 'H-IMP-02',
  }),
  'imports.spotCheckSources': entry({
    label: 'Sources offered for the spot check',
    sentence: 'How many sources of an import are offered for you to open and check.',
    unit: 'sources',
    kind: integer(1, MOST_SPOT_CHECK_SOURCES, SOURCES),
    defaultValue: SPOT_CHECK_SOURCES,
    requirement: 'IMP-23',
    source: 'H-IMP-02',
  }),
  'imports.linkCheckEnabled': entry({
    label: 'Link check',
    sentence: 'Whether the links of imported sources are checked for being reachable.',
    unit: 'on / off',
    kind: toggle(),
    defaultValue: true,
    requirement: 'IMP-17',
    source: 'H-IMP-08',
    movesSchedule: true,
  }),
  'imports.linkCheckTimeoutSeconds': entry({
    label: 'Link-check timeout',
    sentence: 'How long the check waits for a link before it counts as unreachable.',
    unit: 'seconds per link fetch (one request at a time, up to 5 redirects)',
    kind: integer(1, MINUTES_PER_HOUR, SECONDS),
    defaultValue: LINK_CHECK_TIMEOUT_SECONDS,
    requirement: 'IMP-17',
    source: 'CL-IMP-25',
  }),
  'imports.disallowedSourceDomains': entry({
    label: 'Disallowed source domains',
    sentence:
      'Sources on these domains are not kept: social networks, forums, collaborative encyclopedias and video platforms.',
    unit: 'domains',
    kind: domainList(MOST_DISALLOWED_DOMAINS),
    defaultValue: DISALLOWED_DOMAINS,
    requirement: 'IMP-14',
    source: 'H-IMP-13',
  }),
} as const satisfies FamilyEntries<'imports'>;
