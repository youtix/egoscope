import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, insertParents, PARENTS } from '@/lib/db';
import { toEpochMs } from '@/lib/time';

import { recordCountedAttempts } from './attempts';
import { exportText, list } from './read';
import { record } from './record';

import type { JournalPage } from './read';
import type { JournalEntryInput } from './record';
import type { Database } from '@/lib/db';

const PARIS = 'Europe/Paris';
const PLAYER_ID = PARENTS.playerId;
const at = (day: number, hour: number) => toEpochMs(Date.UTC(2026, 10, day, hour));
const DAY_18 = { from: at(18, 0), to: at(19, 0) };
// More entries than the export reads at a time, 500.
const LONG_DAY_ENTRIES = 1234;
const MINUTE_MS = 60_000;

// The level, category and text of a refused trigger's block in an export.
const REFUSED_TRIGGER =
  'Warning · Refused trigger\nA call to start the scheduled tasks was refused: it did not carry the trigger secret. No task ran, and the database was not woken. What to do: nothing if it happens rarely; if refusals keep coming, check that the task trigger sends the secret of the deployment configuration.';

/** The level, category and text of the block of a stranger's Telegram update from `conversation`. */
const strangerUpdate = (conversation: string) =>
  `Warning · Telegram message\nSomeone other than you wrote to the Telegram bot from ${conversation}. The bot did not answer, and nothing of the message was kept. What to do: nothing.`;

/** Where the page after `page` starts. */
const afterPage = (page: JournalPage) => (page.next === null ? {} : { after: page.next });

/** The text that the parts of an export make up, in their order, and how many parts it came in. */
async function received(parts: AsyncIterable<string>): Promise<{ text: string; parts: number }> {
  let text = '';
  let count = 0;
  for await (const part of parts) {
    text += part;
    count += 1;
  }
  return { text, parts: count };
}

/** The text of an export. */
async function joined(parts: AsyncIterable<string>): Promise<string> {
  const { text } = await received(parts);
  return text;
}

describe('reading the journal', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertParents(db);
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
        text: 'You added a followed player to the followed players. His game statistics are fetched once his stats-source mapping is established. What to do: nothing.',
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

  it('[IHM-38] pages the entries of one instant in the order they were written, and lists a period from its start, included, to its end, excluded', async () => {
    const period = { from: at(21, 0), to: at(22, 0) };
    const instants = [period.from, ...Array.from({ length: 5 }, () => at(21, 6)), period.to];
    const ids = await db.transaction(async (tx) => {
      const written: number[] = [];
      for (const occurredAt of instants) {
        written.push(await record(tx, { messageKey: 'login_refused', occurredAt }));
      }
      return written;
    });

    const first = await list(db, { timeZone: PARIS, pageSize: 2, period });
    const second = await list(db, { timeZone: PARIS, pageSize: 2, period, ...afterPage(first) });
    const third = await list(db, { timeZone: PARIS, pageSize: 2, period, ...afterPage(second) });

    // The last entry written, at the period's end, is left out.
    const [atStart, one, two, three, four, five] = ids;
    expect(
      [first, second, third].map((page) => page.entries.map((entry) => entry.id)),
    ).toStrictEqual([
      [five, four],
      [three, two],
      [one, atStart],
    ]);
    expect(third.next).toBeNull();
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
    const plain = await joined(exportText(db, { timeZone: PARIS, period: DAY_18 }));
    const detailed = await joined(
      exportText(db, { timeZone: PARIS, period: DAY_18, withTechnicalDetails: true }),
    );

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

  it('[TRV-49] exports a period longer than one batch whole, each entry once and in order, in parts', async () => {
    // One refused trigger a minute from 00:00 UTC on the 20th, the last at 20:33 UTC.
    const minutes = Array.from({ length: LONG_DAY_ENTRIES }, (_, minute) => minute);
    await db.transaction(async (tx) =>
      recordCountedAttempts(tx, {
        attempts: minutes.map((minute) => ({
          kind: 'refused_trigger',
          at: toEpochMs(at(20, 0) + minute * MINUTE_MS),
        })),
        beyond: [],
      }),
    );
    const exported = exportText(db, {
      timeZone: PARIS,
      period: { from: at(20, 0), to: at(21, 0) },
    });

    const { text, parts } = await received(exported);
    // The title, then one block per entry, each heading the first line of its block.
    const headings = text
      .split('\n\n')
      .slice(1)
      .map((block) => block.split('\n', 1)[0] ?? '');
    expect(parts).toBe(LONG_DAY_ENTRIES + 1);
    expect(new Set(headings).size).toBe(LONG_DAY_ENTRIES);
    expect(headings).toStrictEqual(
      headings.toSorted((left, right) => left.localeCompare(right, 'en')),
    );
    expect([headings[0], headings[1], headings.at(-1)]).toStrictEqual([
      'Friday 20 November 2026, 01:00 Paris time · Warning · Refused trigger',
      'Friday 20 November 2026, 01:01 Paris time · Warning · Refused trigger',
      'Friday 20 November 2026, 21:33 Paris time · Warning · Refused trigger',
    ]);
  });

  it('[TRV-49] exports the entries of one instant once each, in the order they were written, across two batches, and a period from its start, included, to its end, excluded', async () => {
    const period = { from: at(21, 0), to: at(22, 0) };
    const noon = at(21, 12);
    // The entry at the start, these 497 and the first two of noon fill the first batch of 500.
    const earlier = Array.from({ length: 497 }, (_, minute) => ({
      kind: 'refused_trigger' as const,
      at: toEpochMs(period.from + (minute + 1) * MINUTE_MS),
    }));
    const atNoon = (['private', 'refused_trigger', 'group', 'channel', 'private'] as const).map(
      (kind) => ({ kind, at: noon }),
    );
    await db.transaction(async (tx) =>
      recordCountedAttempts(tx, {
        attempts: [
          { kind: 'refused_trigger', at: period.from },
          ...earlier,
          ...atNoon,
          { kind: 'refused_trigger', at: period.to },
        ],
        beyond: [],
      }),
    );

    const exported = await joined(exportText(db, { timeZone: PARIS, period }));

    const blocks = exported.trimEnd().split('\n\n').slice(1);
    const noonHeading = 'Saturday 21 November 2026, 13:00 Paris time ·';
    expect(blocks).toHaveLength(1 + earlier.length + atNoon.length);
    expect(blocks[0]).toBe(`Saturday 21 November 2026, 01:00 Paris time · ${REFUSED_TRIGGER}`);
    expect(blocks.slice(-atNoon.length)).toStrictEqual([
      `${noonHeading} ${strangerUpdate('a private chat')}`,
      `${noonHeading} ${REFUSED_TRIGGER}`,
      `${noonHeading} ${strangerUpdate('a group')}`,
      `${noonHeading} ${strangerUpdate('a channel')}`,
      `${noonHeading} ${strangerUpdate('a private chat')}`,
    ]);
  });
});
