import fc from 'fast-check';
import { describe, expect, it, onTestFinished } from 'vitest';

import { createTestDatabase } from '@/lib/db';
import { DATABASE_TEST_TIMEOUT_MS, insertEventType, MEDIA_STORM } from '@/lib/testing';

import { duplicateCloseness, possibleDuplicates } from './duplicates';

// The words CL-TAX-05 drops before it compares.
const STOP_WORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'the',
  'of',
  'to',
  'in',
  'on',
  'at',
  'by',
  'for',
  'with',
  'from',
  'and',
  'or',
  'his',
  'her',
  'its',
  'their',
  'player',
  'players',
]);
const MEDIA_STORM_DEFINITION = 'Wide coverage of one player by the press in a short time.';

/** Words the comparison keeps, of two to six letters from `letters`, a pool apart from the others. */
const wordsFrom = (letters: string, minLength = 0, maxLength = 6) =>
  fc.uniqueArray(
    fc
      .stringMatching(new RegExp(`^[${letters}]{2,6}$`, 'u'))
      .filter((word) => !STOP_WORDS.has(word)),
    { minLength, maxLength },
  );
const text = (words: readonly string[]) => words.join(' ');
/** A name alone, its definition missing. */
const named = (words: readonly string[]) => ({ name: text(words), definition: null });
/** A word in capitals, with accents that the comparison removes. */
const accented = (word: string) => word.replaceAll('e', 'é').replaceAll('a', 'À').toUpperCase();
/** Texts of nothing but stop words, single characters and separators. */
const emptyWords = fc.array(fc.constantFrom(...STOP_WORDS, 'x', 'Q', '-', 'É'), { size: 'medium' });
// A small vocabulary, so that drawn texts often share words and often do not.
const vocabulary = fc
  .uniqueArray(fc.constantFrom('court', 'media', 'storm', 'trade', 'feud', 'coach'), {
    minLength: 1,
    maxLength: 4,
  })
  .map((words) => text(words));
const candidate = fc.record({ name: vocabulary, definition: vocabulary });
/** The creation instant of the `n`th type written. */
const dayOf = (n: number) => new Date(Date.UTC(2026, 10, 25 + n));

describe('duplicateCloseness', () => {
  it.each([
    ['Media storm', 'Storm in the media'],
    ["Player's birthday", 'Birthday of the player'],
    ['Public feud', 'Coach feud brawl'],
    ['Café crème', 'CAFE-CREME'],
    ['Wildﬁre rumor', 'wildfire rumor'],
  ])('[CL-TAX-05] finds the names %j and %j close', (left, right) => {
    expect(
      duplicateCloseness({ name: left, definition: null }, { name: right, definition: null }),
    ).toBe('names');
  });

  it('[CL-TAX-05] finds definitions close when they share half of the words of both, and a short one inside a long one not', () => {
    const long = { name: 'Alpha', definition: MEDIA_STORM_DEFINITION };

    expect(
      duplicateCloseness(long, {
        name: 'Omega',
        definition: 'Wide press coverage in a short time.',
      }),
    ).toBe('definitions');
    expect(duplicateCloseness(long, { name: 'Omega', definition: 'Wide coverage.' })).toBeNull();
    expect(
      duplicateCloseness(long, { name: 'Media storm', definition: MEDIA_STORM_DEFINITION }),
    ).toBe('definitions');
    expect(
      duplicateCloseness(
        { ...long, name: 'Media storm' },
        { name: 'Storm', definition: MEDIA_STORM_DEFINITION },
      ),
    ).toBe('both');
    expect(
      duplicateCloseness(
        { name: 'Trade request', definition: null },
        { name: 'Contract extension', definition: null },
      ),
    ).toBeNull();
  });

  it('[CL-TAX-05] finds a name or a definition of stop words and single letters close to none, itself included', () => {
    fc.assert(
      fc.property(emptyWords, (words) => {
        const empty = { name: text(words), definition: text(words) };

        expect(duplicateCloseness(empty, empty)).toBeNull();
      }),
    );
  });

  it('[CL-TAX-05] is symmetric, and finds a type close to itself on both texts', () => {
    fc.assert(
      fc.property(candidate, candidate, (one, another) => {
        expect(duplicateCloseness(one, another)).toBe(duplicateCloseness(another, one));
        expect(duplicateCloseness(one, one)).toBe('both');
      }),
    );
  });

  it('[CL-TAX-05] compares alike whatever the case, the accents, the separators, the stop words and the single letters', () => {
    fc.assert(
      fc.property(
        wordsFrom('a-f', 1),
        wordsFrom('a-f', 1),
        fc.constantFrom(' ', '-', ', ', '/', "'s "),
        (words, other, separator) => {
          const decorated = ['The', ...words.map((word) => accented(word)), 'x', 'of'].join(
            separator,
          );
          const compared = { name: text(other), definition: text(other) };

          expect(duplicateCloseness(compared, { name: decorated, definition: decorated })).toBe(
            duplicateCloseness(compared, { name: text(words), definition: text(words) }),
          );
        },
      ),
    );
  });

  it('[CL-TAX-05] finds names close exactly when they share at least half of the words of the smaller one, containment included', () => {
    const smallerAndLarger = wordsFrom('a-m', 1).chain((smaller) =>
      fc.tuple(
        fc.constant(smaller),
        fc.nat({ max: smaller.length }),
        wordsFrom('n-z', smaller.length, smaller.length + 4),
      ),
    );
    fc.assert(
      fc.property(smallerAndLarger, ([smaller, sharedCount, extra]) => {
        const larger = [...smaller.slice(0, sharedCount), ...extra];

        expect(duplicateCloseness(named(smaller), named(larger))).toBe(
          2 * sharedCount >= smaller.length ? 'names' : null,
        );
      }),
    );
  });

  it('[CL-TAX-05] finds definitions close exactly when their shared words are at least half of their union', () => {
    fc.assert(
      fc.property(
        wordsFrom('a-h'),
        wordsFrom('i-p'),
        wordsFrom('q-z'),
        (shared, leftOnly, rightOnly) => {
          const union = shared.length + leftOnly.length + rightOnly.length;
          const left = { name: 'Alpha', definition: text([...leftOnly, ...shared]) };
          const right = { name: 'Omega', definition: text([...shared, ...rightOnly]) };

          expect(duplicateCloseness(left, right)).toBe(
            union > 0 && 2 * shared.length >= union ? 'definitions' : null,
          );
        },
      ),
    );
  });
});

describe('possibleDuplicates', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  it('[CL-TAX-05] compares with every type whatever its state, saying whether the names, the definitions or both are close', async () => {
    const database = await createTestDatabase();
    onTestFinished(database.close);
    const { db } = database;
    await insertEventType(db, { createdAt: dayOf(0) });
    await insertEventType(db, {
      id: 'media-frenzy',
      name: 'Media frenzy',
      status: 'proposed',
      definition: 'Fans rush to the courtside.',
      createdAt: dayOf(1),
    });
    await insertEventType(db, {
      id: 'press-swarm',
      name: 'Press swarm',
      status: 'withdrawn',
      withdrawalReasonKind: 'entered',
      withdrawalReason: 'Doubled.',
      createdAt: dayOf(2),
    });
    await insertEventType(db, {
      id: 'tattoo-reveal',
      name: 'Tattoo reveal',
      status: 'rejected',
      rejectionReason: 'other',
      definition: 'A new tattoo.',
      createdAt: dayOf(3),
    });

    expect(
      await possibleDuplicates(db, 'Storm in the media', MEDIA_STORM_DEFINITION),
    ).toStrictEqual([
      {
        type: {
          id: MEDIA_STORM,
          name: 'Media storm',
          definition: MEDIA_STORM_DEFINITION,
          status: 'validated',
        },
        closeness: 'both',
      },
      {
        type: {
          id: 'media-frenzy',
          name: 'Media frenzy',
          definition: 'Fans rush to the courtside.',
          status: 'proposed',
        },
        closeness: 'names',
      },
      {
        type: {
          id: 'press-swarm',
          name: 'Press swarm',
          definition: MEDIA_STORM_DEFINITION,
          status: 'withdrawn',
        },
        closeness: 'definitions',
      },
    ]);
    expect(await possibleDuplicates(db, 'Tattoo', null)).toStrictEqual([
      {
        type: {
          id: 'tattoo-reveal',
          name: 'Tattoo reveal',
          definition: 'A new tattoo.',
          status: 'rejected',
        },
        closeness: 'names',
      },
    ]);
  });
});
