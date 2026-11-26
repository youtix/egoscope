import { and, asc, count, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  articles,
  createTestDatabase,
  eventTypes,
  eventTypeStatusChanges,
  followedPlayers,
  journalEntries,
  typeOccurrences,
} from '@/lib/db';
import {
  BIRTHDAY,
  DATABASE_TEST_TIMEOUT_MS,
  insertCalendarType,
  insertEventType,
  insertPlayer,
  leaguePlayerId,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import {
  addOccurrence,
  attachAsOccurrence,
  detachOccurrence,
  eraseOccurrencesOf,
  proposalArticleReferences,
  receiveDetectionProposal,
} from './detection-proposals';
import { createProposal } from './proposals';

import type { DetectedFact } from './detection-proposals';
import type { Database } from '@/lib/db';

const START = toEpochMs(Date.UTC(2026, 10, 25, 9, 0));
const EARLIER = toEpochMs(Date.UTC(2026, 10, 23, 18, 30));
const LATER = toEpochMs(Date.UTC(2026, 10, 24, 7, 15));
const FIRST_PLAYER = leaguePlayerId('p01');
const SECOND_PLAYER = leaguePlayerId('p02');
const NO_FIT_REASON = 'The player publicly refused to travel with his team.';
const SECOND_JUSTIFICATION = 'The player again refused to travel with his team.';
const CONTRACT_DISPUTE = 'contract-dispute';
const REJECTED_TYPE = 'locker-room-feud';
const WITHDRAWN_TYPE = 'coach-criticism';
const VALIDATED_TYPE = 'media-storm';

const FIRST_ARTICLE = {
  url: 'https://news.example.com/2026/11/23/refusal',
  outlet: 'Example News',
  title: 'A guard refuses to travel',
  publishedAt: EARLIER,
  publicationPrecision: 'exact',
} as const;
const SECOND_ARTICLE = {
  url: 'https://daily.example.org/travel',
  outlet: null,
  title: null,
  publishedAt: LATER,
  publicationPrecision: 'approximate',
} as const;

const FIRST_FACT: DetectedFact = {
  playerId: FIRST_PLAYER,
  article: FIRST_ARTICLE,
  justification: NO_FIT_REASON,
};
const SECOND_FACT: DetectedFact = {
  playerId: SECOND_PLAYER,
  article: SECOND_ARTICLE,
  justification: SECOND_JUSTIFICATION,
};
const SUGGESTION = {
  name: 'Contract dispute',
  definition: 'A public dispute between a player and his club about his contract.',
  fact: FIRST_FACT,
} as const;

/** The stored columns of an occurrence of `typeId` that copies `fact`, recorded at the start. */
function storedOccurrence(typeId: string, fact: DetectedFact, isOriginatingFact: boolean) {
  return {
    eventTypeId: typeId,
    playerId: fact.playerId,
    recordedAt: new Date(START),
    isOriginatingFact,
    justification: fact.justification,
    articleUrl: fact.article.url,
    articleOutlet: fact.article.outlet,
    articleTitle: fact.article.title,
    articlePublishedAt: new Date(fact.article.publishedAt),
    articlePublicationPrecision: fact.article.publicationPrecision,
  };
}

describe(
  'the proposals and occurrences that detection hands over',
  { timeout: DATABASE_TEST_TIMEOUT_MS },
  () => {
    let db: Database;

    beforeEach(async () => {
      const database = await createTestDatabase();
      db = database.db;
      const restoreClock = installFakeClock(fixedClock(START));
      await insertPlayer(db, { source: 'p01' });
      await insertPlayer(db, { source: 'p02' });
      return async () => {
        restoreClock();
        await database.close();
      };
    }, DATABASE_TEST_TIMEOUT_MS);

    const receive = async () =>
      db.transaction(async (tx) => receiveDetectionProposal(tx, SUGGESTION));
    const add = async (entryId: string, fact: DetectedFact) =>
      db.transaction(async (tx) => addOccurrence(tx, entryId, fact));
    const attach = async (proposalId: string, entryId: string) =>
      db.transaction(async (tx) => attachAsOccurrence(tx, proposalId, entryId));
    const detach = async (occurrenceId: number, name: string) =>
      db.transaction(async (tx) => detachOccurrence(tx, occurrenceId, { name }));

    const typeOf = async (typeId: string) => {
      const [row] = await db.select().from(eventTypes).where(eq(eventTypes.id, typeId));
      return row;
    };
    const typeCount = async () => db.select({ total: count() }).from(eventTypes);

    /** Every occurrence, in the order recorded; its identifier is left to `toMatchObject`. */
    const occurrences = async () =>
      db.select().from(typeOccurrences).orderBy(asc(typeOccurrences.id));
    const occurrenceIds = async (typeId: string) =>
      db
        .select({ id: typeOccurrences.id })
        .from(typeOccurrences)
        .where(eq(typeOccurrences.eventTypeId, typeId))
        .orderBy(asc(typeOccurrences.id));

    /** The occurrence count of a type's sheet: its occurrences other than its originating fact (TAX-18). */
    const occurrenceCount = async (typeId: string) => {
      const [row] = await db
        .select({ total: count() })
        .from(typeOccurrences)
        .where(
          and(
            eq(typeOccurrences.eventTypeId, typeId),
            eq(typeOccurrences.isOriginatingFact, false),
          ),
        );
      return row?.total;
    };

    const journaled = async (messageKey: 'type_proposal_saved' | 'type_rejected') =>
      db
        .select({ eventTypeId: journalEntries.eventTypeId })
        .from(journalEntries)
        .where(eq(journalEntries.messageKey, messageKey));

    const insertRejected = async () =>
      insertEventType(db, {
        id: REJECTED_TYPE,
        name: 'Locker-room feud',
        status: 'rejected',
        origin: 'exploration',
        rejectionReason: 'not_clean',
      });
    const insertWithdrawn = async () =>
      insertEventType(db, {
        id: WITHDRAWN_TYPE,
        name: 'Coach criticism',
        status: 'withdrawn',
        withdrawalReasonKind: 'entered',
        withdrawalReason: 'It overlapped the media storm.',
      });

    /** A detection proposal of origin `SUGGESTION`, received, with its identifier. */
    async function received(): Promise<string> {
      const result = await receive();
      if (!result.ok) {
        throw new Error(`The proposal was refused: ${JSON.stringify(result.error)}`);
      }
      return result.value.typeId;
    }

    describe('receiveDetectionProposal', () => {
      it('[TAX-18] [CL-TEL-10] [CL-DET-19] creates a detection proposal with the suggested name and definition, no intimate-subject mark and the reason no validated type fits, and reports it created', async () => {
        expect(await receive()).toStrictEqual({
          ok: true,
          value: { typeId: CONTRACT_DISPUTE, created: true },
        });
        expect(await typeOf(CONTRACT_DISPUTE)).toMatchObject({
          status: 'proposed',
          origin: 'detection',
          createdAt: new Date(START),
          name: SUGGESTION.name,
          definition: SUGGESTION.definition,
          isIntimateSubject: false,
          noFitReason: NO_FIT_REASON,
          calendarDerivation: null,
          rowVersion: 1,
        });
      });

      it('[TAX-18] [CL-DET-19] records the originating occurrence with its player, the copied reference of its article and its justification, outside the occurrence count', async () => {
        await receive();
        expect(await occurrences()).toMatchObject([
          storedOccurrence(CONTRACT_DISPUTE, FIRST_FACT, true),
        ]);
        expect(await occurrenceCount(CONTRACT_DISPUTE)).toBe(0);
      });

      it('[TAX-18] journals the proposal through the creation of proposals, and gives a second one of the same name another identifier', async () => {
        await receive();
        expect(await receive()).toStrictEqual({
          ok: true,
          value: { typeId: `${CONTRACT_DISPUTE}-2`, created: true },
        });
        expect(await journaled('type_proposal_saved')).toStrictEqual([
          { eventTypeId: CONTRACT_DISPUTE },
          { eventTypeId: `${CONTRACT_DISPUTE}-2` },
        ]);
      });

      it('[TAX-18] refuses a blank suggested name, and records neither a proposal nor an occurrence', async () => {
        const before = await typeCount();
        const result = await db.transaction(async (tx) =>
          receiveDetectionProposal(tx, { ...SUGGESTION, name: '  ' }),
        );
        expect(result).toStrictEqual({
          ok: false,
          error: { kind: 'invalid_fields', fields: { name: 'required' } },
        });
        expect(await typeCount()).toStrictEqual(before);
        expect(await occurrences()).toStrictEqual([]);
      });
    });

    describe('addOccurrence', () => {
      it('[CA-TAX-09] [TAX-18] adds an occurrence to a pending detection proposal, creates no proposal, reports created = false and grows its occurrence count', async () => {
        await received();
        const before = await typeCount();
        expect(await add(CONTRACT_DISPUTE, SECOND_FACT)).toStrictEqual({
          ok: true,
          value: { typeId: CONTRACT_DISPUTE, created: false },
        });
        expect(await typeCount()).toStrictEqual(before);
        expect(await occurrences()).toMatchObject([
          storedOccurrence(CONTRACT_DISPUTE, FIRST_FACT, true),
          storedOccurrence(CONTRACT_DISPUTE, SECOND_FACT, false),
        ]);
        expect(await occurrenceCount(CONTRACT_DISPUTE)).toBe(1);
        await add(CONTRACT_DISPUTE, FIRST_FACT);
        expect(await occurrenceCount(CONTRACT_DISPUTE)).toBe(2);
      });

      it.each([
        ['rejected', REJECTED_TYPE],
        ['withdrawn', WITHDRAWN_TYPE],
      ] as const)(
        '[CA-TAX-09] [TAX-18] adds an occurrence to a %s type, which no proposal follows',
        async (_status, typeId) => {
          await insertRejected();
          await insertWithdrawn();
          const before = await typeCount();
          expect(await add(typeId, SECOND_FACT)).toStrictEqual({
            ok: true,
            value: { typeId, created: false },
          });
          expect(await typeCount()).toStrictEqual(before);
          expect(await occurrences()).toMatchObject([storedOccurrence(typeId, SECOND_FACT, false)]);
          expect(await occurrenceCount(typeId)).toBe(1);
        },
      );

      it('[CA-TAX-09] [TAX-18] refuses a validated type, which is no entry of the do-not-repropose list', async () => {
        await insertEventType(db);
        expect(await add(VALIDATED_TYPE, SECOND_FACT)).toStrictEqual({
          ok: false,
          error: { kind: 'not_an_entry', status: 'validated' },
        });
        expect(await occurrences()).toStrictEqual([]);
      });

      it.each(['proposed', 'validated'] as const)(
        '[CA-TAX-09] [CL-TAX-21] refuses a %s calendar-derived type, whose facts give no occurrence',
        async (status) => {
          const calendarType = await insertCalendarType(db, { status });
          expect(await add(calendarType.id, SECOND_FACT)).toStrictEqual({
            ok: false,
            error: { kind: 'handled_by_calendar' },
          });
          expect(await occurrences()).toStrictEqual([]);
        },
      );

      it('[TAX-18] refuses a type that does not exist', async () => {
        expect(await add('no-such-type', SECOND_FACT)).toStrictEqual({
          ok: false,
          error: { kind: 'no_longer_exists' },
        });
      });
    });

    describe('attachAsOccurrence', () => {
      it('[TAX-18] [H-TAX-12] moves the proposal’s occurrences to the entry as ordinary occurrences, the entry’s own staying', async () => {
        await insertRejected();
        await add(REJECTED_TYPE, FIRST_FACT);
        await received();
        await add(CONTRACT_DISPUTE, SECOND_FACT);
        expect(await attach(CONTRACT_DISPUTE, REJECTED_TYPE)).toStrictEqual({ ok: true, value: 2 });
        expect(await occurrences()).toMatchObject([
          storedOccurrence(REJECTED_TYPE, FIRST_FACT, false),
          storedOccurrence(REJECTED_TYPE, FIRST_FACT, false),
          storedOccurrence(REJECTED_TYPE, SECOND_FACT, false),
        ]);
        expect(await occurrenceCount(REJECTED_TYPE)).toBe(3);
        expect(await occurrenceCount(CONTRACT_DISPUTE)).toBe(0);
      });

      it('[TAX-18] [H-TAX-12] [TAX-02] rejects the proposal as a duplicate of an existing type, with its dated transition', async () => {
        await received();
        await db.transaction(async (tx) => createProposal(tx, 'exploration', { name: 'Holdout' }));
        expect(await attach(CONTRACT_DISPUTE, 'holdout')).toStrictEqual({ ok: true, value: 1 });
        expect(await typeOf(CONTRACT_DISPUTE)).toMatchObject({
          status: 'rejected',
          rejectionReason: 'duplicate_of_existing_type',
          rejectionComment: null,
          rowVersion: 2,
        });
        expect(await typeOf('holdout')).toMatchObject({ status: 'proposed', rowVersion: 1 });
        expect(await db.select().from(eventTypeStatusChanges)).toMatchObject([
          {
            eventTypeId: CONTRACT_DISPUTE,
            changedAt: new Date(START),
            fromStatus: 'proposed',
            toStatus: 'rejected',
          },
        ]);
      });

      it('[TAX-18] [H-TAX-12] [TAX-02] journals the rejection, the identifier of the rejected proposal staying taken', async () => {
        await insertRejected();
        await received();
        await attach(CONTRACT_DISPUTE, REJECTED_TYPE);
        expect(await journaled('type_rejected')).toStrictEqual([{ eventTypeId: CONTRACT_DISPUTE }]);
        expect(await receive()).toStrictEqual({
          ok: true,
          value: { typeId: `${CONTRACT_DISPUTE}-2`, created: true },
        });
      });

      it.each([
        {
          refused: 'a proposal that does not exist',
          proposalId: 'no-such-type',
          entryId: CONTRACT_DISPUTE,
          error: { kind: 'no_longer_exists' },
        },
        {
          refused: 'a proposal no longer proposed',
          proposalId: REJECTED_TYPE,
          entryId: CONTRACT_DISPUTE,
          error: { kind: 'not_proposed', status: 'rejected' },
        },
        {
          refused: 'a proposal not from detection',
          proposalId: 'holdout',
          entryId: CONTRACT_DISPUTE,
          error: { kind: 'not_from_detection' },
        },
        {
          refused: 'the proposal itself as its entry',
          proposalId: CONTRACT_DISPUTE,
          entryId: CONTRACT_DISPUTE,
          error: { kind: 'same_type' },
        },
        {
          refused: 'an entry that does not exist',
          proposalId: CONTRACT_DISPUTE,
          entryId: 'no-such-type',
          error: { kind: 'invalid_entry', refusal: { kind: 'no_longer_exists' } },
        },
        {
          refused: 'a validated entry',
          proposalId: CONTRACT_DISPUTE,
          entryId: VALIDATED_TYPE,
          error: { kind: 'invalid_entry', refusal: { kind: 'not_an_entry', status: 'validated' } },
        },
        {
          refused: 'a calendar-derived entry',
          proposalId: CONTRACT_DISPUTE,
          entryId: BIRTHDAY,
          error: { kind: 'invalid_entry', refusal: { kind: 'handled_by_calendar' } },
        },
      ] as const)(
        '[TAX-18] [H-TAX-12] [CL-TAX-21] refuses $refused, and leaves everything as it was',
        async ({ proposalId, entryId, error }) => {
          await insertRejected();
          await insertEventType(db);
          await insertCalendarType(db, { status: 'proposed' });
          await insertEventType(db, {
            id: 'holdout',
            name: 'Holdout',
            status: 'proposed',
            origin: 'exploration',
          });
          await received();
          expect(await attach(proposalId, entryId)).toStrictEqual({ ok: false, error });
          expect(await typeOf(CONTRACT_DISPUTE)).toMatchObject({
            status: 'proposed',
            rowVersion: 1,
          });
          expect(await occurrences()).toMatchObject([
            storedOccurrence(CONTRACT_DISPUTE, FIRST_FACT, true),
          ]);
        },
      );
    });

    describe('detachOccurrence', () => {
      it('[TAX-18] [H-TAX-12] [CL-DET-19] turns an occurrence into a distinct detection proposal that carries it as its originating fact', async () => {
        await insertRejected();
        await add(REJECTED_TYPE, FIRST_FACT);
        await add(REJECTED_TYPE, SECOND_FACT);
        const [, second] = await occurrenceIds(REJECTED_TYPE);
        const detached = await detach(second?.id ?? 0, 'Travel refusal');
        expect(detached).toMatchObject({
          ok: true,
          value: {
            id: 'travel-refusal',
            status: 'proposed',
            origin: 'detection',
            name: 'Travel refusal',
            noFitReason: SECOND_JUSTIFICATION,
          },
        });
        expect(await occurrences()).toMatchObject([
          storedOccurrence(REJECTED_TYPE, FIRST_FACT, false),
          storedOccurrence('travel-refusal', SECOND_FACT, true),
        ]);
        expect(await occurrenceCount(REJECTED_TYPE)).toBe(1);
        expect({ ok: true, value: await typeOf('travel-refusal') }).toStrictEqual(detached);
        expect(await journaled('type_proposal_saved')).toStrictEqual([
          { eventTypeId: 'travel-refusal' },
        ]);
      });

      it.each([
        {
          refused: 'the fact that created its proposal',
          position: 0,
          name: 'Travel refusal',
          error: { kind: 'originating_fact' },
        },
        {
          refused: 'an occurrence that does not exist',
          position: 2,
          name: 'Travel refusal',
          error: { kind: 'no_longer_exists' },
        },
        {
          refused: 'a blank name',
          position: 1,
          name: ' ',
          error: { kind: 'invalid_fields', fields: { name: 'required' } },
        },
      ] as const)(
        '[TAX-18] [H-TAX-12] refuses $refused, and moves nothing',
        async ({ position, name, error }) => {
          await received();
          await add(CONTRACT_DISPUTE, SECOND_FACT);
          const [originating, added] = await occurrenceIds(CONTRACT_DISPUTE);
          const ids = [originating?.id ?? 0, added?.id ?? 0, (added?.id ?? 0) + 1];
          expect(await detach(ids[position] ?? 0, name)).toStrictEqual({ ok: false, error });
          expect(await typeOf('travel-refusal')).toBeUndefined();
          expect(await occurrences()).toMatchObject([
            storedOccurrence(CONTRACT_DISPUTE, FIRST_FACT, true),
            storedOccurrence(CONTRACT_DISPUTE, SECOND_FACT, false),
          ]);
        },
      );
    });

    describe('eraseOccurrencesOf', () => {
      it('[DSN-34] [TAX-18] deletes every occurrence that copied an erased article’s link, the originating one included, and keeps the others', async () => {
        await insertRejected();
        await received();
        await add(CONTRACT_DISPUTE, SECOND_FACT);
        await add(REJECTED_TYPE, { ...SECOND_FACT, playerId: FIRST_PLAYER });
        await add(REJECTED_TYPE, FIRST_FACT);
        expect(
          await db.transaction(async (tx) => eraseOccurrencesOf(tx, [FIRST_ARTICLE.url])),
        ).toBe(2);
        expect(await occurrences()).toMatchObject([
          storedOccurrence(CONTRACT_DISPUTE, SECOND_FACT, false),
          storedOccurrence(REJECTED_TYPE, { ...SECOND_FACT, playerId: FIRST_PLAYER }, false),
        ]);
      });
    });

    describe('proposalArticleReferences', () => {
      it('[TAX-18] [DSN-09] gives link, outlet, title and publication of each article of the type once, by publication, never a text, with no article kept', async () => {
        await insertRejected();
        await add(REJECTED_TYPE, {
          ...FIRST_FACT,
          article: { ...FIRST_ARTICLE, url: 'https://other.example.net/a' },
        });
        await received();
        await add(CONTRACT_DISPUTE, SECOND_FACT);
        await add(CONTRACT_DISPUTE, { ...SECOND_FACT, playerId: FIRST_PLAYER });
        expect(await proposalArticleReferences(db, CONTRACT_DISPUTE)).toStrictEqual([
          FIRST_ARTICLE,
          SECOND_ARTICLE,
        ]);
        expect(await db.select({ total: count() }).from(articles)).toStrictEqual([{ total: 0 }]);
      });

      it('[TAX-18] orders the articles published at the same instant by their link', async () => {
        const sameInstant = { ...SECOND_ARTICLE, publishedAt: EARLIER };
        await received();
        await add(CONTRACT_DISPUTE, { ...SECOND_FACT, article: sameInstant });
        expect(await proposalArticleReferences(db, CONTRACT_DISPUTE)).toStrictEqual([
          sameInstant,
          FIRST_ARTICLE,
        ]);
      });
    });

    it('[CL-JOU-06] [TAX-18] deletes the occurrences of a player with his data, and keeps the others', async () => {
      await received();
      await add(CONTRACT_DISPUTE, SECOND_FACT);
      await db.delete(followedPlayers).where(eq(followedPlayers.id, SECOND_PLAYER));
      expect(await occurrences()).toMatchObject([
        storedOccurrence(CONTRACT_DISPUTE, FIRST_FACT, true),
      ]);
    });
  },
);
