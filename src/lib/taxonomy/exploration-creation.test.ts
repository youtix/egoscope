import { and, count, eq, sql, TransactionRollbackError } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  createTestDatabase,
  drafts,
  eventTypes,
  journalEntries,
  typeIllustrationSources,
} from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS, insertEventType } from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';
import fixture from '@data/fixtures/taxonomy/exploration-types.json';

import { generateExplorationPrompt } from './exploration';
import { createFromExploration } from './exploration-creation';
import { createProposal } from './proposals';
import { doNotReproposeList } from './queries';

import type { ElementPick, ExplorationChoice } from './exploration-creation';
import type { ProposalSheet } from './proposals';
import type { Database, Transaction } from '@/lib/db';

const START = toEpochMs(Date.UTC(2026, 10, 26, 9, 0));
const { feud: FEUD, standoff: STANDOFF, benching: BENCHING } = fixture.types;
const { timed: TIMED, french: FRENCH } = fixture.sources;
const TIMED_URL = TIMED.url.trim();

// A response as an AI pastes it, its keys written as the format writes them.
const responseOf = (types: readonly object[]): string =>
  `Here is the response.\n{"format": "egoscope-exploration", "format_version": "1.0", "proposed_types": ${JSON.stringify(types)}}`;
const THREE_TYPES = responseOf([FEUD, STANDOFF, BENCHING]);
const heldLock = z.object({ classid: z.string(), objid: z.string(), objsubid: z.number() });
const heldLocks = z.object({ rows: z.array(heldLock) });

// A full sheet, every field set, for a proposal that a targeted exploration deepens.
const FULL_SHEET: ProposalSheet = {
  name: 'Dressing room rift',
  definition: 'An old definition.',
  inclusionCriteria: 'Old inclusion.',
  exclusionCriteria: 'Old exclusion.',
  datingRule: 'Old dating rule.',
  knownInAdvance: true,
  genericExample: 'Old example with player A.',
  cautionNotes: 'Rumors are not enough.',
  documentationDifficulty: 'easy',
  isIntimateSubject: true,
  coverageThreshold: { outlets: 4, days: 3 },
  switchedOffCriterion: 'opponent_strength',
};

describe('createFromExploration', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(START));
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  const create = async (choice: ExplorationChoice) =>
    db.transaction(async (tx) => createFromExploration(tx, choice));
  const pick = async (typeId: string, picks: readonly ElementPick[], expectedVersion = 1) =>
    create({ pastedText: THREE_TYPES, ticked: [], target: { typeId, expectedVersion, picks } });
  const tick = async (pastedText: string, position: number) =>
    create({ pastedText, ticked: [position], target: null });
  const saveDraft = async (eventTypeId: string | null) =>
    db.insert(drafts).values({
      kind: 'exploration_response',
      explorationEventTypeId: eventTypeId,
      text: THREE_TYPES,
      originDevice: 'phone',
    });
  async function draftTargets() {
    const rows = await db
      .select({ id: drafts.explorationEventTypeId })
      .from(drafts)
      .orderBy(drafts.id);
    return rows.map(({ id }) => id);
  }
  async function typeCount() {
    const [row] = await db.select({ total: count() }).from(eventTypes);
    return row?.total;
  }
  async function typeOf(id: string) {
    const [row] = await db.select().from(eventTypes).where(eq(eventTypes.id, id));
    return row;
  }
  /** The advisory locks that the session of `reader` holds, by key. */
  async function advisoryLocks(reader: Database | Transaction) {
    return heldLocks.parse(
      await reader.execute(
        sql`select classid::text as classid, objid::text as objid, objsubid::int as objsubid from pg_locks where locktype = 'advisory' order by 1, 2, 3`,
      ),
    ).rows;
  }
  const sourcesOf = async (id: string) =>
    db
      .select()
      .from(typeIllustrationSources)
      .where(eq(typeIllustrationSources.eventTypeId, id))
      .orderBy(typeIllustrationSources.position);
  const savesOf = async (id: string) =>
    db
      .select({ total: count() })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.messageKey, 'type_proposal_saved'),
          eq(journalEntries.eventTypeId, id),
        ),
      );
  async function proposal(sheet: ProposalSheet) {
    const created = await db.transaction(async (tx) => createProposal(tx, 'exploration', sheet));
    if (!created.ok) {
      throw new Error('The proposal was refused.');
    }
    return created.value;
  }

  it('[CA-TAX-08] [DSN-32] discards the exploration draft in the transaction of the caller, so a rollback keeps it with no proposal', async () => {
    const other = await proposal({ name: 'Trade request' });
    await saveDraft(null);
    await saveDraft(other.id);

    const rolledBack = db.transaction(async (tx) => {
      await createFromExploration(tx, { pastedText: THREE_TYPES, ticked: [1, 3], target: null });
      tx.rollback();
    });

    await expect(rolledBack).rejects.toThrow(TransactionRollbackError);
    expect([await typeCount(), await draftTargets()]).toStrictEqual([1, [null, other.id]]);
  });

  it('[CA-TAX-08] [TAX-17] [DSN-32] creates the two ticked types of three as proposals of origin exploration, an incomplete one included, and discards the draft in the same transaction', async () => {
    const other = await proposal({ name: 'Trade request' });
    await saveDraft(null);
    await saveDraft(other.id);

    const saved = await create({ pastedText: THREE_TYPES, ticked: [1, 3, 1], target: null });

    expect(saved.ok && saved.value.created.map((type) => type.id)).toStrictEqual([
      'locker-room-feud',
      'public-benching',
    ]);
    expect(saved.ok && saved.value.target).toBeNull();
    expect(await typeOf('public-benching')).toMatchObject({
      name: BENCHING.name,
      definition: BENCHING.definition,
      inclusionCriteria: null,
      exclusionCriteria: null,
      datingRule: null,
      knownInAdvance: false,
      genericExample: null,
      documentationDifficulty: null,
      status: 'proposed',
      origin: 'exploration',
      createdAt: new Date(START),
    });
    expect(await typeOf('locker-room-feud')).toMatchObject({
      inclusionCriteria: FEUD.inclusion_criteria,
      exclusionCriteria: FEUD.exclusion_criteria,
      datingRule: FEUD.dating_rule,
      genericExample: FEUD.generic_example,
      documentationDifficulty: 'medium',
      status: 'proposed',
      origin: 'exploration',
    });
    expect([await typeCount(), await draftTargets()]).toStrictEqual([3, [other.id]]);
  });

  it('[TAX-02] [CL-TAX-02] creates each proposal under the named lock of the identifiers, held until the caller commits', async () => {
    const named = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('taxonomy.proposal-identifiers'))`,
      );
      return advisoryLocks(tx);
    });

    const held = await db.transaction(async (tx) => {
      await createFromExploration(tx, { pastedText: THREE_TYPES, ticked: [2], target: null });
      return advisoryLocks(tx);
    });

    expect(named).toHaveLength(1);
    expect(held).toStrictEqual(named);
    expect(await advisoryLocks(db)).toStrictEqual([]);
  });

  it('[TAX-03] [CL-TAX-16] stores the kept illustration sources with their proposal only, as published and as written, never in a sheet, a prompt or a classification', async () => {
    await create({ pastedText: THREE_TYPES, ticked: [1], target: null });
    const source = { eventTypeId: 'locker-room-feud' };
    const texts = [
      TIMED.title,
      FRENCH.title,
      'example.com',
      'example.org',
      'Hoops Daily Ledger',
      FRENCH.outlet,
    ];
    const elsewhere = JSON.stringify([
      await typeOf('locker-room-feud'),
      await generateExplorationPrompt(db, { mode: 'general' }),
      await generateExplorationPrompt(db, {
        mode: 'targeted',
        aim: { kind: 'proposal', typeId: 'locker-room-feud' },
      }),
      await doNotReproposeList(db, 'classification'),
    ]);

    // Each row as stored, its identifier aside.
    expect(await sourcesOf('locker-room-feud')).toMatchObject([
      {
        ...source,
        position: 1,
        url: TIMED_URL,
        outlet: 'Hoops Daily Ledger',
        title: TIMED.title,
        publicationDateOn: '2026-11-10',
        publicationAt: new Date(Date.UTC(2026, 10, 11, 2, 45)),
        publicationOffsetMinutes: -300,
      },
      {
        ...source,
        position: 2,
        url: FRENCH.url,
        outlet: FRENCH.outlet,
        title: FRENCH.title,
        publicationDateOn: '2026-11-11',
        publicationAt: null,
        publicationOffsetMinutes: null,
      },
    ]);
    expect(texts.filter((text) => elsewhere.includes(text))).toStrictEqual([]);
  });

  it('[TAX-03] [TAX-17] copies the elements picked in targeted mode into the proposal through editProposal, keeping the rest of its sheet, the picked sources after its own', async () => {
    const target = await proposal(FULL_SHEET);
    await db.insert(typeIllustrationSources).values({
      eventTypeId: target.id,
      position: 1,
      url: 'https://www.example.net/older',
      publicationDateOn: '2026-10-01',
    });
    await saveDraft(null);
    await saveDraft(target.id);

    const saved = await pick(target.id, [
      { element: 'definition', position: 2 },
      { element: 'datingRule', position: 1 },
      { element: 'knownInAdvance', position: 1 },
      { element: 'illustrationSources', position: 1 },
    ]);

    expect(saved).toStrictEqual({
      ok: true,
      value: { created: [], target: await typeOf(target.id) },
    });
    expect(await typeOf(target.id)).toStrictEqual({
      ...target,
      definition: STANDOFF.definition,
      datingRule: FEUD.dating_rule,
      knownInAdvance: false,
      rowVersion: 2,
    });
    expect(await savesOf(target.id)).toStrictEqual([{ total: 2 }]);
    const sources = await sourcesOf(target.id);
    expect(sources.map(({ position, url }) => [position, url])).toStrictEqual([
      [1, 'https://www.example.net/older'],
      [2, TIMED_URL],
      [3, FRENCH.url],
    ]);
    expect(await draftTargets()).toStrictEqual([null]);
  });

  it('[TAX-17] fills a bare proposal with the picked name and difficulty, a later pick winning, and leaves a proposal of which nothing is picked untouched', async () => {
    const bare = await proposal({ name: 'Bare idea' });
    const untouched = await proposal({ name: 'Untouched idea' });

    await pick(bare.id, [
      { element: 'documentationDifficulty', position: 1 },
      { element: 'name', position: 3 },
      { element: 'documentationDifficulty', position: 2 },
    ]);
    const none = await pick(untouched.id, []);

    expect(await typeOf(bare.id)).toStrictEqual({
      ...bare,
      name: BENCHING.name,
      documentationDifficulty: 'hard',
      rowVersion: 2,
    });
    expect(await sourcesOf(bare.id)).toStrictEqual([]);
    expect(none).toStrictEqual({ ok: true, value: { created: [], target: null } });
    expect(await typeOf(untouched.id)).toStrictEqual(untouched);
    expect(await savesOf(untouched.id)).toStrictEqual([{ total: 1 }]);
  });

  it('[CA-TAX-17] [CA-TAX-07] [TAX-17] refuses a research result or a broken response and creates no proposal', async () => {
    const research = '{"format": "egoscope-backtest", "format_version": "1.0"}';

    const refusals = [
      await create({ pastedText: research, ticked: [1], target: null }),
      await create({ pastedText: '{"proposed_types": []', ticked: [1], target: null }),
    ];

    expect(refusals).toStrictEqual([
      {
        ok: false,
        error: {
          kind: 'not_an_exploration_response',
          message: 'This text is not an exploration response.',
        },
      },
      {
        ok: false,
        error: {
          kind: 'cut_not_recoverable',
          message:
            'The text stops before the end of the response. Copy the whole answer again, or ask the AI for fewer types.',
        },
      },
    ]);
    expect(await typeCount()).toBe(0);
  });

  it('[TAX-17] refuses a tick or a pick that the response cannot give, a ticked type that createProposal refuses and a refused edit of the proposal', async () => {
    await insertEventType(db);
    const target = await proposal({ name: 'Trade request' });
    const unnamed = responseOf([{ definition: 'A type without a name.' }, { name: '!!!' }]);

    const refusals = [
      await tick(THREE_TYPES, 0),
      await tick(THREE_TYPES, 4),
      await tick(unnamed, 1),
      await tick(unnamed, 2),
      await pick(target.id, [{ element: 'inclusionCriteria', position: 3 }]),
      await pick(target.id, [{ element: 'definition', position: 4 }]),
      await pick('gone', [{ element: 'definition', position: 1 }]),
      await pick('media-storm', [{ element: 'definition', position: 1 }]),
      await pick(target.id, [{ element: 'definition', position: 1 }], 2),
    ];

    expect(refusals.map((refusal) => !refusal.ok && refusal.error)).toStrictEqual([
      { kind: 'not_in_response', position: 0 },
      { kind: 'not_in_response', position: 4 },
      { kind: 'not_in_response', position: 1 },
      { kind: 'proposal_refused', position: 2, fields: { name: 'no_letters_or_digits' } },
      { kind: 'not_in_response', position: 3 },
      { kind: 'not_in_response', position: 4 },
      { kind: 'no_longer_exists' },
      { kind: 'not_proposed', status: 'validated' },
      { kind: 'changed_elsewhere', current: target },
    ]);
    expect(await typeCount()).toBe(2);
  });
});
