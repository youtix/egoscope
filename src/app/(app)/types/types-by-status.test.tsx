import { render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { TypesByStatus } from './types-by-status';

import type { EventTypeStatus, ListedType, StatusGroup } from '@/lib/taxonomy';

const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };
const CREATED_AT = toEpochMs(Date.UTC(2026, 10, 2, 8));
// The reminder of IHM-55 that no backtest can be requested without a validated type (BKT-02).
const NO_REQUEST_POSSIBLE =
  'To request a backtest, first validate an event type that research can look for. Types derived from the calendar need no backtest.';

// Invented types: three researched ones of each origin, and the two derived from the calendar.
const MEDIA_STORM: ListedType = {
  id: 'media-storm',
  name: 'Media storm',
  origin: 'scoping',
  calendarDerivation: null,
  createdAt: CREATED_AT,
};
const LOCKER_ROOM_LEAK: ListedType = {
  ...MEDIA_STORM,
  id: 'locker-room-leak',
  name: 'Locker-room leak',
  origin: 'exploration',
};
const TRADE_RUMOR: ListedType = {
  ...MEDIA_STORM,
  id: 'trade-rumor',
  name: 'Trade rumor',
  origin: 'detection',
};
const BIRTHDAY: ListedType = {
  ...MEDIA_STORM,
  id: 'birthday',
  name: "Player's birthday",
  calendarDerivation: 'birthday',
};
const FORMER_TEAM: ListedType = {
  ...MEDIA_STORM,
  id: 'former-team',
  name: 'Game against a former team',
  calendarDerivation: 'former_team',
};

/** The groups that `listByStatus` gives for these types by state, in its order (TAX-10). */
function groupsOf(types: Partial<Record<EventTypeStatus, readonly ListedType[]>>): StatusGroup[] {
  const statuses = ['proposed', 'validated', 'rejected', 'withdrawn'] as const;
  return statuses.map((status) => {
    const listed = types[status] ?? [];
    return { status, count: listed.length, types: listed };
  });
}

/** The level-two headings of the screen, in their order. */
function sectionHeadings(): string[] {
  return screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
}

/** The label of a fact's term: the text of the glossary term's button, whose definition sits beside it, or the term's text. */
function termLabel(term: HTMLElement): string {
  return (within(term).queryByRole('button') ?? term).textContent;
}

/** Each type of the section of `status`: its name, then each of its facts, term and value. */
function itemsOf(status: string): string[][] {
  const section = screen.getByRole('region', { name: status });
  return within(section)
    .getAllByRole('listitem')
    .map((item) => [
      within(item).getByRole('heading', { level: 3 }).textContent,
      ...within(item)
        .getAllByRole('term')
        .flatMap((term) => [termLabel(term), term.nextElementSibling?.textContent ?? '']),
    ]);
}

describe('TypesByStatus', () => {
  it('[IHM-31] [TAX-10] groups the types by state, validated first, each state with its number of types', () => {
    render(
      <TypesByStatus
        groups={groupsOf({
          proposed: [LOCKER_ROOM_LEAK],
          validated: [MEDIA_STORM, TRADE_RUMOR],
          withdrawn: [BIRTHDAY],
        })}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Types' })).toBeVisible();
    expect(sectionHeadings()).toStrictEqual(['Validated', 'Proposed', 'Rejected', 'Withdrawn']);
    expect(
      ['Validated', 'Proposed', 'Rejected', 'Withdrawn'].map(
        (status) =>
          within(screen.getByRole('region', { name: status })).getByText(/types?$/u).textContent,
      ),
    ).toStrictEqual(['2 types', '1 type', '0 types', '1 type']);
    expect(itemsOf('Validated').map(([name]) => name)).toStrictEqual([
      'Media storm',
      'Trade rumor',
    ]);
  });

  it('[IHM-31] [TAX-15] links each type to its sheet and gives its origin', () => {
    render(
      <TypesByStatus
        groups={groupsOf({ validated: [MEDIA_STORM, LOCKER_ROOM_LEAK, TRADE_RUMOR] })}
      />,
    );

    expect(itemsOf('Validated')).toStrictEqual([
      ['Media storm', 'Origin', 'Scoping'],
      ['Locker-room leak', 'Origin', 'Exploration'],
      ['Trade rumor', 'Origin', 'Detection'],
    ]);
    expect(screen.getByRole('link', { name: 'Locker-room leak' })).toHaveAttribute(
      'href',
      '/types/locker-room-leak',
    );
  });

  it('[CL-TAX-20] marks the dating rule of a calendar-derived type "derived from the calendar", and only of such a type', () => {
    render(<TypesByStatus groups={groupsOf({ proposed: [BIRTHDAY, MEDIA_STORM, FORMER_TEAM] })} />);

    expect(itemsOf('Proposed')).toStrictEqual([
      ["Player's birthday", 'Origin', 'Scoping', 'Dating rule', 'derived from the calendar'],
      ['Media storm', 'Origin', 'Scoping'],
      [
        'Game against a former team',
        'Origin',
        'Scoping',
        'Dating rule',
        'derived from the calendar',
      ],
    ]);
  });

  it('[IHM-15] [CL-IHM-26] opens the definition from the first "Dating rule" of the screen only', () => {
    render(
      <TypesByStatus
        groups={groupsOf({ proposed: [FORMER_TEAM], validated: [MEDIA_STORM, BIRTHDAY] })}
      />,
    );

    const term = screen.getByRole('button', { name: 'Dating rule' });
    expect(within(screen.getByRole('region', { name: 'Validated' })).getByRole('button')).toBe(
      term,
    );
    expect(
      within(screen.getByRole('region', { name: 'Proposed' })).queryByRole('button'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'The part of a type sheet that says how an event of the type gets its reference date, and whether its events are known in advance.',
      ),
    ).toBeInTheDocument();
  });

  it('[IHM-55] without a validated type, says so, recalls that no backtest can be requested and puts the proposals first', () => {
    render(
      <TypesByStatus
        groups={groupsOf({ proposed: [FORMER_TEAM, MEDIA_STORM], rejected: [TRADE_RUMOR] })}
      />,
    );

    expect(sectionHeadings()).toStrictEqual([
      'no validated type',
      'Proposed',
      'Validated',
      'Rejected',
      'Withdrawn',
    ]);
    expect(screen.getByText(NO_REQUEST_POSSIBLE)).toBeVisible();
    // The dating rule of the first proposal opens its definition, the proposals being first.
    expect(
      within(screen.getByRole('region', { name: 'Proposed' })).getByRole('button', {
        name: 'Dating rule',
      }),
    ).toBeVisible();
  });

  it('[IHM-55] with a validated type, even one derived from the calendar, neither says there is none nor puts the proposals first', () => {
    render(<TypesByStatus groups={groupsOf({ proposed: [MEDIA_STORM], validated: [BIRTHDAY] })} />);

    expect(sectionHeadings()).toStrictEqual(['Validated', 'Proposed', 'Rejected', 'Withdrawn']);
    expect(screen.queryByText(NO_REQUEST_POSSIBLE)).not.toBeInTheDocument();
  });

  it('[IHM-31] shows a state without a type by its number alone, with no list', () => {
    render(<TypesByStatus groups={groupsOf({ validated: [MEDIA_STORM] })} />);

    const rejected = screen.getByRole('region', { name: 'Rejected' });
    expect(within(rejected).getByText('0 types')).toBeVisible();
    expect(within(rejected).queryByRole('list')).not.toBeInTheDocument();
  });

  it('[IHM-31] opens the exploration from "Explore new types", whatever the types', () => {
    render(<TypesByStatus groups={groupsOf({})} />);

    expect(screen.getByRole('link', { name: 'Explore new types' })).toHaveAttribute(
      'href',
      '/types/explore',
    );
  });

  it('[IHM-31] [CL-TAX-20] offers the merge with two validated research types', () => {
    render(<TypesByStatus groups={groupsOf({ validated: [MEDIA_STORM, TRADE_RUMOR] })} />);

    expect(screen.getByRole('link', { name: 'Merge' })).toHaveAttribute('href', '/types/merge');
  });

  it.each([
    ['one validated research type', { validated: [MEDIA_STORM] }],
    [
      'a validated research type beside a calendar-derived one',
      { validated: [MEDIA_STORM, BIRTHDAY] },
    ],
    [
      'a validated research type and research types in other states',
      {
        validated: [MEDIA_STORM],
        proposed: [TRADE_RUMOR],
        rejected: [LOCKER_ROOM_LEAK],
        withdrawn: [{ ...MEDIA_STORM, id: 'bench-dispute', name: 'Bench dispute' }],
      },
    ],
  ])('[IHM-31] [CL-TAX-20] offers no merge with %s', (_, types) => {
    render(<TypesByStatus groups={groupsOf(types)} />);

    expect(screen.getByRole('link', { name: 'Explore new types' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Merge' })).not.toBeInTheDocument();
  });

  it.each([
    ['without a validated type', { proposed: [BIRTHDAY, MEDIA_STORM] }],
    [
      'with types in every state',
      { validated: [MEDIA_STORM, TRADE_RUMOR], proposed: [FORMER_TEAM] },
    ],
  ])('[IHM-61] passes the WCAG 2.2 AA checks %s', async (_, types) => {
    const { container } = render(<TypesByStatus groups={groupsOf(types)} />);

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
