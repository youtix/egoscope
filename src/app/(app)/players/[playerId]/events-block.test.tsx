import { render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { createTestDatabase } from '@/lib/db';
import {
  birthdayOnNextGameDay,
  DATABASE_TEST_TIMEOUT_MS,
  insertDetectedEvent,
  insertEventType,
  insertHistoricalEvent,
  insertImport,
  insertPlayer,
  insertRequest,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { EventsBlock } from './events-block';

import type { Database, DatabaseResult, getDb } from '@/lib/db';

// The database that `getDb()` gives the block: each test serves one of its own.
const harness = vi.hoisted(() => ({ getDb: vi.fn<typeof getDb>() }));

vi.mock(import('@/lib/db'), async (importOriginal) => ({
  ...(await importOriginal()),
  getDb: harness.getDb,
}));

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };
const NOT_FOUND = 'NEXT_HTTP_ERROR_FALLBACK;404';
const AT = toEpochMs(Date.UTC(2026, 10, 26, 9));
const UNKNOWN_PLAYER = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';

/** A database of the test's own, which the block reaches through `getDb()`. */
async function servedDatabase(): Promise<Database> {
  onTestFinished(installFakeClock(fixedClock(AT)));
  const database = await createTestDatabase();
  onTestFinished(database.close);
  harness.getDb.mockResolvedValue({ ok: true, db: database.db });
  return database.db;
}

/**
 * The first invented player's events of every origin: his birthday game of 26 October
 * 2026, derived from the calendar, whose case awaits it; two media storms dated 20
 * November 2024; one public at 23:30 UTC on 3 November 2026, 00:30 on the 4th in Paris;
 * and a detected one of 20 November 2026 that he dismissed.
 */
async function eventsOfEveryOrigin(db: Database) {
  const { player, event: calendar } = await birthdayOnNextGameDay(db);
  await insertEventType(db);
  const request = await insertRequest(db, { playerId: player.id });
  const imported = await insertImport(db, { request });
  const historical = async (overrides: Parameters<typeof insertHistoricalEvent>[1]['overrides']) =>
    insertHistoricalEvent(db, { playerId: player.id, originImportId: imported.id, overrides });
  const older = await historical({});
  const sameDay = await historical({});
  const timed = await historical({
    referenceDateOn: '2026-11-03',
    referenceAt: new Date(Date.UTC(2026, 10, 3, 23, 30)),
    referenceOffsetMinutes: 0,
    referenceDatePrecision: 'exact',
  });
  const dismissed = await insertDetectedEvent(db, {
    playerId: player.id,
    overrides: {
      referenceAt: new Date(Date.UTC(2026, 10, 20, 10)),
      detectedStatus: 'dismissed',
      dismissalReason: 'old_fact',
      dismissedAt: new Date(AT),
    },
  });
  return { player, calendar, older, sameDay, timed, dismissed };
}

/** Each listed event's facts, its label and its value, in the list's order. */
function listedFacts(): readonly (readonly string[])[] {
  return screen.getAllByRole('listitem').map((item) =>
    within(item)
      .getAllByRole('definition')
      .map((value) => value.textContent),
  );
}

describe('EventsBlock', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  it('[IHM-22] [IHM-67] lists his events of every origin, newest first, each with its type, reference date and case status, linking to its page', async () => {
    const db = await servedDatabase();
    const { player, calendar, older, sameDay, timed, dismissed } = await eventsOfEveryOrigin(db);

    render(await EventsBlock({ playerId: player.id }));

    expect(screen.getByRole('heading', { name: 'Events' })).toBeVisible();
    expect(listedFacts()).toStrictEqual([
      ['Media stormDismissed', 'Fri 20 Nov 2026', 'Not in a case yet'],
      ['Media storm', 'Wed 4 Nov 2026', 'Not in a case yet'],
      ["Player's birthday", 'Mon 26 Oct 2026', 'Awaiting game'],
      ['Media storm', 'Wed 20 Nov 2024', 'Not in a case yet'],
      ['Media storm', 'Wed 20 Nov 2024', 'Not in a case yet'],
    ]);
    const links = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(links).toStrictEqual(
      [dismissed, timed, calendar, sameDay, older].map(({ id }) => `/events/${String(id)}`),
    );
  });

  it('[IHM-15] renders the first labels of the defined terms as glossary terms, the later ones as text', async () => {
    const db = await servedDatabase();
    const { player } = await eventsOfEveryOrigin(db);

    render(await EventsBlock({ playerId: player.id }));

    expect(screen.getAllByRole('button', { name: 'Type' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Case' })).toHaveLength(1);
    expect(
      screen.getByText('A category of events, defined by a type sheet you validated.'),
    ).toBeInTheDocument();
  });

  it('[IHM-56] says why a player without events has none, and what records them', async () => {
    const db = await servedDatabase();
    const player = await insertPlayer(db);

    render(await EventsBlock({ playerId: player.id }));

    expect(screen.getByRole('heading', { name: 'No event yet' })).toBeVisible();
    expect(
      screen.getByText(
        'His events appear once a backtest result is imported for him or his schedule gives a calendar-derived one.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it.each([UNKNOWN_PLAYER, 'not-a-player'])(
    '[CL-IHM-19] shows the generic page for %s, which matches no player',
    async (playerId) => {
      await servedDatabase();

      await expect(EventsBlock({ playerId })).rejects.toHaveProperty('digest', NOT_FOUND);
    },
  );

  it('says his events cannot be read while the database cannot be reached', async () => {
    const unreachable: DatabaseResult = { ok: false, error: { kind: 'database-not-configured' } };
    harness.getDb.mockResolvedValue(unreachable);

    render(await EventsBlock({ playerId: UNKNOWN_PLAYER }));

    expect(
      screen.getByText('The app cannot read his events right now: try again in a few minutes.'),
    ).toBeVisible();
  });

  it('[IHM-61] passes the WCAG 2.2 AA rules', async () => {
    const db = await servedDatabase();
    const { player } = await eventsOfEveryOrigin(db);

    const { container } = render(await EventsBlock({ playerId: player.id }));

    await expect(axe.run(container, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
