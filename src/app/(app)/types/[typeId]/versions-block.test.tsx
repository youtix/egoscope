import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createTestDatabase,
  parameterOverrides,
  typeSheetChanges,
  typeSheetVersions,
} from '@/lib/db';
import { sheetContent } from '@/lib/taxonomy';
import { DATABASE_TEST_TIMEOUT_MS, insertEventType, MEDIA_STORM } from '@/lib/testing';
import { definition } from '@/lib/wording';

import { VersionsBlock } from './versions-block';

import type { Database, getDb } from '@/lib/db';
import type { EventTypeRow } from '@/lib/testing';

const harness = vi.hoisted(() => ({ getDb: vi.fn<typeof getDb>() }));

vi.mock(import('@/lib/db'), async (importOriginal) => ({
  ...(await importOriginal()),
  getDb: harness.getDb,
}));
vi.mock(import('@/lib/log'), () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };
const START = Date.UTC(2026, 10, 25, 9, 0);
const HOUR = 3_600_000;
// A moment `n` hours after START: Wednesday 25 November 2026, 10:00 in Paris at n = 0.
const hourOf = (n: number) => new Date(START + n * HOUR);
const ONE_DAY = 'Three outlets or more write about the player within one day.';
const THOUSAND = 1000;

/** The text of an element, empty for none. */
function textOf(element: HTMLElement): string {
  return element.textContent;
}

/** The terms and the values of the facts that `item` lists, in their order. */
function factsOf(item: HTMLElement): Readonly<{ terms: string[]; values: string[] }> {
  return {
    terms: within(item)
      .getAllByRole('term')
      .map((term) => textOf(term)),
    values: within(item)
      .getAllByRole('definition')
      .map((value) => {
        const lines = within(value).queryAllByRole('paragraph');
        return lines.length === 0 ? textOf(value) : lines.map((line) => textOf(line)).join(' ');
      }),
  };
}

/** The list item whose text starts with `start`: a version or a history entry. */
function itemStartingWith(start: string): HTMLElement {
  const found = screen.getAllByRole('listitem').find((item) => textOf(item).startsWith(start));
  if (found === undefined) {
    throw new Error(`No list item starts with "${start}".`);
  }
  return found;
}

/** The number that a list item gives as its sheet version, none for a history entry. */
function versionNumberOf(item: HTMLElement): string | undefined {
  const line = within(item).queryByText(/^\d+$/u, { selector: 'p' });
  return line === null ? undefined : textOf(line).split(' ').at(-1);
}

/** The list item of sheet version `versionNumber`. */
function versionItem(versionNumber: number): HTMLElement {
  const found = screen
    .getAllByRole('listitem')
    .find((item) => versionNumberOf(item) === String(versionNumber));
  if (found === undefined) {
    throw new Error(`No list item shows sheet version ${String(versionNumber)}.`);
  }
  return found;
}

/** Which of the `labels` `item` shows, in the order given. */
function shownIn(item: HTMLElement, labels: readonly string[]): string[] {
  return labels.filter((text) => within(item).queryByText(text) !== null);
}

/** The violations of the WCAG 2.2 A and AA rules that axe finds in the rendered page (CL-IHM-08). */
async function violationsOfPage(): Promise<axe.Result[]> {
  const { violations } = await axe.run(document.body, WCAG_22_AA);
  return violations;
}

/** The block of the media storm, rendered. */
async function renderBlock(typeId: string = MEDIA_STORM): Promise<void> {
  render(await VersionsBlock({ typeId }));
}

/** Writes version `versionNumber` of the media storm, a substantive change unless `values` say otherwise. */
async function addVersion(
  db: Database,
  versionNumber: number,
  values: Partial<typeof typeSheetVersions.$inferInsert>,
): Promise<void> {
  await db.insert(typeSheetVersions).values({
    eventTypeId: MEDIA_STORM,
    versionNumber,
    kind: 'substantive_change',
    substantiveScope: 'narrows',
    content: { name: 'Media storm' },
    ...values,
  });
}

describe('the versions block of the type sheet', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let mediaStorm: EventTypeRow;

  /** Version 2 of the media storm, a substantive change that widened the type, with its history entry. */
  async function addSubstantiveChange(): Promise<void> {
    const before = { ...sheetContent(mediaStorm), switchedOffCriterion: null };
    await addVersion(db, 2, {
      createdAt: hourOf(5),
      substantiveScope: 'both',
      reason: 'A wider type.',
    });
    await db.insert(typeSheetChanges).values({
      eventTypeId: MEDIA_STORM,
      changedAt: hourOf(5),
      changeKind: 'substantive',
      substantiveScope: 'both',
      contentBefore: before,
      contentAfter: { ...before, definition: 'A wider definition.' },
      resultingVersionNumber: 2,
    });
  }

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    harness.getDb.mockResolvedValue({ ok: true, db });
    mediaStorm = await insertEventType(db);
    await db
      .update(typeSheetVersions)
      .set({ createdAt: hourOf(0) })
      .where(eq(typeSheetVersions.versionNumber, 1));
    return database.close;
  });

  it('[CA-TAX-14] [TAX-26] reads two erased for the version whose requalification erased two events', async () => {
    await addVersion(db, 2, {
      createdAt: hourOf(5),
      substantiveScope: 'narrows',
      reason: 'One day is enough.',
      requalifiedConformingCount: 7,
      reassignedCount: 1,
      erasedCount: 2,
      supplementaryRequestsProposedCount: 3,
    });

    await renderBlock();

    expect(factsOf(versionItem(2))).toStrictEqual({
      terms: [
        'Date',
        'Reason',
        'Conforms to the new version',
        'Reassigned to another validated type',
        'Erased',
        'Supplementary requests proposed',
      ],
      values: ['Wed 25 Nov 2026, 15:00', 'One day is enough.', '7', '1', '2', '3'],
    });
  });

  it('[TAX-26] never hides a count: a version that changed no event reads zero for each', async () => {
    await renderBlock();

    expect(factsOf(versionItem(1))).toStrictEqual({
      terms: [
        'Date',
        'Reason',
        'Conforms to the new version',
        'Reassigned to another validated type',
        'Erased',
        'Supplementary requests proposed',
      ],
      values: ['Wed 25 Nov 2026, 10:00', 'None', '0', '0', '0', '0'],
    });
  });

  it('[TAX-20] [TAX-22] [TAX-27] shows each version with its kind, and the scope of a substantive change', async () => {
    await addVersion(db, 2, { createdAt: hourOf(1), substantiveScope: 'broadens' });
    await addVersion(db, 3, { createdAt: hourOf(2), substantiveScope: 'narrows' });
    await addVersion(db, 4, { createdAt: hourOf(3), substantiveScope: 'both' });
    await addVersion(db, 5, {
      createdAt: hourOf(4),
      kind: 'merge',
      substantiveScope: null,
      mergeCoversUnion: true,
    });
    const kinds = ['Validation', 'Substantive change', 'Merge'];
    const scopes = ['Broadens the type', 'Narrows the type', 'Both'];

    await renderBlock();

    expect(
      [1, 2, 3, 4, 5].map((n) => shownIn(versionItem(n), [...kinds, ...scopes])),
    ).toStrictEqual([
      ['Validation'],
      ['Substantive change', 'Broadens the type'],
      ['Substantive change', 'Narrows the type'],
      ['Substantive change', 'Both'],
      ['Merge'],
    ]);
  });

  it('[TAX-20] lists the versions from the first to the last', async () => {
    await addVersion(db, 3, { createdAt: hourOf(6) });
    await addVersion(db, 2, { createdAt: hourOf(3) });

    await renderBlock();

    expect(screen.getAllByRole('listitem').map((item) => versionNumberOf(item))).toStrictEqual([
      '1',
      '2',
      '3',
    ]);
  });

  it('[IHM-15] opens the definition of the sheet version from its first label only', async () => {
    await addVersion(db, 2, { createdAt: hourOf(3) });

    await renderBlock();

    expect(screen.getAllByRole('button', { name: 'Sheet version' })).toHaveLength(1);
    expect(within(versionItem(1)).getByRole('button')).toHaveTextContent('Sheet version');
    expect(screen.getAllByText('Sheet version')).toHaveLength(2);
    expect(screen.getAllByText(definition('sheetVersion').text)).toHaveLength(1);
  });

  it("[TAX-21] [CL-TAX-06] gives the history's date, qualification and reason, oldest first", async () => {
    const before = { ...sheetContent(mediaStorm), switchedOffCriterion: null };
    await db.insert(typeSheetChanges).values([
      {
        eventTypeId: MEDIA_STORM,
        changedAt: hourOf(6),
        changeKind: 'criterion_switch',
        contentBefore: before,
        contentAfter: { ...before, switchedOffCriterion: 'co_occurring' },
      },
      {
        eventTypeId: MEDIA_STORM,
        changedAt: hourOf(5),
        changeKind: 'substantive',
        substantiveScope: 'narrows',
        reason: 'One day is enough.',
        contentBefore: before,
        contentAfter: { ...before, inclusionCriteria: ONE_DAY },
        resultingVersionNumber: 2,
      },
      {
        eventTypeId: MEDIA_STORM,
        changedAt: hourOf(3),
        changeKind: 'formal',
        reason: 'A clearer name.',
        contentBefore: before,
        contentAfter: { ...before, name: 'Media frenzy' },
      },
    ]);
    const kinds = ['Formal change', 'Substantive change', 'Criterion switch changed'];
    const scopes = ['Broadens the type', 'Narrows the type', 'Both'];

    await renderBlock();

    const entries = screen
      .getAllByRole('listitem')
      .filter((item) => versionNumberOf(item) === undefined);
    expect(
      entries.map((entry) => [
        textOf(entry).slice(0, 'Wed 25 Nov 2026, 13:00'.length),
        shownIn(entry, [...kinds, ...scopes]),
        factsOf(entry).values[0],
      ]),
    ).toStrictEqual([
      ['Wed 25 Nov 2026, 13:00', ['Formal change'], 'A clearer name.'],
      ['Wed 25 Nov 2026, 15:00', ['Substantive change', 'Narrows the type'], 'One day is enough.'],
      ['Wed 25 Nov 2026, 16:00', ['Criterion switch changed'], 'None'],
    ]);
    expect(screen.getByRole('heading', { name: 'Change history' })).toBeVisible();
  });

  it('[TAX-21] shows the content before and after only on demand, for the fields that the change touched', async () => {
    const before = { ...sheetContent(mediaStorm), switchedOffCriterion: null };
    await db.insert(typeSheetChanges).values({
      eventTypeId: MEDIA_STORM,
      changedAt: hourOf(5),
      changeKind: 'substantive',
      substantiveScope: 'narrows',
      contentBefore: before,
      contentAfter: { ...before, inclusionCriteria: ONE_DAY },
      resultingVersionNumber: 2,
    });
    await renderBlock();
    const entry = itemStartingWith('Wed 25 Nov 2026, 15:00');
    expect(within(entry).getByText('Before')).not.toBeVisible();

    await userEvent.click(within(entry).getByText('Show the content before and after'));

    expect(within(entry).getByText('Before')).toBeVisible();
    expect(factsOf(entry)).toStrictEqual({
      terms: ['Reason', 'Inclusion criteria'],
      values: ['None', `Before ${before.inclusionCriteria ?? ''} After ${ONE_DAY}`],
    });
  });

  it('[TAX-21] [CL-TAX-17] writes each kind of value of the content before and after', async () => {
    const base = { ...sheetContent(mediaStorm), switchedOffCriterion: null };
    const everyField = {
      name: 'Media frenzy',
      definition: 'hard',
      inclusionCriteria: 'Two outlets.',
      exclusionCriteria: 'A routine game.',
      datingRule: 'The day of the second article.',
      knownInAdvance: true,
      genericExample: 'A player leads the news.',
      documentationDifficulty: 'hard',
      cautionNotes: 'Check the dates.',
      isIntimateSubject: true,
      coverageThresholdOutlets: THOUSAND,
      coverageThresholdDays: 2,
      switchedOffCriterion: 'injury_return',
    };
    await db.insert(typeSheetChanges).values([
      {
        eventTypeId: MEDIA_STORM,
        changedAt: hourOf(1),
        changeKind: 'formal',
        contentBefore: { ...base, definition: 'easy' },
        contentAfter: everyField,
      },
      {
        eventTypeId: MEDIA_STORM,
        changedAt: hourOf(2),
        changeKind: 'criterion_switch',
        contentBefore: {
          ...base,
          documentationDifficulty: 'hard',
          switchedOffCriterion: 'playing_time_too_low',
        },
        contentAfter: {
          ...base,
          documentationDifficulty: 'easy',
          switchedOffCriterion: 'unusual_stakes',
        },
      },
      {
        eventTypeId: MEDIA_STORM,
        changedAt: hourOf(3),
        changeKind: 'criterion_switch',
        contentBefore: { ...base, switchedOffCriterion: 'co_occurring' },
        contentAfter: { ...base, switchedOffCriterion: 'opponent_strength' },
      },
    ]);
    await renderBlock();
    for (const summary of screen.getAllByText('Show the content before and after')) {
      await userEvent.click(summary);
    }
    const formal = itemStartingWith('Wed 25 Nov 2026, 11:00');

    expect(factsOf(formal)).toStrictEqual({
      terms: [
        'Reason',
        'Name',
        'Definition',
        'Inclusion criteria',
        'Exclusion criteria',
        'Dating rule',
        'Known in advance',
        'Example',
        'Documentation difficulty',
        'Caution notes',
        'Intimate subject',
        'Coverage threshold, outlets',
        'Coverage threshold, days',
        'Criterion switched off',
      ],
      values: [
        'None',
        `Before ${base.name} After Media frenzy`,
        'Before easy After hard',
        `Before ${base.inclusionCriteria ?? ''} After Two outlets.`,
        `Before ${base.exclusionCriteria ?? ''} After A routine game.`,
        `Before ${base.datingRule ?? ''} After The day of the second article.`,
        'Before No After Yes',
        `Before ${base.genericExample ?? ''} After A player leads the news.`,
        'Before Medium After Hard',
        'Before None After Check the dates.',
        'Before No After Yes',
        'Before None After 1,000',
        'Before None After 2',
        'Before None After Return from injury',
      ],
    });
    expect(factsOf(itemStartingWith('Wed 25 Nov 2026, 12:00'))).toStrictEqual({
      terms: ['Reason', 'Documentation difficulty', 'Criterion switched off'],
      values: [
        'None',
        'Before Hard After Easy',
        'Before Playing time too low After Unusual stakes',
      ],
    });
    expect(factsOf(itemStartingWith('Wed 25 Nov 2026, 13:00'))).toStrictEqual({
      terms: ['Reason', 'Criterion switched off'],
      values: ['None', 'Before Co-occurring After Opponent strength'],
    });
  });

  it('[TAX-21] says that no change is recorded yet, and why', async () => {
    await renderBlock();

    expect(screen.getByRole('heading', { name: 'No change recorded yet' })).toBeVisible();
    expect(
      screen.getByText(
        'Every change you save to a validated sheet is recorded here, with its date, its kind, its reason and the content before and after.',
      ),
    ).toBeVisible();
  });

  it('[TAX-20] [IHM-56] says that a proposal has no version, and links to the action that creates one', async () => {
    await insertEventType(db, { id: 'tattoo-reveal', name: 'Tattoo reveal', status: 'proposed' });

    await renderBlock('tattoo-reveal');

    expect(screen.getByRole('heading', { name: 'No version yet' })).toBeVisible();
    expect(
      screen.getByText(
        'A proposal has no version: the first one is created when you validate the type.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Validate this type' })).toHaveAttribute(
      'href',
      '/types/tattoo-reveal/validate',
    );
    expect(screen.queryByRole('heading', { name: 'Versions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Change history' })).not.toBeInTheDocument();
  });

  it('[TAX-20] [IHM-56] says that a rejected proposal has no version, without a link to validate it', async () => {
    await insertEventType(db, {
      id: 'tattoo-reveal',
      name: 'Tattoo reveal',
      status: 'rejected',
      rejectionReason: 'not_clean',
    });

    await renderBlock('tattoo-reveal');

    expect(
      screen.getByText(
        'A rejected proposal was never validated, so it has no version. Reopen it to validate it.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('[IHM-14] writes the dates in the zone of the display setting', async () => {
    await db
      .insert(parameterOverrides)
      .values({ parameterKey: 'display.timeZone', value: 'America/New_York' });

    await renderBlock();

    expect(factsOf(versionItem(1)).values[0]).toBe('Wed 25 Nov 2026, 04:00');
  });

  it('[TAX-20] asks for a missing page when no type has the identifier', async () => {
    await expect(VersionsBlock({ typeId: 'no-such-type' })).rejects.toMatchObject({
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    });
  });

  it('[IHM-16] tells in words that the versions could not be read, and logs the cause', async () => {
    const { logger } = await import('@/lib/log');
    harness.getDb.mockResolvedValue({ ok: false, error: { kind: 'database-not-configured' } });

    await renderBlock();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The versions could not be read: reload the screen to try again.',
    );
    expect(logger.error).toHaveBeenCalledWith('The versions of a type could not be read.', {
      cause: 'database-not-configured',
    });
  });

  it('[CL-IHM-08] has no accessibility violation, the content of a change open', async () => {
    await addSubstantiveChange();
    await renderBlock();
    await userEvent.click(screen.getByText('Show the content before and after'));

    expect(await violationsOfPage()).toStrictEqual([]);
  });

  it('[CL-IHM-08] has no accessibility violation, the content of a change still closed', async () => {
    await addSubstantiveChange();
    await renderBlock();

    expect(await violationsOfPage()).toStrictEqual([]);
  });

  it('[CL-IHM-08] has no accessibility violation, no change recorded yet', async () => {
    await renderBlock();

    expect(await violationsOfPage()).toStrictEqual([]);
  });

  it('[CL-IHM-08] has no accessibility violation, a proposal with its link to validate it', async () => {
    await insertEventType(db, { id: 'tattoo-reveal', name: 'Tattoo reveal', status: 'proposed' });
    await renderBlock('tattoo-reveal');

    expect(await violationsOfPage()).toStrictEqual([]);
  });

  it('[CL-IHM-08] has no accessibility violation, a rejected proposal', async () => {
    await insertEventType(db, {
      id: 'tattoo-reveal',
      name: 'Tattoo reveal',
      status: 'rejected',
      rejectionReason: 'not_clean',
    });
    await renderBlock('tattoo-reveal');

    expect(await violationsOfPage()).toStrictEqual([]);
  });

  it('[CL-IHM-08] has no accessibility violation, the versions could not be read', async () => {
    harness.getDb.mockResolvedValue({ ok: false, error: { kind: 'database-not-configured' } });
    await renderBlock();

    expect(await violationsOfPage()).toStrictEqual([]);
  });
});
