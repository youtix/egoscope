import { describe, expect, it } from 'vitest';

import { checkLeadsAndLimitations } from './check-leads-and-limitations';

import type { UnverifiedLead } from './format';

const REQUESTED = ['public-humiliation', 'player-conflict'];
const MAX_LENGTH = 200;

/** A complete lead of this type, its fields changed as given. */
const lead = (
  eventType: string | undefined,
  changes: Partial<UnverifiedLead> = {},
): UnverifiedLead => ({
  eventType,
  approximatePeriod: '2020-21 season',
  description: 'A rival is said to have mocked player A in a podcast.',
  reason: 'No dated press article reports it.',
  ...changes,
});

const tooLong = 'a'.repeat(MAX_LENGTH + 1);

describe('checkLeadsAndLimitations', () => {
  it('[IMP-15] [CL-IMP-23] counts each kept lead under its requested type, compared as CL-IMP-22 says, or under none', () => {
    const unverifiedLeads = [
      lead('public-humiliation'),
      lead(' Public-Humiliation '),
      lead('player-conflict', { approximatePeriod: undefined }),
      lead('birthday-game'),
      lead('press-conference'),
      lead(undefined),
    ];
    const checked = checkLeadsAndLimitations(
      { unverifiedLeads, declaredLimitations: [] },
      REQUESTED,
      MAX_LENGTH,
    );
    expect(checked).toStrictEqual({
      leadCounts: { 'public-humiliation': 2, 'player-conflict': 1, none: 3 },
      limitations: [],
      warnings: [],
    });
  });

  it('[IMP-15] [CL-IMP-23] [CL-IMP-26] ignores with a warning an incomplete lead, or one with a text too long, and counts it nowhere', () => {
    const unverifiedLeads = [
      lead('public-humiliation', { description: undefined }),
      lead('public-humiliation', { reason: undefined }),
      lead('public-humiliation', { description: tooLong }),
      lead('public-humiliation', { reason: tooLong }),
      lead('public-humiliation', { approximatePeriod: tooLong }),
      lead('player-conflict', {
        description: 'a'.repeat(MAX_LENGTH),
        reason: ` ${'a'.repeat(MAX_LENGTH)} `,
      }),
    ];
    const checked = checkLeadsAndLimitations(
      { unverifiedLeads, declaredLimitations: [] },
      REQUESTED,
      MAX_LENGTH,
    );
    expect(checked.leadCounts).toStrictEqual({ 'player-conflict': 1 });
    expect(checked.warnings).toStrictEqual(
      [1, 2, 3, 4, 5].map((detail) => ({ kind: 'lead_ignored', detail })),
    );
  });

  it('[IMP-15] [CL-IMP-05] [CL-IMP-07] keeps a limitation trimmed and warns of a citation marker in it, and ignores one too long, quoted or no text', () => {
    const declaredLimitations = [
      ' The 2020-21 season was searched in one outlet only. ',
      'Two regional outlets were unreachable [3].',
      tooLong,
      'The archive of «a regional daily» was closed.',
      undefined,
      'a'.repeat(MAX_LENGTH),
    ];
    const checked = checkLeadsAndLimitations(
      { unverifiedLeads: [lead(undefined, { reason: undefined })], declaredLimitations },
      REQUESTED,
      MAX_LENGTH,
    );
    expect(checked).toStrictEqual({
      leadCounts: {},
      limitations: [
        'The 2020-21 season was searched in one outlet only.',
        'Two regional outlets were unreachable [3].',
        'a'.repeat(MAX_LENGTH),
      ],
      warnings: [
        { kind: 'lead_ignored', detail: 1 },
        { kind: 'limitation_citation_marker', detail: 2 },
        { kind: 'limitation_ignored', detail: 3 },
        { kind: 'limitation_ignored', detail: 4 },
        { kind: 'limitation_ignored', detail: 5 },
      ],
    });
  });
});
