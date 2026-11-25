import { asc, eq, getTableColumns } from 'drizzle-orm';
import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest';

import {
  createTestDatabase,
  followedPlayers,
  journalEntries,
  playerNameVariants,
  playerTeamChanges,
  teams,
} from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { setBirthdayFromSource, updateIdentity } from './identity';
import { get, normalizeName } from './queries';
import { enterTeamChange } from './teams';

import type { Birthday, IdentityChange, SourceBirthday } from './identity';
import type { NewFollowedPlayerRow } from './types';
import type { Database } from '@/lib/db';

const START = toEpochMs(Date.UTC(2026, 10, 23, 9, 0));
const ARDEN = '00000000-0000-4000-8000-000000000001';
const BRISCO = '00000000-0000-4000-8000-000000000002';
const NOBODY = '00000000-0000-4000-8000-000000000099';
const FIRST_VERSION = 1;
const MID_MARCH: Birthday = { month: 3, day: 14 };
const LATE_MARCH: Birthday = { month: 3, day: 28 };
const LEAP_DAY: Birthday = { month: 2, day: 29 };
const SOURCE_MID_MARCH = {
  birthdayMonth: 3,
  birthdayDay: 14,
  birthdayOrigin: 'stats_source',
} as const;
const OWNER_MID_MARCH = { birthdayMonth: 3, birthdayDay: 14, birthdayOrigin: 'owner' } as const;
const IMPOSSIBLE = {
  ok: false,
  error: { kind: 'invalid_fields', fields: { birthday: 'impossible_date' } },
};

/** A save of Arden's identity as the screen showed it at the first version. */
function change(changes: Partial<IdentityChange> = {}): IdentityChange {
  return {
    displayName: 'Arden Vale',
    variants: [],
    birthday: null,
    expectedVersion: FIRST_VERSION,
    ...changes,
  };
}

/** The journal entry of `messageKey` about Arden, which carries no value. */
const entry = (messageKey: string) => ({ messageKey, playerId: ARDEN, messageParams: {} });

describe('the edit of a followed player’s identity', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
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

  /** Follows the invented player `id` named `displayName`, `columns` replacing any column. */
  async function follow(
    id: string,
    displayName: string,
    columns: Partial<NewFollowedPlayerRow> = {},
  ) {
    await db.insert(followedPlayers).values({
      id,
      displayName,
      displayNameNormalized: normalizeName(displayName),
      ...columns,
    });
  }

  /** Gives `id` the spelling variants `texts`. */
  async function giveVariants(id: string, texts: readonly string[]) {
    await db.insert(playerNameVariants).values(
      texts.map((text) => ({
        playerId: id,
        kind: 'spelling' as const,
        text,
        normalizedText: normalizeName(text),
      })),
    );
  }

  async function update(playerId: string, identity: IdentityChange) {
    return db.transaction(async (tx) => updateIdentity(tx, playerId, identity));
  }

  async function fromSource(playerId: string, birthday: SourceBirthday) {
    return db.transaction(async (tx) => setBirthdayFromSource(tx, playerId, birthday));
  }

  /** The display name and version of Arden. */
  async function ardenName() {
    const [row] = await db
      .select({
        displayName: followedPlayers.displayName,
        displayNameNormalized: followedPlayers.displayNameNormalized,
        rowVersion: followedPlayers.rowVersion,
      })
      .from(followedPlayers)
      .where(eq(followedPlayers.id, ARDEN));
    return row;
  }

  /** The variants of `id` as kind, text and mark, in entry order. */
  async function variantsOf(id: string) {
    return db
      .select({
        kind: playerNameVariants.kind,
        text: playerNameVariants.text,
        normalizedText: playerNameVariants.normalizedText,
        isAmbiguous: playerNameVariants.isAmbiguous,
      })
      .from(playerNameVariants)
      .where(eq(playerNameVariants.playerId, id))
      .orderBy(asc(playerNameVariants.id));
  }

  /** The birthday columns and version of `id`. */
  async function birthdayRow(id: string) {
    const [row] = await db
      .select({
        birthdayMonth: followedPlayers.birthdayMonth,
        birthdayDay: followedPlayers.birthdayDay,
        birthdayOrigin: followedPlayers.birthdayOrigin,
        rowVersion: followedPlayers.rowVersion,
      })
      .from(followedPlayers)
      .where(eq(followedPlayers.id, id));
    return row;
  }

  /** The journal entries, oldest first, as message, player and parameters. */
  async function journal() {
    return db
      .select({
        messageKey: journalEntries.messageKey,
        playerId: journalEntries.playerId,
        messageParams: journalEntries.messageParams,
      })
      .from(journalEntries)
      .orderBy(asc(journalEntries.id));
  }

  it('[JOU-12] changes the display name, keeps the former one as a spelling variant, and journals the change', async () => {
    await follow(ARDEN, 'Arden Vale');

    const saved = await update(ARDEN, change({ displayName: '  Arden  Vale-Moss ' }));

    expect(saved).toStrictEqual({
      ok: true,
      value: { birthdayChanged: false, addedVariants: ['Arden  Vale-Moss'], sharedVariants: [] },
    });
    expect(await ardenName()).toStrictEqual({
      displayName: 'Arden  Vale-Moss',
      displayNameNormalized: 'arden vale-moss',
      rowVersion: 2,
    });
    expect(await variantsOf(ARDEN)).toStrictEqual([
      { kind: 'spelling', text: 'Arden Vale', normalizedText: 'arden vale', isAmbiguous: false },
    ]);
    expect(await journal()).toStrictEqual([entry('player_identity_changed')]);
  });

  it('[JOU-12] [CL-JOU-13] keeps no variant for a display name that changes in case and spaces only, nor one already kept', async () => {
    await follow(ARDEN, 'Arden Vale');
    await follow(BRISCO, 'Brisco Hale', { rowVersion: 4 });

    const recased = await update(ARDEN, change({ displayName: 'ARDEN   vale' }));
    const keptByOwner = [{ kind: 'nickname' as const, text: 'brisco hale', isAmbiguous: true }];
    await update(
      BRISCO,
      change({ displayName: 'Brisco Hale Jr.', variants: keptByOwner, expectedVersion: 4 }),
    );

    expect(recased).toMatchObject({ ok: true, value: { addedVariants: [] } });
    expect(await ardenName()).toMatchObject({ displayName: 'ARDEN   vale' });
    expect(await variantsOf(ARDEN)).toStrictEqual([]);
    expect(await variantsOf(BRISCO)).toStrictEqual([
      { kind: 'nickname', text: 'brisco hale', normalizedText: 'brisco hale', isAmbiguous: true },
    ]);
  });

  it('[JOU-08] [JOU-09] [CL-JOU-13] adds, edits and removes variants and marks, accents kept apart, giving only the names new to him', async () => {
    await follow(ARDEN, 'Arden Vale');
    await giveVariants(ARDEN, ['A. Vale', 'Ardy', 'The Lighthouse']);

    const saved = await update(
      ARDEN,
      change({
        variants: [
          { kind: 'nickname', text: 'ARDY', isAmbiguous: true },
          { kind: 'spelling', text: 'A. Vale', isAmbiguous: false },
          { kind: 'spelling', text: ' Josué Vale ', isAmbiguous: false },
          { kind: 'spelling', text: 'Josue Vale', isAmbiguous: false },
        ],
      }),
    );

    expect(saved).toStrictEqual({
      ok: true,
      value: {
        birthdayChanged: false,
        addedVariants: ['Josué Vale', 'Josue Vale'],
        sharedVariants: [],
      },
    });
    expect(await variantsOf(ARDEN)).toStrictEqual([
      { kind: 'spelling', text: 'A. Vale', normalizedText: 'a. vale', isAmbiguous: false },
      { kind: 'nickname', text: 'ARDY', normalizedText: 'ardy', isAmbiguous: true },
      { kind: 'spelling', text: 'Josué Vale', normalizedText: 'josué vale', isAmbiguous: false },
      { kind: 'spelling', text: 'Josue Vale', normalizedText: 'josue vale', isAmbiguous: false },
    ]);
    expect(await journal()).toStrictEqual([entry('player_identity_changed')]);
  });

  it('[JOU-09] [CL-JOU-13] refuses, field by field, an empty name or variant and one the same as another of his names, writing nothing', async () => {
    await follow(ARDEN, 'Arden Vale');

    const saved = await update(
      ARDEN,
      change({
        displayName: ' '.repeat(3),
        variants: [
          { kind: 'spelling', text: 'Vale Storm', isAmbiguous: false },
          { kind: 'nickname', text: '\t', isAmbiguous: false },
          { kind: 'nickname', text: '  VALE   storm ', isAmbiguous: true },
        ],
      }),
    );
    const sameAsName = await update(
      ARDEN,
      change({ variants: [{ kind: 'nickname', text: 'arden vale', isAmbiguous: false }] }),
    );

    expect(saved).toStrictEqual({
      ok: false,
      error: {
        kind: 'invalid_fields',
        fields: {
          displayName: 'required',
          variants: [
            { index: 1, problem: 'required' },
            { index: 2, problem: 'duplicate' },
          ],
        },
      },
    });
    expect(sameAsName).toStrictEqual({
      ok: false,
      error: { kind: 'invalid_fields', fields: { variants: [{ index: 0, problem: 'duplicate' }] } },
    });
    expect(await ardenName()).toMatchObject({ displayName: 'Arden Vale', rowVersion: 1 });
    expect(await variantsOf(ARDEN)).toStrictEqual([]);
    expect(await journal()).toStrictEqual([]);
  });

  it('[JOU-09] [CA-JOU-06] accepts a name another followed player has, with the warning naming him', async () => {
    await follow(ARDEN, 'Arden Vale');
    await follow(BRISCO, 'Brisco Hale', { status: 'paused' });
    await giveVariants(BRISCO, ['The Lighthouse']);

    const saved = await update(
      ARDEN,
      change({ variants: [{ kind: 'nickname', text: 'the lighthouse', isAmbiguous: true }] }),
    );

    expect(saved).toStrictEqual({
      ok: true,
      value: {
        birthdayChanged: false,
        addedVariants: ['the lighthouse'],
        sharedVariants: [{ text: 'the lighthouse', playerId: BRISCO, displayName: 'Brisco Hale' }],
      },
    });
    expect(await variantsOf(ARDEN)).toMatchObject([{ text: 'the lighthouse', isAmbiguous: true }]);
  });

  it('[CL-IHM-18] refuses a save sent with a stale version, with the player as he now stands, and one for a player gone', async () => {
    await follow(ARDEN, 'Arden Moss', { rowVersion: 3 });
    await giveVariants(ARDEN, ['Ardy']);

    const stale = await update(ARDEN, change({ displayName: 'Arden Vale', birthday: MID_MARCH }));
    const gone = await update(NOBODY, change());
    const malformed = await update('not-a-player', change());

    expect(stale).toMatchObject({
      ok: false,
      error: {
        kind: 'changed_elsewhere',
        current: {
          id: ARDEN,
          displayName: 'Arden Moss',
          birthday: null,
          rowVersion: 3,
          variants: [{ kind: 'spelling', text: 'Ardy', isAmbiguous: false }],
        },
      },
    });
    expect([gone, malformed]).toStrictEqual([
      { ok: false, error: { kind: 'no_longer_exists' } },
      { ok: false, error: { kind: 'no_longer_exists' } },
    ]);
    expect(await birthdayRow(ARDEN)).toMatchObject({ birthdayMonth: null, rowVersion: 3 });
    expect(await journal()).toStrictEqual([]);
  });

  it('[JOU-13] [CL-JOU-03] leaves the team to enterTeamChange, which the edit action calls after it in the same transaction', async () => {
    const [harbor, summit] = await db
      .insert(teams)
      .values([
        { abbreviation: 'HBG', name: 'Harbor Gulls' },
        { abbreviation: 'SMT', name: 'Summit Owls' },
      ])
      .returning({ id: teams.id });
    await follow(ARDEN, 'Arden Vale', { currentTeamId: harbor?.id ?? null });

    const outcome = await db.transaction(async (tx) => {
      const saved = await updateIdentity(tx, ARDEN, change({ displayName: 'Arden Vale-Moss' }));
      const afterSave = await get(tx, ARDEN);
      const entered = await enterTeamChange(tx, ARDEN, summit?.id ?? null);
      return { saved: saved.ok, teamAfterSave: afterSave?.currentTeamId, entered };
    });

    expectTypeOf<keyof IdentityChange>().toEqualTypeOf<
      'displayName' | 'variants' | 'birthday' | 'expectedVersion'
    >();
    expect(outcome).toStrictEqual({
      saved: true,
      teamAfterSave: harbor?.id,
      entered: { ok: true, value: undefined },
    });
    expect(
      await db.select({ origin: playerTeamChanges.origin }).from(playerTeamChanges),
    ).toStrictEqual([{ origin: 'entered' }]);
  });

  it('[JOU-11] [CL-DSN-21] enters the day and month of birth, origin owner, and journals it without the value', async () => {
    await follow(ARDEN, 'Arden Vale');

    const saved = await update(ARDEN, change({ birthday: MID_MARCH }));

    expect(saved).toStrictEqual({
      ok: true,
      value: { birthdayChanged: true, addedVariants: [], sharedVariants: [] },
    });
    expect(await birthdayRow(ARDEN)).toStrictEqual({ ...OWNER_MID_MARCH, rowVersion: 2 });
    expect(await journal()).toStrictEqual([entry('player_birthday_entered')]);
  });

  it('[JOU-11] [CL-JOU-16] corrects a birthday the source gave, which becomes the owner’s, and journals the change without the value', async () => {
    await follow(ARDEN, 'Arden Vale', SOURCE_MID_MARCH);

    const saved = await update(ARDEN, change({ birthday: LATE_MARCH }));

    expect(saved).toMatchObject({ ok: true, value: { birthdayChanged: true } });
    expect(await birthdayRow(ARDEN)).toStrictEqual({
      birthdayMonth: 3,
      birthdayDay: 28,
      birthdayOrigin: 'owner',
      rowVersion: 2,
    });
    expect(await journal()).toStrictEqual([entry('player_birthday_changed')]);
  });

  it('[JOU-11] [CL-JOU-16] removes the birthday, its origin with it, and journals the removal', async () => {
    await follow(ARDEN, 'Arden Vale', OWNER_MID_MARCH);

    const saved = await update(ARDEN, change({ birthday: null }));

    expect(saved).toMatchObject({ ok: true, value: { birthdayChanged: true } });
    expect(await birthdayRow(ARDEN)).toStrictEqual({
      birthdayMonth: null,
      birthdayDay: null,
      birthdayOrigin: null,
      rowVersion: 2,
    });
    expect(await journal()).toStrictEqual([entry('player_birthday_removed')]);
  });

  it('[JOU-11] reports no birthday change and journals none when the same day and month is saved, its origin kept', async () => {
    await follow(ARDEN, 'Arden Vale', SOURCE_MID_MARCH);

    const saved = await update(ARDEN, change({ birthday: { month: 3, day: 14 } }));

    expect(saved).toStrictEqual({
      ok: true,
      value: { birthdayChanged: false, addedVariants: [], sharedVariants: [] },
    });
    expect(await birthdayRow(ARDEN)).toStrictEqual({ ...SOURCE_MID_MARCH, rowVersion: 2 });
    expect(await journal()).toStrictEqual([]);
  });

  it('[JOU-11] [CL-JOU-17] accepts the last day of every month, 29 February included, and refuses the day after it', async () => {
    const longest = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    await follow(ARDEN, 'Arden Vale');
    const accepted: boolean[] = [];
    const refused: unknown[] = [];
    for (const [index, day] of longest.entries()) {
      const month = index + 1;
      const expectedVersion = FIRST_VERSION + index;
      const saved = await update(ARDEN, change({ birthday: { month, day }, expectedVersion }));
      accepted.push(saved.ok);
      const nextDay = { month, day: day + 1 };
      refused.push(await update(ARDEN, change({ birthday: nextDay, expectedVersion })));
    }

    expect(accepted).toStrictEqual(longest.map(() => true));
    expect(refused).toStrictEqual(longest.map(() => IMPOSSIBLE));
    expect(await birthdayRow(ARDEN)).toMatchObject({ birthdayMonth: 12, birthdayDay: 31 });
  });

  it('[JOU-11] refuses a month that does not exist, a day 0 and a part that is not a whole number', async () => {
    await follow(ARDEN, 'Arden Vale');
    const impossible = [
      { month: 0, day: 1 },
      { month: 13, day: 1 },
      { month: 1.5, day: 1 },
      { month: 1, day: 0 },
      { month: 1, day: 1.5 },
    ];

    const refused = [];
    for (const birthday of impossible) {
      refused.push(await update(ARDEN, change({ birthday })));
    }

    expect(refused).toStrictEqual(impossible.map(() => IMPOSSIBLE));
    expect(await update(ARDEN, change({ birthday: LEAP_DAY }))).toMatchObject({ ok: true });
    expect(await birthdayRow(ARDEN)).toMatchObject({ birthdayMonth: 2, birthdayDay: 29 });
  });

  it('[JOU-11] [CL-DSN-21] has no year anywhere: not in the input, not in a column, not stored when one is passed', async () => {
    await follow(ARDEN, 'Arden Vale');

    // @ts-expect-error A birthday takes no year (JOU-11): the type refuses one written out.
    const withYear: Birthday = { month: 3, day: 14, year: 1998 };
    await update(ARDEN, change({ birthday: withYear }));

    expectTypeOf<keyof Birthday>().toEqualTypeOf<'month' | 'day'>();
    const columns = Object.values(getTableColumns(followedPlayers)).map((column) => column.name);
    expect(columns.filter((name) => /birth|year/u.test(name))).toStrictEqual([
      'birthday_month',
      'birthday_day',
      'birthday_origin',
    ]);
    expect(JSON.stringify(await db.select().from(followedPlayers))).not.toContain('1998');
    expect(JSON.stringify(await journal())).not.toMatch(/14|1998/u);
  });

  describe('the birthday the stats source gives', () => {
    it('[JOU-11] [CL-JOU-16] fills an empty birthday, origin stats_source, and journals it without the value', async () => {
      await follow(ARDEN, 'Arden Vale');

      expect(await fromSource(ARDEN, MID_MARCH)).toStrictEqual({
        ok: true,
        value: { changed: true },
      });
      expect(await birthdayRow(ARDEN)).toStrictEqual({ ...SOURCE_MID_MARCH, rowVersion: 2 });
      expect(await journal()).toStrictEqual([entry('birthday_from_source')]);
    });

    it('[CL-JOU-16] never overwrites a birthday already filled, whatever its origin', async () => {
      await follow(ARDEN, 'Arden Vale', SOURCE_MID_MARCH);
      await follow(BRISCO, 'Brisco Hale', OWNER_MID_MARCH);

      const outcomes = [await fromSource(ARDEN, LATE_MARCH), await fromSource(BRISCO, LATE_MARCH)];

      expect(outcomes).toStrictEqual([
        { ok: true, value: { changed: false } },
        { ok: true, value: { changed: false } },
      ]);
      expect(await birthdayRow(ARDEN)).toStrictEqual({ ...SOURCE_MID_MARCH, rowVersion: 1 });
      expect(await birthdayRow(BRISCO)).toStrictEqual({ ...OWNER_MID_MARCH, rowVersion: 1 });
      expect(await journal()).toStrictEqual([]);
    });

    it('[CL-JOU-11] with replaceSourceGiven, replaces a birthday the source gave and never one the owner entered', async () => {
      await follow(ARDEN, 'Arden Vale', SOURCE_MID_MARCH);
      await follow(BRISCO, 'Brisco Hale', OWNER_MID_MARCH);
      const replacing = { ...LEAP_DAY, replaceSourceGiven: true };

      const outcomes = [
        await fromSource(ARDEN, replacing),
        await fromSource(BRISCO, replacing),
        await fromSource(ARDEN, replacing),
      ];

      expect(outcomes.map((outcome) => outcome.ok && outcome.value.changed)).toStrictEqual([
        true,
        false,
        false,
      ]);
      expect(await birthdayRow(ARDEN)).toStrictEqual({
        birthdayMonth: 2,
        birthdayDay: 29,
        birthdayOrigin: 'stats_source',
        rowVersion: 2,
      });
      expect(await birthdayRow(BRISCO)).toStrictEqual({ ...OWNER_MID_MARCH, rowVersion: 1 });
      expect(await journal()).toStrictEqual([entry('birthday_from_source')]);
    });

    it('[JOU-11] refuses an impossible day and an unknown player', async () => {
      await follow(ARDEN, 'Arden Vale');

      const outcomes = [
        await fromSource(ARDEN, { month: 2, day: 30 }),
        await fromSource(NOBODY, MID_MARCH),
      ];

      expect(outcomes).toStrictEqual([
        { ok: false, error: 'impossible_birthday' },
        { ok: false, error: 'player_not_found' },
      ]);
      expect(await birthdayRow(ARDEN)).toMatchObject({ birthdayMonth: null, rowVersion: 1 });
    });
  });
});
