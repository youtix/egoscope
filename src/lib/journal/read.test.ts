import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase } from '@/lib/db';
import { toEpochMs } from '@/lib/time';

import { exportText, list } from './read';
import { record } from './record';

import type { JournalPage } from './read';
import type { JournalEntryInput } from './record';
import type { Database } from '@/lib/db';

const PARIS = 'Europe/Paris';
const PLAYER_ID = '5b0d2f8e-3c41-4f6a-9d7e-2a1c8b9e4f60';
const at = (day: number, hour: number) => toEpochMs(Date.UTC(2026, 10, day, hour));
const DAY_18 = { from: at(18, 0), to: at(19, 0) };

/** Where the page after `page` starts. */
const afterPage = (page: JournalPage) => (page.next === null ? {} : { after: page.next });

describe('reading the journal', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const entries: readonly JournalEntryInput[] = [
      { messageKey: 'player_added', playerId: PLAYER_ID, occurredAt: at(17, 9) },
      { messageKey: 'trigger_refused', occurredAt: at(18, 3) },
      {
        messageKey: 'service_call_failed',
        params: { service: 'stats_source' },
        occurredAt: at(18, 12),
        technicalDetails: { service: 'stats_source', httpStatus: 503, at: at(18, 12) },
      },
      { messageKey: 'login_refused', occurredAt: at(18, 20) },
      { messageKey: 'trigger_refused', occurredAt: at(19, 1) },
    ];
    await db.transaction(async (tx) => {
      for (const entry of entries) {
        await record(tx, entry);
      }
    });
    return database.close;
  }, 60_000);

  it('[IHM-38] lists the entries newest first, a page at a time, each text built at display', async () => {
    const first = await list(db, { timeZone: PARIS, pageSize: 2 });
    const second = await list(db, { timeZone: PARIS, pageSize: 2, ...afterPage(first) });
    const third = await list(db, { timeZone: PARIS, pageSize: 2, ...afterPage(second) });

    expect(
      [first, second, third].map((page) => page.entries.map((entry) => entry.messageKey)),
    ).toStrictEqual([
      ['trigger_refused', 'login_refused'],
      ['service_call_failed', 'trigger_refused'],
      ['player_added'],
    ]);
    expect(third.next).toBeNull();
    expect(third.entries).toStrictEqual([
      {
        id: 1,
        occurredAt: at(17, 9),
        category: 'user_action',
        level: 'info',
        messageKey: 'player_added',
        text: 'You added a followed player to the followed players. His game statistics are fetched from the stats source. What to do: nothing.',
        objectRef: { kind: 'player', id: PLAYER_ID },
        technicalDetails: null,
      },
    ]);
  });

  it('[IHM-38] filters the entries by category and by period', async () => {
    const refused = await list(db, {
      timeZone: PARIS,
      pageSize: 10,
      categories: ['trigger_refused', 'login_refused'],
      period: DAY_18,
    });
    const none = await list(db, { timeZone: PARIS, pageSize: 10, categories: [] });

    expect(refused.entries.map((entry) => [entry.category, entry.occurredAt])).toStrictEqual([
      ['login_refused', at(18, 20)],
      ['trigger_refused', at(18, 3)],
    ]);
    expect(none.entries).toStrictEqual([]);
  });

  it('[TRV-44] hides the technical details unless they are asked for', async () => {
    const hidden = await list(db, { timeZone: PARIS, pageSize: 10, period: DAY_18 });
    const shown = await list(db, {
      timeZone: PARIS,
      pageSize: 10,
      period: DAY_18,
      withTechnicalDetails: true,
    });

    expect(hidden.entries.map((entry) => entry.technicalDetails)).toStrictEqual([null, null, null]);
    expect(shown.entries.map((entry) => entry.technicalDetails)).toStrictEqual([
      null,
      { service: 'stats_source', httpStatus: 503, at: at(18, 12) },
      null,
    ]);
  });

  it('[TRV-49] [TRV-44] exports a period as readable text, oldest first, the technical details on demand', async () => {
    const plain = await exportText(db, { timeZone: PARIS, period: DAY_18 });
    const detailed = await exportText(db, {
      timeZone: PARIS,
      period: DAY_18,
      withTechnicalDetails: true,
    });

    expect(plain).toBe(
      [
        'Activity journal from Wednesday 18 November 2026, 01:00 Paris time to Thursday 19 November 2026, 01:00 Paris time',
        'Wednesday 18 November 2026, 04:00 Paris time · Warning · Refused trigger\nA call to start the scheduled tasks was refused: it did not carry the trigger secret. No task ran, and the database was not woken. What to do: nothing if it happens rarely; if refusals keep coming, check that the task trigger sends the secret of the deployment configuration.',
        'Wednesday 18 November 2026, 13:00 Paris time · Warning · Service failure\nA call to the stats source failed. The work that needs it is kept and tried again later; nothing is lost. What to do: nothing if it happens once; if it lasts, an incident opens and says what to do.',
        'Wednesday 18 November 2026, 21:00 Paris time · Warning · Login refused\nA login attempt was refused: the password was wrong. After repeated failures, logins are refused for a while. What to do: nothing if it was you; otherwise change your password in the account settings.\n',
      ].join('\n\n'),
    );
    expect(detailed).toContain(
      'nothing is lost. What to do: nothing if it happens once; if it lasts, an incident opens and says what to do.\n  service: stats_source\n  at: Wednesday 18 November 2026, 13:00 Paris time\n  httpStatus: 503\n\n',
    );
  });
});
