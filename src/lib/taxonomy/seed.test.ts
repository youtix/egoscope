import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createTestDatabase,
  eventTypes,
  eventTypeStatusChanges,
  followedPlayers,
  installation,
  playerDirectoryEntries,
  teams,
  typeSheetVersions,
} from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';
import { toEpochMs } from '@/lib/time';
import disallowedSourceDomains from '@data/seeds/disallowed-source-domains.json';

import { seedCandidateTypes } from './seed';

import type { Database } from '@/lib/db';

const STARTED_AT = toEpochMs(Date.UTC(2026, 10, 20, 8, 15));
const LATER = toEpochMs(Date.UTC(2026, 10, 25, 9, 0));

const SLUGS = [
  'bereavement',
  'birthday',
  'former-team',
  'media-storm',
  'negative-record',
  'player-conflict',
  'public-humiliation',
  'racist-abuse',
  'record-approach',
];

describe('the seeding of the candidate types', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  const types = () => db.select().from(eventTypes).orderBy(asc(eventTypes.id));
  const typeOf = async (id: string) => {
    const [type] = await db.select().from(eventTypes).where(eq(eventTypes.id, id));
    if (type === undefined) {
      throw new Error(`The type ${id} was not seeded.`);
    }
    return type;
  };

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    return database.close;
  }, DATABASE_TEST_TIMEOUT_MS);

  it('[TAX-15] [H-TAX-05] creates the nine candidate types, proposed and of origin scoping, and no validated type', async () => {
    await seedCandidateTypes(db, STARTED_AT);

    const seeded = await types();
    expect(seeded.map((type) => type.id)).toStrictEqual(SLUGS);
    expect(seeded.map((type) => [type.status, type.origin])).toStrictEqual(
      SLUGS.map(() => ['proposed', 'scoping']),
    );
    expect(seeded.map((type) => type.name)).toStrictEqual([
      'Death of a loved one',
      "Player's birthday",
      'Game against a former team',
      'Media storm',
      'Negative record to avoid',
      'Conflict between players',
      'Public humiliation',
      'Racist abuse',
      'Approaching a positive historic record',
    ]);
    await expect(db.select().from(eventTypeStatusChanges)).resolves.toStrictEqual([]);
    await expect(db.select().from(typeSheetVersions)).resolves.toStrictEqual([]);
  });

  it('[TAX-15] [TAX-01] gives each type a starter sheet with every field, and no switched-off criterion', async () => {
    await seedCandidateTypes(db, STARTED_AT);

    const sheets = await types();
    const blank = sheets.filter((type) =>
      [
        type.definition,
        type.inclusionCriteria,
        type.exclusionCriteria,
        type.datingRule,
        type.genericExample,
        type.cautionNotes,
      ].some((text) => text === null || text.trim() === ''),
    );
    expect(blank.map((type) => type.id)).toStrictEqual([]);
    expect(sheets.map((type) => type.switchedOffCriterion)).toStrictEqual(SLUGS.map(() => null));
    expect(sheets.map((type) => type.currentVersionNumber)).toStrictEqual(SLUGS.map(() => null));
  });

  it('[TAX-15] [TAX-01] writes every generic example about an invented player A, and no real person', async () => {
    await seedCandidateTypes(db, STARTED_AT);

    const sheets = await types();
    const examples = sheets.map((type) => type.genericExample ?? '');
    expect(examples.filter((example) => !/\bplayer A\b/iu.test(example))).toStrictEqual([]);
    expect(
      examples.filter((example) => /\b[A-Z][a-z]+ [A-Z][a-z]+\b/u.test(example)),
    ).toStrictEqual([]);
  });

  it('[TAX-15] [TAX-01] gives the documentation difficulty, the intimate-subject mark and the coverage threshold of the glossary', async () => {
    await seedCandidateTypes(db, STARTED_AT);

    const sheets = await types();
    const marks = Object.fromEntries(
      sheets.map((type) => [
        type.id,
        [
          type.documentationDifficulty,
          type.isIntimateSubject,
          type.coverageThresholdOutlets,
          type.coverageThresholdDays,
        ],
      ]),
    );
    expect(marks).toStrictEqual({
      'public-humiliation': ['medium', false, null, null],
      'racist-abuse': ['medium', true, null, null],
      birthday: ['easy', false, null, null],
      'record-approach': ['easy', false, null, null],
      'negative-record': ['easy', false, null, null],
      bereavement: ['medium', true, null, null],
      'player-conflict': ['easy', false, null, null],
      'media-storm': ['hard', false, 3, 2],
      'former-team': ['easy', false, null, null],
    });
  });

  it('[TAX-15] [CL-TAX-20] marks the birthday and the former team as known in advance and derived from the calendar, and no other type', async () => {
    await seedCandidateTypes(db, STARTED_AT);

    const sheets = await types();
    expect(
      sheets
        .filter((type) => type.calendarDerivation !== null)
        .map((type) => [type.id, type.calendarDerivation, type.knownInAdvance]),
    ).toStrictEqual([
      ['birthday', 'birthday', true],
      ['former-team', 'former_team', true],
    ]);
    expect(sheets.filter((type) => type.knownInAdvance).map((type) => type.id)).toStrictEqual([
      'birthday',
      'former-team',
    ]);
  });

  it('[TAX-15] [CL-TAX-12] [CL-TAX-15] drops the press criterion of the birthday and counts the first meeting only for the former team', async () => {
    await seedCandidateTypes(db, STARTED_AT);

    const birthday = await typeOf('birthday');
    const former = await typeOf('former-team');
    expect(birthday.inclusionCriteria).toBe(
      'An official NBA game of his team falls on his birthday.',
    );
    expect(birthday.datingRule).toBe(
      "Known in advance and derived from the calendar: the reference date is the birthday itself, before tip-off, and the measured game is that day's game.",
    );
    expect(former.inclusionCriteria).toBe(
      'An official NBA game; the player played at least one official game for the opposing team; it is their first meeting since his departure.',
    );
    expect(former.datingRule).toBe(
      "Known in advance and derived from the calendar: the reference date is the game's day, before tip-off, so that the measured game is that game itself.",
    );
  });

  it('[TAX-15] [CL-TAX-15] seeds no « statut particulier » line and keeps no French identifier', async () => {
    await seedCandidateTypes(db, STARTED_AT);

    const stored = JSON.stringify(await types());
    expect(stored).not.toMatch(/special status|statut particulier/iu);
    expect(stored).not.toMatch(
      /humiliation-publique|racisme-subi|anniversaire|approche-record|record-negatif|deces-proche|conflit-joueurs|tourmente-mediatique|ancienne-equipe/u,
    );
  });

  it('[TAX-15] [TRV-76] writes the installation row with the first start, once', async () => {
    await seedCandidateTypes(db, STARTED_AT);

    await expect(db.select().from(installation)).resolves.toStrictEqual([
      { id: 1, firstStartedAt: new Date(STARTED_AT) },
    ]);
  });

  it('[TAX-15] [TRV-76] changes nothing when it seeds again, the first start included', async () => {
    await seedCandidateTypes(db, STARTED_AT);
    const before = { installed: await db.select().from(installation), seeded: await types() };

    await seedCandidateTypes(db, LATER);

    await expect(db.select().from(installation)).resolves.toStrictEqual(before.installed);
    await expect(types()).resolves.toStrictEqual(before.seeded);
  });

  it('[TAX-15] [TAX-10] never overwrites a type that the owner has edited, validated or rejected', async () => {
    await seedCandidateTypes(db, STARTED_AT);
    await db
      .update(eventTypes)
      .set({ name: 'Open mockery', definition: 'Mockery, in my own words.', rowVersion: 2 })
      .where(eq(eventTypes.id, 'public-humiliation'));
    await db
      .update(eventTypes)
      .set({ status: 'validated', currentVersionNumber: 1 })
      .where(eq(eventTypes.id, 'media-storm'));
    await db
      .update(eventTypes)
      .set({ status: 'rejected', rejectionReason: 'out_of_scope' })
      .where(eq(eventTypes.id, 'bereavement'));
    const before = await types();

    await seedCandidateTypes(db, LATER);

    await expect(types()).resolves.toStrictEqual(before);
    const edited = await typeOf('public-humiliation');
    expect(edited).toMatchObject({
      name: 'Open mockery',
      definition: 'Mockery, in my own words.',
    });
  });

  it('[TAX-15] [CL-STA-29] seeds no team, no player and no player directory', async () => {
    await seedCandidateTypes(db, STARTED_AT);

    await expect(db.select().from(teams)).resolves.toStrictEqual([]);
    await expect(db.select().from(followedPlayers)).resolves.toStrictEqual([]);
    await expect(db.select().from(playerDirectoryEntries)).resolves.toStrictEqual([]);
  });
});

describe('the disallowed source domains', () => {
  it('[IMP-14] [H-IMP-13] lists lowercase domain names, without scheme or path, each once, sorted', () => {
    expect(disallowedSourceDomains.length).toBeGreaterThan(0);
    const malformed = disallowedSourceDomains.filter(
      (domain) => !/^[a-z\d]+(?:[.-][a-z\d]+)*\.[a-z]+$/u.test(domain),
    );
    expect(malformed).toStrictEqual([]);
    expect(new Set(disallowedSourceDomains).size).toBe(disallowedSourceDomains.length);
    expect(disallowedSourceDomains).toStrictEqual(
      disallowedSourceDomains.toSorted((left, right) => left.localeCompare(right, 'en')),
    );
  });

  it.each([
    ['a social network', 'facebook.com'],
    ['a forum', 'reddit.com'],
    ['a collaborative encyclopedia', 'wikipedia.org'],
    ['a video platform', 'youtube.com'],
  ])('[IMP-14] [H-IMP-13] holds %s', (_kind, domain) => {
    expect(disallowedSourceDomains).toContain(domain);
  });
});
