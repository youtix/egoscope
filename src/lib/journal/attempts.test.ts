import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, journalEntries } from '@/lib/db';
import { toEpochMs } from '@/lib/time';

import { recordCountedAttempts } from './attempts';
import { renderEntry } from './render';

import type { CountedAttempts } from './attempts';
import type { Database } from '@/lib/db';

const at = (hour: number, minute: number) => toEpochMs(Date.UTC(2026, 10, 19, hour, minute));
const PARIS = 'Europe/Paris';

describe('recordCountedAttempts', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  }, 60_000);

  /** Journals `counted` as the next database pass does, and reads back what it wrote. */
  async function journal(counted: CountedAttempts) {
    const written = await db.transaction(async (tx) => recordCountedAttempts(tx, counted));
    const rows = await db
      .select()
      .from(journalEntries)
      .orderBy(asc(journalEntries.occurredAt), asc(journalEntries.id));
    return { written, rows };
  }

  it('[TRV-65] [CL-TRV-21] [CL-TRV-25] journals each attempt counted without the database as its own entry, with its own instant and kind', async () => {
    const { written, rows } = await journal({
      attempts: [
        { kind: 'refused_trigger', at: at(21, 5) },
        { kind: 'group', at: at(21, 7) },
        { kind: 'refused_trigger', at: at(21, 10) },
      ],
      beyond: [],
    });

    expect(written).toBe(3);
    expect(
      rows.map(({ occurredAt, category, level, messageKey, messageParams }) => ({
        occurredAt,
        category,
        level,
        messageKey,
        messageParams,
      })),
    ).toStrictEqual([
      {
        occurredAt: new Date(at(21, 5)),
        category: 'trigger_refused',
        level: 'warning',
        messageKey: 'trigger_refused',
        messageParams: {},
      },
      {
        occurredAt: new Date(at(21, 7)),
        category: 'telegram_message',
        level: 'warning',
        messageKey: 'telegram_update_ignored',
        messageParams: { conversation: 'group' },
      },
      {
        occurredAt: new Date(at(21, 10)),
        category: 'trigger_refused',
        level: 'warning',
        messageKey: 'trigger_refused',
        messageParams: {},
      },
    ]);
  });

  it("[CL-TRV-25] journals the attempts beyond an instance's 1,000 as one count entry per category, by kind, with the first and the last instant", async () => {
    const { written, rows } = await journal({
      attempts: [],
      beyond: [
        { kind: 'refused_trigger', count: 1250, firstAt: at(20, 0), lastAt: at(20, 40) },
        { kind: 'refused_trigger', count: 30, firstAt: at(19, 55), lastAt: at(20, 10) },
        { kind: 'group', count: 12, firstAt: at(18, 0), lastAt: at(18, 30) },
        { kind: 'channel', count: 3, firstAt: at(18, 10), lastAt: at(18, 45) },
      ],
    });

    expect(written).toBe(2);
    expect(rows.map((row) => renderEntry(row, PARIS).text)).toStrictEqual([
      'Between Thu 19 Nov 2026, 19:00 and Thu 19 Nov 2026, 19:45, more updates from strangers reached the Telegram bot: 0 from private chats, 12 from groups and 3 from channels; beyond 1,000 at once, only their number is kept. The bot answered none of them, and nothing of them was kept. What to do: nothing.',
      'Between Thu 19 Nov 2026, 20:55 and Thu 19 Nov 2026, 21:40, 1,280 more calls to start the scheduled tasks were refused; beyond 1,000 at once, only their number is kept. No task ran, and the database was not woken. What to do: check that the task trigger sends the secret of the deployment configuration; a flood of refused calls uses up the hosting allowance.',
    ]);
    expect(rows.map((row) => [row.category, row.occurredAt])).toStrictEqual([
      ['telegram_message', new Date(at(18, 45))],
      ['trigger_refused', new Date(at(20, 40))],
    ]);
  });

  it('writes nothing when no attempt was counted', async () => {
    const { written, rows } = await journal({ attempts: [], beyond: [] });

    expect([written, rows]).toStrictEqual([0, []]);
  });
});
