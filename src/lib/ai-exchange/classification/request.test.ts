import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import eventTypeSeed from '@data/seeds/event-types.json';

import { classificationInstructions } from './instructions';
import {
  buildClassificationRequest,
  classificationRequestText,
  estimateRequestTokens,
} from './request';

import type {
  ClassificationArticleInput,
  ClassificationEventInput,
  ClassificationEventReference,
  ClassificationListEntry,
  ClassificationPlayerInput,
  ClassificationRequestInput,
  ClassificationTypeSheet,
} from './request';

const HOUR = 3_600_000;
// The retained instant of the main article, 2026-11-24 19:30 UTC, 14:30 at its outlet.
const AT = Date.UTC(2026, 10, 24, 19, 30);
// Its grouping window of 72 hours starts at 2026-11-21 19:30 UTC.
const CUTOFF = AT - 72 * HOUR;

const STORM: ClassificationTypeSheet = {
  id: 'media-storm',
  name: 'Media storm',
  definition: 'A wave of critical coverage targets the player.',
  inclusionCriteria: 'Several outlets criticize him within days.',
  exclusionCriteria: 'A single critical article.',
  datingRule: 'The article that crosses the threshold.',
  knownInAdvance: false,
  isCalendarDerived: false,
  coverageThreshold: { outlets: 3, days: 2 },
  genericExample: 'Three outlets question player A.',
};
const HUMILIATION: ClassificationTypeSheet = {
  ...STORM,
  id: 'public-humiliation',
  name: 'Public humiliation',
  datingRule: 'The moment the remark becomes public.',
  knownInAdvance: true,
  coverageThreshold: null,
};
const BIRTHDAY_SHEET: ClassificationTypeSheet = {
  ...HUMILIATION,
  id: 'birthday',
  isCalendarDerived: true,
};

const entry = (id: string, name: string): ClassificationListEntry => ({
  id,
  name,
  definition: `The definition of ${name}.`,
});
const BENCHING = entry('17', 'Benching');
const TRADE = entry('trade-rumor', 'Trade rumor');
const BIRTHDAY = entry('birthday', 'Birthday game');
const FORMER_TEAM = entry('former-team', 'Game against a former team');

const instant = (
  at: number,
  offsetMinutes: number | null = null,
): ClassificationEventReference => ({
  kind: 'instant',
  at,
  offsetMinutes,
});
const day = (on: string): ClassificationEventReference => ({ kind: 'day', on });

/** An event of `origin`, not dismissed, its description naming its identifier. */
function event(
  id: string,
  origin: ClassificationEventInput['origin'],
  referenceDate: ClassificationEventReference,
): ClassificationEventInput {
  const detectedStatus = origin === 'detected' ? 'detected' : null;
  const description = `An opponent mocks player A in event ${id}.`;
  return {
    id,
    eventType: 'public-humiliation',
    origin,
    detectedStatus,
    referenceDate,
    description,
  };
}

/** A detected event that the owner dismissed. */
const dismissed = (id: string, referenceDate: ClassificationEventReference) => ({
  ...event(id, 'detected', referenceDate),
  detectedStatus: 'dismissed' as const,
});

// Invented players.
const ASHGROVE: ClassificationPlayerInput = {
  id: '3f1c9a2e-7b4d-4e8a-9c61-2d5f8e0b7a14',
  displayName: 'Corbin Ashgrove',
  variants: ['C. Ashgrove', 'Ash'],
  events: [
    event('60', 'detected', instant(AT + 48 * HOUR, 60)),
    event('7', 'historical', instant(Date.UTC(2026, 10, 20, 10), 60)),
    event('31', 'detected', instant(AT - 24 * HOUR)),
    event('55', 'calendar', day('2026-11-24')),
    event('40', 'historical', day('2026-11-22')),
    dismissed('12', instant(Date.UTC(2026, 5, 1, 12))),
  ],
};
const FENNIMORE: ClassificationPlayerInput = {
  id: '9b2d7e10-4c3a-4f51-8e6d-1a0c5b9f3e27',
  displayName: 'Lio Fennimore',
  variants: [],
  events: [],
};
const MAIN_ARTICLE: ClassificationArticleInput = {
  id: '1024',
  title: 'Coach questions Ashgrove',
  excerpt: 'The coach of team X doubted that Ashgrove can decide a game.',
  outletName: 'National Daily',
  retainedPublishedAt: AT,
  outletOffsetMinutes: -300,
  retainedPublishedAtPrecision: 'exact',
  players: [FENNIMORE, ASHGROVE],
};
const LATER_ARTICLE: ClassificationArticleInput = {
  id: '2048',
  title: 'Fennimore in a media storm',
  excerpt: null,
  outletName: 'Evening Courier',
  retainedPublishedAt: Date.UTC(2026, 10, 25, 8, 15),
  outletOffsetMinutes: null,
  retainedPublishedAtPrecision: 'approximate',
  players: [{ ...FENNIMORE, events: [event('88', 'detected', instant(AT - 12 * HOUR))] }],
};
const INPUT: ClassificationRequestInput = {
  validatedTypes: [STORM, BIRTHDAY_SHEET, HUMILIATION],
  doNotRepropose: [TRADE, BENCHING],
  calendarHandledTypes: [FORMER_TEAM, BIRTHDAY],
  articles: [LATER_ARTICLE, MAIN_ARTICLE],
  groupingWindowHours: 72,
};

/** The request text of `input`. */
const textOf = (input: ClassificationRequestInput): string =>
  classificationRequestText(buildClassificationRequest(input));

/** The request of the main article, changed by `article`, with one player who has `events`. */
function requestOf(
  events: readonly ClassificationEventInput[],
  article: Partial<ClassificationArticleInput> = {},
  groupingWindowHours = 72,
): ClassificationRequestInput {
  const articles = [{ ...MAIN_ARTICLE, players: [{ ...FENNIMORE, events }], ...article }];
  return { ...INPUT, articles, groupingWindowHours };
}

/** The identifiers of the events that the request sends with its one player. */
function sentEvents(
  events: readonly ClassificationEventInput[],
  article: Partial<ClassificationArticleInput> = {},
  groupingWindowHours = 72,
): readonly string[] {
  const request = buildClassificationRequest(requestOf(events, article, groupingWindowHours));
  return request.articles[0]?.players[0]?.events.map((sent) => sent.playerEventId) ?? [];
}

/** How the request writes the retained instant of an article at its outlet's offset. */
function publishedAt(retainedPublishedAt: number, outletOffsetMinutes: number | null): string {
  const input = requestOf([], { retainedPublishedAt, outletOffsetMinutes });
  return buildClassificationRequest(input).articles[0]?.publishedAt ?? '';
}

/** How the request writes the reference date of an event. */
function referenceDateOf(reference: ClassificationEventReference): string {
  const request = buildClassificationRequest(requestOf([event('5', 'detected', reference)]));
  return request.articles[0]?.players[0]?.events[0]?.referenceDate ?? '';
}

/** The JSON of an event that `event` built, as the request sends it. */
const sentEvent = (id: string, referenceDate: string): string =>
  `{"player_event_id":"${id}","event_type":"public-humiliation","reference_date":"${referenceDate}","description":"An opponent mocks player A in event ${id}."}`;

describe('buildClassificationRequest and classificationRequestText', () => {
  it('[DET-14] [DET-12] [CL-DET-06] [CL-DET-11] [CL-TAX-10] [CL-DET-22] send the sheets, the two lists and each article with its players, names and events, with the keys of detection.md section 5.1 and every list sorted by identifier', () => {
    const sheet =
      '"definition":"A wave of critical coverage targets the player.","inclusion_criteria":"Several outlets criticize him within days.","exclusion_criteria":"A single critical article."';
    const fennimore =
      '"player_id":"9b2d7e10-4c3a-4f51-8e6d-1a0c5b9f3e27","names":["Lio Fennimore"]';
    expect(textOf(INPUT)).toBe(
      [
        '{"instructions_version":"1.0","validated_types":[',
        `{"id":"media-storm","name":"Media storm",${sheet},`,
        '"dating_rule":"The article that crosses the threshold. Coverage threshold: 3 distinct outlets within 2 days.",',
        '"known_in_advance":false,"generic_example":"Three outlets question player A."},',
        `{"id":"public-humiliation","name":"Public humiliation",${sheet},`,
        '"dating_rule":"The moment the remark becomes public.",',
        '"known_in_advance":true,"generic_example":"Three outlets question player A."}],',
        '"do_not_repropose":[{"id":"17","name":"Benching","definition":"The definition of Benching."},',
        '{"id":"trade-rumor","name":"Trade rumor","definition":"The definition of Trade rumor."}],',
        '"calendar_types":[{"id":"birthday","name":"Birthday game","definition":"The definition of Birthday game."},',
        '{"id":"former-team","name":"Game against a former team","definition":"The definition of Game against a former team."}],',
        '"articles":[{"article_id":"1024","title":"Coach questions Ashgrove",',
        '"excerpt":"The coach of team X doubted that Ashgrove can decide a game.","outlet":"National Daily",',
        '"published_at":"2026-11-24T14:30:00-05:00","published_precision":"exact","players":[',
        '{"player_id":"3f1c9a2e-7b4d-4e8a-9c61-2d5f8e0b7a14","names":["Corbin Ashgrove","C. Ashgrove","Ash"],"events":[',
        `${sentEvent('12', '2026-06-01T12:00:00+00:00')},${sentEvent('31', '2026-11-23T19:30:00+00:00')},`,
        `${sentEvent('40', '2026-11-22')},${sentEvent('60', '2026-11-26T20:30:00+01:00')}]},`,
        `{${fennimore},"events":[]}]},`,
        '{"article_id":"2048","title":"Fennimore in a media storm","excerpt":null,"outlet":"Evening Courier",',
        '"published_at":"2026-11-25T08:15:00+00:00","published_precision":"approximate","players":[',
        `{${fennimore},"events":[${sentEvent('88', '2026-11-24T07:30:00+00:00')}]}]}]}`,
      ].join(''),
    );
  });

  it('[CL-DET-06] write the retained instant at the offset of its outlet, +00:00 when the zone is unknown', () => {
    expect(publishedAt(AT, null)).toBe('2026-11-24T19:30:00+00:00');
    expect(publishedAt(AT, 0)).toBe('2026-11-24T19:30:00+00:00');
    expect(publishedAt(AT, 60)).toBe('2026-11-24T20:30:00+01:00');
    expect(publishedAt(AT, 330)).toBe('2026-11-25T01:00:00+05:30');
    expect(publishedAt(AT + 999, -570)).toBe('2026-11-24T10:00:00-09:30');
  });

  it('[DET-14] write a reference date as its day, or as an instant at its offset', () => {
    expect(referenceDateOf(day('2026-11-23'))).toBe('2026-11-23');
    expect(referenceDateOf(instant(AT, 840))).toBe('2026-11-25T09:30:00+14:00');
  });

  it('[CL-DET-11] [DET-29] send a detected or historical event from the start of the grouping window on, with no upper bound', () => {
    const fromCutoff = [
      event('1', 'detected', instant(CUTOFF)),
      event('2', 'historical', instant(CUTOFF, -300)),
      event('3', 'detected', instant(AT + 240 * HOUR)),
      event('4', 'detected', instant(CUTOFF - 1)),
      event('5', 'historical', instant(CUTOFF - 1, 60)),
    ];
    expect(sentEvents(fromCutoff)).toStrictEqual(['1', '2', '3']);
  });

  it('[CL-DET-11] [DET-29] count the grouping window back from the article, in hours of the parameter', () => {
    const events = [event('1', 'detected', instant(AT - 48 * HOUR))];
    expect(sentEvents(events, {}, 72)).toStrictEqual(['1']);
    expect(sentEvents(events, {}, 24)).toStrictEqual([]);
    const later = { retainedPublishedAt: AT - 30 * HOUR };
    expect(sentEvents(events, later, 24)).toStrictEqual(['1']);
  });

  it('[CL-DET-11] send a historical event dated without a time while its day may still last, at −12:00, when the window starts', () => {
    const days = ['2026-11-20', '2026-11-21', '2026-11-22'].map((on, index) =>
      event(String(index), 'historical', day(on)),
    );
    // The window starts at 2026-11-21 19:30 UTC, 07:30 on 21 November at −12:00.
    expect(sentEvents(days)).toStrictEqual(['1', '2']);
    // It starts at 2026-11-22 00:00 UTC: 21 November lasts twelve more hours at −12:00.
    const midnight = { retainedPublishedAt: Date.UTC(2026, 10, 25) };
    expect(sentEvents(days, midnight)).toStrictEqual(['1', '2']);
    // It starts at 2026-11-22 12:00 UTC, when 21 November has ended everywhere.
    const noon = Date.UTC(2026, 10, 25, 12);
    expect(sentEvents(days, { retainedPublishedAt: noon })).toStrictEqual(['2']);
    expect(sentEvents(days, { retainedPublishedAt: noon - 1 })).toStrictEqual(['1', '2']);
  });

  it('[DET-44] [CL-DET-11] send a dismissed event whatever its age, and never a calendar-derived one', () => {
    const longAgo = AT - 400 * 24 * HOUR;
    const events = [
      dismissed('1', instant(longAgo)),
      event('2', 'detected', instant(longAgo)),
      event('3', 'calendar', instant(AT - HOUR)),
      event('4', 'calendar', day('2026-11-24')),
    ];
    expect(sentEvents(events)).toStrictEqual(['1']);
  });
});

// --- Properties of the request text ----------------------------------------------------

// The keys of the request text at each level, in their order (detection.md section 5.1).
const KEYS = {
  root: 'instructions_version validated_types do_not_repropose calendar_types articles'.split(' '),
  sheets:
    'id name definition inclusion_criteria exclusion_criteria dating_rule known_in_advance generic_example'.split(
      ' ',
    ),
  entries: ['id', 'name', 'definition'],
  articles: 'article_id title excerpt outlet published_at published_precision players'.split(' '),
  players: ['player_id', 'names', 'events'],
  events: ['player_event_id', 'event_type', 'reference_date', 'description'],
};

type Json = Readonly<Record<string, unknown>>;
type KeyLists = Readonly<Record<keyof typeof KEYS, readonly (readonly string[])[]>>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The objects of the list `key` of a JSON object. */
function listIn(value: Json, key: string): readonly Json[] {
  const member = value[key];
  return Array.isArray(member) ? member.filter(isObject) : [];
}

/** The keys of each of `objects`, in their order. */
const keysOf = (objects: readonly Json[]) => objects.map((object) => Object.keys(object));

/** The keys, in their order, of each object of a request text, level by level. */
function keysByLevel(text: string): KeyLists {
  const parsed: unknown = JSON.parse(text);
  const root = isObject(parsed) ? parsed : {};
  const articles = listIn(root, 'articles');
  const players = articles.flatMap((article) => listIn(article, 'players'));
  return {
    root: keysOf([root]),
    sheets: keysOf(listIn(root, 'validated_types')),
    entries: keysOf([...listIn(root, 'do_not_repropose'), ...listIn(root, 'calendar_types')]),
    articles: keysOf(articles),
    players: keysOf(players),
    events: keysOf(players.flatMap((player) => listIn(player, 'events'))),
  };
}

/** The request text before its articles: its static part. */
const staticPart = (text: string): string => text.slice(0, text.indexOf(',"articles":'));

// A value of the owner's data, which the callers' records may carry beside what the
// request reads.
const OWNER_DATA = 'owner-only-value';
const withOwnerData = <Value extends object>(value: Value) => ({
  ...value,
  ownerName: OWNER_DATA,
  ownerTimeZone: OWNER_DATA,
  team: OWNER_DATA,
});

/** The UTC day of an instant, `YYYY-MM-DD`. */
const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10);

// Arbitraries of the inputs, identifiers spelled as slugs, numbers and uuids are.
const idArbitrary = fc.stringMatching(/^[a-z0-9-]{1,12}$/u);
const wordsArbitrary = fc.string({ maxLength: 30 });
const instantArbitrary = fc.integer({ min: Date.UTC(2000, 0, 1), max: Date.UTC(2100, 0, 1) });
const offsetArbitrary = fc.option(fc.integer({ min: -720, max: 840 }), { nil: null });
const uniqueById = <Item extends Readonly<{ id: string }>>(
  item: fc.Arbitrary<Item>,
  [minLength, maxLength]: readonly [number, number],
) => fc.uniqueArray(item, { selector: (value) => value.id, minLength, maxLength });
const thresholdArbitrary = fc.record({
  outlets: fc.integer({ min: 2, max: 10 }),
  days: fc.integer({ min: 1, max: 7 }),
});
const sheetArbitrary = fc
  .record({
    id: idArbitrary,
    name: wordsArbitrary,
    definition: wordsArbitrary,
    inclusionCriteria: wordsArbitrary,
    exclusionCriteria: wordsArbitrary,
    datingRule: wordsArbitrary,
    knownInAdvance: fc.boolean(),
    isCalendarDerived: fc.boolean(),
    coverageThreshold: fc.option(thresholdArbitrary, { nil: null }),
    genericExample: wordsArbitrary,
  })
  .map(withOwnerData);
const entryArbitrary = fc
  .record({ id: idArbitrary, name: wordsArbitrary, definition: wordsArbitrary })
  .map(withOwnerData);
const referenceArbitrary = fc.oneof(
  fc.record({ kind: fc.constant('instant'), at: instantArbitrary, offsetMinutes: offsetArbitrary }),
  fc.record({
    kind: fc.constant('day'),
    on: instantArbitrary.map((at) => dayOf(at)),
  }),
);
const eventArbitrary = fc
  .record({
    id: idArbitrary,
    eventType: idArbitrary,
    origin: fc.constantFrom('detected', 'historical', 'calendar'),
    detectedStatus: fc.constantFrom('detected', 'dismissed', null),
    referenceDate: referenceArbitrary,
    description: wordsArbitrary,
  })
  .map(withOwnerData);
const playerArbitrary = fc
  .record({
    id: idArbitrary,
    displayName: wordsArbitrary,
    variants: fc.array(wordsArbitrary, { maxLength: 3 }),
    events: uniqueById(eventArbitrary, [0, 4]),
  })
  .map(withOwnerData);
const articleArbitrary = fc
  .record({
    id: idArbitrary,
    title: wordsArbitrary,
    excerpt: fc.option(wordsArbitrary, { nil: null }),
    outletName: wordsArbitrary,
    retainedPublishedAt: instantArbitrary,
    outletOffsetMinutes: offsetArbitrary,
    retainedPublishedAtPrecision: fc.constantFrom('exact', 'approximate', 'none'),
    players: uniqueById(playerArbitrary, [1, 3]),
  })
  .map(withOwnerData);
const articlesArbitrary = uniqueById(articleArbitrary, [1, 3]);
const listsArbitrary = fc.record({
  validatedTypes: uniqueById(sheetArbitrary, [2, 6]),
  doNotRepropose: uniqueById(entryArbitrary, [2, 6]),
  calendarHandledTypes: uniqueById(entryArbitrary, [2, 4]),
});
const windowArbitrary = fc.integer({ min: 1, max: 240 });

/** Every order of `items`. */
const anyOrder = <Item>(items: readonly Item[]) =>
  fc.shuffledSubarray([...items], { minLength: items.length, maxLength: items.length });

// The lists, the same lists in another order, and two sets of articles.
const twoRequestsArbitrary = listsArbitrary.chain((lists) =>
  fc.record({
    lists: fc.constant(lists),
    reordered: fc.record({
      validatedTypes: anyOrder(lists.validatedTypes),
      doNotRepropose: anyOrder(lists.doNotRepropose),
      calendarHandledTypes: anyOrder(lists.calendarHandledTypes),
    }),
    first: articlesArbitrary,
    second: articlesArbitrary,
  }),
);

describe('classificationRequestText', () => {
  it('[DET-14] keeps the static part first and byte for byte the same for two requests whose articles differ, whatever the order of the inputs', () => {
    fc.assert(
      fc.property(
        twoRequestsArbitrary,
        windowArbitrary,
        ({ lists, reordered, first, second }, groupingWindowHours) => {
          const one = textOf({ ...lists, articles: first, groupingWindowHours });
          const two = textOf({ ...reordered, articles: second, groupingWindowHours });
          expect(one.startsWith('{"instructions_version":"1.0","validated_types":[')).toBe(true);
          expect(staticPart(two)).toBe(staticPart(one));
        },
      ),
    );
  });

  it('[DSN-05] [DET-14] sends no key but those of detection.md section 5.1 and nothing about the owner, whatever else the inputs hold', () => {
    let eventsSent = 0;
    fc.assert(
      fc.property(listsArbitrary, articlesArbitrary, windowArbitrary, (lists, articles, hours) => {
        const text = textOf(withOwnerData({ ...lists, articles, groupingWindowHours: hours }));
        const levels = keysByLevel(text);
        eventsSent += levels.events.length;
        const expected = (level: keyof typeof KEYS) => levels[level].map(() => KEYS[level]);
        expect(levels).toStrictEqual({
          root: [KEYS.root],
          sheets: expected('sheets'),
          entries: expected('entries'),
          articles: expected('articles'),
          players: expected('players'),
          events: expected('events'),
        });
        expect(text).not.toContain(OWNER_DATA);
      }),
    );
    expect(eventsSent).toBeGreaterThan(0);
  });
});

// --- A realistic request ----------------------------------------------------------------

// The seeded sheets, the media storm with its draft coverage threshold (CL-TAX-14).
const SEED_SHEETS: readonly ClassificationTypeSheet[] = eventTypeSeed.map((type) => ({
  id: type.id,
  name: type.name,
  definition: type.definition,
  inclusionCriteria: type.inclusionCriteria,
  exclusionCriteria: type.exclusionCriteria,
  datingRule: type.datingRule,
  knownInAdvance: type.knownInAdvance,
  isCalendarDerived: type.calendarDerivation !== null,
  coverageThreshold: type.id === 'media-storm' ? { outlets: 3, days: 2 } : null,
  genericExample: type.genericExample,
}));

/** A type that the owner validated after an exploration, its sheet in the seed's style. */
const ownerSheet = (id: string, name: string, act: string): ClassificationTypeSheet => ({
  id,
  name,
  definition: `The followed player is the subject of ${act}, made public by an identifiable author.`,
  inclusionCriteria: `The press reports ${act} that names the player; its author is identifiable by role (coach, executive, teammate, outlet); at least one dated article reports it before his next game.`,
  exclusionCriteria: `A routine decision that the press presents as such; an anonymous message on a social network that no outlet reports; ${act} aimed at the whole team rather than at the player.`,
  datingRule:
    'The moment the fact becomes public, established by the first dated article that reports it.',
  knownInAdvance: false,
  isCalendarDerived: false,
  coverageThreshold: null,
  genericExample: `Two days before a game, a national outlet reports ${act} against player A; the measured game is the next one he plays.`,
});

// Three recent events of a player, with descriptions near the DSN-20 maximum.
const RECENT = [
  'At a press conference, an opposing coach questioned whether player A deserves his starting role; a national outlet reported it the evening before the game.',
  'A former teammate said on a podcast that player A no longer leads the locker room; a regional outlet reported it the next morning, two days before the game.',
  'An executive of his team publicly declined to commit to extending player A; several national outlets reported it on the same day, before his next game.',
];

/** A recognized player with three names and three recent events. */
const realisticPlayer = (player: ClassificationPlayerInput, variants: readonly string[]) => ({
  ...player,
  variants,
  events: RECENT.map((description, index) => ({
    ...event(`${player.id}-${String(index)}`, 'detected', instant(AT - (index + 1) * 20 * HOUR)),
    description,
  })),
});

const REALISTIC: ClassificationRequestInput = {
  validatedTypes: [
    ...SEED_SHEETS,
    ownerSheet('public-demotion', 'Public demotion', 'a demotion to the bench announced publicly'),
    ownerSheet('contract-snub', 'Contract snub', 'a refusal to extend his contract'),
    ownerSheet(
      'trade-talks-leak',
      'Leaked trade talks',
      'a leak that his team offered him in trades',
    ),
  ],
  doNotRepropose: [TRADE, BENCHING, entry('23', 'Award snub')],
  calendarHandledTypes: SEED_SHEETS.filter((sheet) => sheet.isCalendarDerived),
  articles: [
    {
      ...MAIN_ARTICLE,
      title: 'Coach of team X questions whether Corbin Ashgrove can lead his team',
      excerpt:
        'The coach of team X said on Monday that Corbin Ashgrove is not the leader his team needs, a remark that several outlets picked up within hours. Asked about it after practice, Ashgrove declined to answer and said he would let his game speak. The two teams meet on Wednesday night in a game that both need to keep their place in the standings. Lio Fennimore, his teammate, defended him in front of the press and said the locker room trusts its captain more than ever.',
      players: [
        realisticPlayer(ASHGROVE, ['C. Ashgrove', 'Ash']),
        realisticPlayer(FENNIMORE, ['L. Fennimore', 'Fenn']),
      ],
    },
  ],
  groupingWindowHours: 72,
};

// The free plan's minute limit leaves Groq about 7,000 tokens a request, the maximum
// output of 1,000 tokens included (detection-model service sheet, rule 5).
const GROQ_CEILING_TOKENS = 7000;
const MAX_OUTPUT_TOKENS = 1000;

describe('estimateRequestTokens', () => {
  it('counts three and a half characters a token over every text of the call, rounded up', () => {
    expect(estimateRequestTokens([])).toBe(0);
    expect(estimateRequestTokens(['abcdefg'])).toBe(2);
    expect(estimateRequestTokens(['abcdefgh'])).toBe(3);
    expect(estimateRequestTokens(['abc', 'defg'])).toBe(2);
  });

  it('estimates a realistic request at about 5,500 tokens, which Groq takes with the maximum output', () => {
    const parameters = { maxDescriptionLength: 200, groupingWindowHours: 72 };
    const texts = [classificationInstructions(parameters), textOf(REALISTIC)];
    const tokens = estimateRequestTokens(texts);
    expect(tokens).toBeGreaterThan(5000);
    expect(tokens).toBeLessThan(6000);
    expect(tokens + MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(GROQ_CEILING_TOKENS);
  });
});
