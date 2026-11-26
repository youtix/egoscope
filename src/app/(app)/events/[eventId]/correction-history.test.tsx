import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { CorrectionHistory } from './correction-history';

import type { CorrectionEntry } from './queries';

const PARIS = 'Europe/Paris';
// 10:00 in Paris on 21 November 2024.
const CORRECTED_AT = toEpochMs(Date.UTC(2024, 10, 21, 9));
const NO_NAMES: ReadonlyMap<string, string> = new Map();

/** A correction of `field` at 10:00 on 21 November 2024, keeping `before` and `after`. */
function entry(
  field: CorrectionEntry['field'],
  before: string | null = null,
  after: string | null = null,
): CorrectionEntry {
  return { id: 1, correctedAt: CORRECTED_AT, field, before, after };
}

/** The history of `entries`, as the owner reads it, entry by entry. */
function shownEntries(
  entries: readonly CorrectionEntry[],
  names: ReadonlyMap<string, string> = NO_NAMES,
): readonly (string | null)[] {
  render(<CorrectionHistory entries={entries} names={names} zone={PARIS} />);
  return screen.getAllByRole('listitem').map((item) => item.textContent);
}

describe('CorrectionHistory', () => {
  it.each([
    ['player', 'Player'],
    ['event_type', 'Type'],
    ['reference_date', 'Reference date'],
    ['description', 'Description'],
    ['sources', 'Sources'],
    ['injury_return', 'Return from injury'],
    ['game_stakes', 'Game stakes'],
    ['research_confidence', 'Research confidence'],
    ['unverified_note', 'Not verified'],
    ['article_detached', 'Article detached'],
    ['event_merged_in', 'Event merged in'],
    ['player_added', 'Player added'],
    ['rescued', 'Rescued'],
  ] as const)('[IHM-67] labels a correction of %s from the glossary, %s', (field, label) => {
    expect(shownEntries([entry(field)])).toStrictEqual([`Thu 21 Nov 2024, 10:00 — ${label}`]);
  });

  it('[CL-DSN-15] names a kept type or player that no longer exists as unknown', () => {
    const names = new Map([['media-storm', 'Media storm']]);

    expect(
      shownEntries([entry('event_type', 'withdrawn-type', 'media-storm')], names),
    ).toStrictEqual(['Thu 21 Nov 2024, 10:00 — Type, from Unknown to Media storm']);
  });

  it('[CL-DSN-15] writes a missing kept value as unknown', () => {
    expect(shownEntries([entry('game_stakes', null, 'high')])).toStrictEqual([
      'Thu 21 Nov 2024, 10:00 — Game stakes, from Unknown to High',
    ]);
  });

  it('[IMP-32] says that an event was never corrected', () => {
    render(<CorrectionHistory entries={[]} names={NO_NAMES} zone={PARIS} />);

    expect(screen.getByText('Never corrected')).toBeVisible();
  });

  it.each([
    ['reference_date', 'yesterday exact earliest_source'],
    ['reference_date', '2024-11-20 exact earliest_source'],
    ['reference_date', '2024-11-20T18:30:00.000Z roughly earliest_source'],
    ['game_stakes', 'huge'],
  ] as const)(
    '[CL-DSN-15] refuses a kept %s in a form that the service never writes: %s',
    (field, value) => {
      const entries = [entry(field, value)];

      expect(() => CorrectionHistory({ entries, names: NO_NAMES, zone: PARIS })).toThrow(
        `The correction 1 kept a value in an unknown form: ${value}.`,
      );
    },
  );
});
