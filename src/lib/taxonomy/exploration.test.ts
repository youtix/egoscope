import { count, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { parseExplorationResponse } from '@/lib/ai-exchange';
import {
  createTestDatabase,
  drafts,
  eventTypes,
  journalEntries,
  parameterOverrides,
} from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS, insertCalendarType, insertEventType } from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';
import { assertNoBettingWords } from '@/lib/wording';
import fixture from '@data/fixtures/taxonomy/exploration-types.json';

import { generateExplorationPrompt, previewExplorationResponse } from './exploration';
import { createProposal } from './proposals';
import { seedCandidateTypes } from './seed';

import type { ExplorationAim, ExplorationPromptChoice } from './exploration';
import type { Database } from '@/lib/db';

const START = toEpochMs(Date.UTC(2026, 10, 26, 9, 0));
const CREATED_AT = new Date(START);
// The default of imports.maxPastedTextMegabytes.
const MAX_PASTED_MEGABYTES = 2;
const MEDIA_STORM_DEFINITION = 'Wide coverage of one player by the press in a short time.';
const { feud: FEUD, standoff: STANDOFF, benching: BENCHING } = fixture.types;
const SOURCES = fixture.sources;

// A response as an AI pastes it, its keys written as the format writes them.
const responseOf = (types: readonly object[]): string =>
  `Here is the response.\n{"format": "egoscope-exploration", "format_version": "1.0", "proposed_types": ${JSON.stringify(types)}}`;
/** `type` with the illustration sources given, under the key of the format. */
const withSources = (type: object, sources: readonly object[]): object =>
  Object.fromEntries([...Object.entries(type), ['illustration_sources', sources]]);
const THREE_TYPES = responseOf([FEUD, STANDOFF, BENCHING]);

/** The lines of point 5 of a prompt, the existing types. */
const existingTypes = (prompt: string): readonly string[] =>
  prompt
    .split('\n\n')
    .find((block) => block.startsWith('5. '))
    ?.split('\n') ?? [];

describe('the exploration prompt and preview', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
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

  async function prompt(choice: ExplorationPromptChoice): Promise<string> {
    const written = await generateExplorationPrompt(db, choice);
    if (!written.ok) {
      throw new Error(`The prompt was refused: ${JSON.stringify(written.error)}`);
    }
    return written.value;
  }

  describe('generateExplorationPrompt', () => {
    it('[CA-TAX-06] [TAX-16] [CL-TAX-10] cites two validated types by name and definition and a rejected type with its closed-list reason, never its comment', async () => {
      await insertEventType(db, { createdAt: CREATED_AT });
      await insertEventType(db, {
        id: 'player-conflict',
        name: 'Conflict between players',
        definition: 'A public clash between the player and another player.',
        createdAt: CREATED_AT,
      });
      await insertEventType(db, {
        id: 'coach-criticism',
        name: 'Coach criticism',
        definition: 'A coach criticizes the player in public.',
        status: 'rejected',
        rejectionReason: 'duplicate_of_existing_type',
        rejectionComment: 'Already covered by public humiliation.',
        createdAt: CREATED_AT,
      });

      const general = await prompt({ mode: 'general' });

      expect(existingTypes(general)).toStrictEqual([
        '5. EXISTING TYPES',
        '5.1 Validated types, by name and definition:',
        `- Media storm: ${MEDIA_STORM_DEFINITION}`,
        '- Conflict between players: A public clash between the player and another player.',
        '5.2 Pending proposals, not to propose again: none.',
        '5.3 Rejected types, not to propose again, with their rejection reason:',
        '- Coach criticism (rejection reason: duplicate of an existing type): A coach criticizes the player in public.',
        '5.4 Withdrawn types, not to propose again: none.',
      ]);
      expect(general).not.toContain('Already covered');
    });

    it('[CL-TAX-10] [TAX-15] at a first start, lists the nine seeded proposals, the two calendar-derived ones among them, as not to propose again', async () => {
      await seedCandidateTypes(db, START);
      const seeded = await db.select().from(eventTypes).orderBy(eventTypes.id);

      const lines = existingTypes(await prompt({ mode: 'general' }));

      expect(lines.slice(1, 3)).toStrictEqual([
        '5.1 Validated types, by name and definition: none.',
        '5.2 Pending proposals, not to propose again:',
      ]);
      expect(lines.slice(3, 12)).toStrictEqual(
        seeded.map((type) => `- ${type.name}: ${String(type.definition)}`),
      );
      expect(
        seeded.filter((type) => type.calendarDerivation !== null).map((type) => type.id),
      ).toStrictEqual(['birthday', 'former-team']);
    });

    it('[CL-TAX-10] lists a validated calendar-derived type among the validated types and a withdrawn one as not to propose again', async () => {
      await insertCalendarType(db, { createdAt: CREATED_AT });
      await insertCalendarType(db, {
        id: 'former-team',
        name: 'First game against a former team',
        calendarDerivation: 'former_team',
        status: 'withdrawn',
        withdrawalReasonKind: 'entered',
        withdrawalReason: 'Too few games.',
        createdAt: CREATED_AT,
      });

      const lines = existingTypes(await prompt({ mode: 'general' }));

      expect([lines[2], lines.at(-1)]).toStrictEqual([
        `- Player's birthday: ${MEDIA_STORM_DEFINITION}`,
        `- First game against a former team: ${MEDIA_STORM_DEFINITION}`,
      ]);
    });

    it('[TAX-16] targets a trimmed idea, or a proposed type by its current name and definition, which stays not to propose again', async () => {
      await db.transaction(async (tx) =>
        createProposal(tx, 'exploration', { name: 'Trade request' }),
      );
      await db
        .update(eventTypes)
        .set({ definition: 'The player asks in public to be traded.' })
        .where(eq(eventTypes.id, 'trade-request'));

      const idea = await prompt({
        mode: 'targeted',
        aim: { kind: 'idea', idea: '  A rival mocks the player. ' },
      });
      const targeted = await prompt({
        mode: 'targeted',
        aim: { kind: 'proposal', typeId: 'trade-request' },
      });

      expect(idea).toContain('\nIdea to deepen: A rival mocks the player.\n');
      expect(targeted).toContain(
        '\nProposal to deepen: Trade request: The player asks in public to be traded.\n',
      );
      expect(existingTypes(targeted)[3]).toBe(
        '- Trade request: The player asks in public to be traded.',
      );
      expect(targeted).not.toContain('Articles that gave rise');
    });

    it('[TAX-16] refuses a blank idea, and a proposal that is gone or no longer proposed', async () => {
      await insertEventType(db);
      const targeted = async (aim: ExplorationAim) =>
        generateExplorationPrompt(db, { mode: 'targeted', aim });

      const refusals = [
        await targeted({ kind: 'idea', idea: ' \n ' }),
        await targeted({ kind: 'proposal', typeId: 'gone' }),
        await targeted({ kind: 'proposal', typeId: 'media-storm' }),
      ];

      expect(refusals).toStrictEqual([
        { ok: false, error: { kind: 'idea_required' } },
        { ok: false, error: { kind: 'no_longer_exists' } },
        { ok: false, error: { kind: 'not_proposed', status: 'validated' } },
      ]);
    });

    it('[TAX-16] [TAX-09] writes no betting word in any mode, and stores no prompt', async () => {
      await seedCandidateTypes(db, START);
      const before = await db.select().from(eventTypes);

      const prompts = [
        await prompt({ mode: 'general' }),
        await prompt({
          mode: 'targeted',
          aim: { kind: 'idea', idea: 'A rival mocks the player.' },
        }),
        await prompt({ mode: 'targeted', aim: { kind: 'proposal', typeId: 'media-storm' } }),
      ];

      for (const written of prompts) {
        expect(() => {
          assertNoBettingWords(written);
        }).not.toThrow();
      }
      expect(await db.select().from(eventTypes)).toStrictEqual(before);
      expect(await db.select().from(journalEntries)).toStrictEqual([]);
      expect(await db.select().from(drafts)).toStrictEqual([]);
    });
  });

  describe('previewExplorationResponse', () => {
    it('[TAX-17] returns the response as its reader reads it, with the missing elements of each proposed type, and creates nothing', async () => {
      const read = parseExplorationResponse(THREE_TYPES, {
        maxPastedTextMegabytes: MAX_PASTED_MEGABYTES,
      });

      const preview = await previewExplorationResponse(db, THREE_TYPES);

      expect(read.ok && preview.ok).toBe(true);
      expect(
        preview.ok && preview.value.proposedTypes.map((type) => type.proposedType),
      ).toStrictEqual(read.ok && read.response.proposedTypes);
      expect(preview.ok && preview.value.warnings).toStrictEqual([]);
      expect(
        preview.ok && preview.value.proposedTypes[2]?.proposedType.missingElements,
      ).toStrictEqual([
        'inclusion_criteria',
        'exclusion_criteria',
        'dating_rule',
        'known_in_advance',
        'generic_example',
        'documentation_difficulty',
        'possible_overlaps',
        'illustration_sources',
      ]);
      const [types] = await db.select({ total: count() }).from(eventTypes);
      expect(types?.total).toBe(0);
    });

    it('[CA-TAX-17] [TAX-17] refuses a research result as its reader does', async () => {
      const result = '{"format": "egoscope-backtest", "format_version": "1.0", "events": []}';

      expect(await previewExplorationResponse(db, result)).toStrictEqual({
        ok: false,
        error: {
          kind: 'not_an_exploration_response',
          message: 'This text is not an exploration response.',
        },
      });
    });

    it('[TAX-17] [CL-TAX-05] flags each pair of close types, against every type whatever its status and the other proposed types, never a type against itself', async () => {
      await insertEventType(db, { createdAt: CREATED_AT });
      const fight = {
        id: 'locker-room-fight',
        name: 'Locker room fight',
        definition: 'A fight between teammates in the locker room.',
      };
      await insertEventType(db, {
        ...fight,
        status: 'rejected',
        rejectionReason: 'not_clean',
        createdAt: CREATED_AT,
      });
      const frenzy = { name: 'Press frenzy', definition: MEDIA_STORM_DEFINITION };
      const longer = { ...FEUD, name: 'Locker room feud between teammates' };
      const unnamed = { definition: 'A coach changes the starting lineup for a road trip.' };
      const withoutDefinition = { name: 'Quiet offseason' };
      const fightPair = {
        closeness: 'names',
        other: { kind: 'type', ...fight, status: 'rejected' },
      };
      const responsePair = (position: number, name: string) => ({
        closeness: 'both',
        other: { kind: 'proposed_type', position, name, definition: FEUD.definition },
      });

      const preview = await previewExplorationResponse(
        db,
        responseOf([FEUD, frenzy, longer, unnamed, withoutDefinition]),
      );

      expect(
        preview.ok && preview.value.proposedTypes.map((type) => type.possibleDuplicates),
      ).toStrictEqual([
        [fightPair, responsePair(3, longer.name)],
        [
          {
            closeness: 'definitions',
            other: {
              kind: 'type',
              id: 'media-storm',
              name: 'Media storm',
              definition: MEDIA_STORM_DEFINITION,
              status: 'validated',
            },
          },
        ],
        [fightPair, responsePair(1, FEUD.name)],
        [],
        [],
      ]);
    });

    it('[IMP-14] [CL-TAX-04] drops with a warning each illustration source that fails the source checks, on the disallowed domains of imports.disallowedSourceDomains', async () => {
      const { timed, social, french, homePage, future, undated, noOutlet } = SOURCES;
      const sources = [timed, social, french, homePage, future, undated, noOutlet];
      const text = responseOf([withSources(FEUD, sources)]);
      const checksOf = async () => {
        const preview = await previewExplorationResponse(db, text);
        return preview.ok ? preview.value.proposedTypes[0]?.illustrationSources : undefined;
      };
      const dated = (position: number, on: string) => ({
        position,
        cleanedUrl: sources[position - 1]?.url,
        publicationDate: { kind: 'date', on },
        dateWarning: undefined,
      });

      const byDefault = await checksOf();
      await db.insert(parameterOverrides).values({
        parameterKey: 'imports.disallowedSourceDomains',
        value: ['example.org'],
        changedAt: CREATED_AT,
      });
      const overridden = await checksOf();

      expect(byDefault).toStrictEqual({
        kept: [
          {
            position: 1,
            url: 'https://www.example.com/news/2026/11/10/forward-a-and-center-b-clash?utm_source=feed',
            cleanedUrl: 'https://www.example.com/news/2026/11/10/forward-a-and-center-b-clash',
            outlet: 'Hoops Daily Ledger',
            title: timed.title,
            publicationDate: {
              kind: 'instant',
              on: '2026-11-10',
              at: Date.UTC(2026, 10, 11, 2, 45),
              offsetMinutes: -300,
            },
            dateWarning: undefined,
          },
          {
            ...dated(3, '2026-11-11'),
            url: french.url,
            outlet: french.outlet,
            title: french.title,
          },
          {
            ...dated(7, '2026-11-09'),
            url: noOutlet.url,
            outlet: undefined,
            title: noOutlet.title,
          },
        ],
        warnings: [
          { kind: 'source_dropped', position: 2, cause: 'disallowed_domain' },
          { kind: 'source_dropped', position: 4, cause: 'home_page' },
          { kind: 'source_dropped', position: 5, cause: 'publication_date_in_future' },
          { kind: 'source_dropped', position: 6, cause: 'publication_date_missing' },
          { kind: 'source_outlet_or_title_missing', position: 7 },
        ],
      });
      expect(overridden?.kept.map((source) => source.position)).toStrictEqual([1, 2]);
      expect(overridden?.warnings.slice(0, 2)).toStrictEqual([
        { kind: 'source_dropped', position: 3, cause: 'disallowed_domain' },
        { kind: 'source_dropped', position: 4, cause: 'home_page' },
      ]);
    });
  });
});
