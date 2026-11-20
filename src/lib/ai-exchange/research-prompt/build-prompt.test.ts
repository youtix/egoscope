import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import goldenPrompt from '@data/fixtures/ai-exchange/research-prompt/prompt.json';
import goldenRequest from '@data/fixtures/ai-exchange/research-prompt/request.json';

import { buildPrompt } from './build-prompt';

import type {
  PromptPeriod,
  PromptRequestedType,
  PromptTypeSheet,
  ResearchPromptInput,
} from './build-prompt';

const DAY_MS = 86_400_000;

// The golden request: Player A, invented, whose first NBA game is known, with four
// research types and the English starter sheets of glossary section 5.1, given out of
// alphabetical order, the media storm with its coverage threshold. prompt.json is the
// template of glossary section 6.3 filled in by hand for it.
const REQUEST: ResearchPromptInput = goldenRequest;
const EXPECTED = goldenPrompt.prompt.join('\n');

/** The prompt that `input` builds, or the kind of its refusal. */
function built(input: ResearchPromptInput): string {
  const result = buildPrompt(input);
  return result.ok ? result.prompt : `refused: ${result.error.kind}`;
}

/** The lines of `prompt` from `heading` to the next numbered heading. */
function section(prompt: string, heading: string): readonly string[] {
  const lines = prompt.split('\n');
  const start = lines.indexOf(heading);
  const next = lines.findIndex((line, index) => index > start && /^\d\. [A-Z]/u.test(line));
  return lines.slice(start, next === -1 ? lines.length : next);
}

/** The first line of `prompt` that starts with `start`. */
function lineOf(prompt: string, start: string): string {
  return prompt.split('\n').find((line) => line.startsWith(start)) ?? '';
}

const types = (prompt: string): readonly string[] => section(prompt, '3. EVENT TYPES TO RESEARCH');

// The golden prompt and two of its sections, built anew by each test that reads them,
// so that a builder that throws fails that test.
const golden = (): string => built(REQUEST);
const answerFormat = (): readonly string[] => section(golden(), '4. ANSWER FORMAT');
const checks = (): readonly string[] => section(golden(), '6. BEFORE ANSWERING, CHECK');

/** Rule `number` of point 2 of the golden prompt. */
function rule(number: string): string {
  const rules = section(golden(), '2. MANDATORY RULES');
  return rules.find((line) => line.startsWith(`${number} `)) ?? '';
}

/** The identifiers of the type blocks of `prompt`, in their order. */
const blockIds = (prompt: string): readonly string[] =>
  prompt.split('\n').flatMap((line) => /^Type "(?<id>[^"]*)": /u.exec(line)?.groups?.['id'] ?? []);

/** What `{{TYPE_LIST}}` reads in the answer structure of `prompt`. */
function typeListOf(prompt: string): unknown {
  const prefix = '  "covered_types": ';
  return JSON.parse(lineOf(prompt, prefix).slice(prefix.length, -1));
}

/** The answer structure of section 4 of the golden prompt, as JSON reads it. */
function answerStructure(): unknown {
  const lines = answerFormat();
  return JSON.parse(lines.slice(lines.indexOf('{'), lines.indexOf('}') + 1).join('\n'));
}

/** The keys of a JSON value at every depth, as glossary section 6.1 writes them. */
function keysOf(value: unknown, path = ''): readonly string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown) => keysOf(item, `${path}[]`));
  }
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  return Object.entries(value).flatMap(([key, item]: [string, unknown]) => {
    const keyPath = path === '' ? key : `${path}.${key}`;
    return [keyPath, ...keysOf(item, keyPath)];
  });
}

const byCodeUnits = (left: string, right: string): number => (left < right ? -1 : 1);

/** The identifiers of `requested`, in the order of their code units. */
const idsOf = (requested: readonly PromptRequestedType[]): readonly string[] =>
  requested.map((type) => type.sheet.id).toSorted(byCodeUnits);

/** The calendar-derived types that `input` requests. */
const calendarDerivedOf = (input: ResearchPromptInput): readonly PromptRequestedType[] =>
  input.requestedTypes.filter((type) => type.sheet.isCalendarDerived);

// A short sheet of a research type, for the tests of one element.
const SHEET: PromptTypeSheet = {
  id: 'public-humiliation',
  name: 'Public humiliation',
  definition: 'a public remark that belittles the followed player by name.',
  inclusionCriteria: 'the remark targets the player by name.',
  exclusionCriteria: 'criticism of a specific play.',
  datingRule: 'the first dated article that reports the remark.',
  knownInAdvance: false,
  isCalendarDerived: false,
  coverageThreshold: null,
  genericExample: 'the coach of team X says that player A is overrated.',
};
const CAREER: PromptPeriod = { startOn: '2019-10-23', endOn: '2026-11-11' };

/** The golden request reduced to the one type `SHEET` changed by `change`, over `period`. */
function requestFor(change: Partial<PromptTypeSheet>, period = CAREER): ResearchPromptInput {
  return { ...REQUEST, requestedTypes: [{ sheet: { ...SHEET, ...change }, period }] };
}

/** The type block that `SHEET` changed by `change` gives, line by line. */
const blockFor = (change: Partial<PromptTypeSheet>): readonly string[] =>
  types(built(requestFor(change))).slice(1);

/** The dating-rule line that `SHEET` changed by `change` gives. */
const datingRuleFor = (change: Partial<PromptTypeSheet>): string =>
  lineOf(built(requestFor(change)), 'Dating rule: ');

// A type that the calendar derives, which no backtest researches (ADR 0015).
const calendarType = (id: string): PromptRequestedType => ({
  sheet: { ...SHEET, id, isCalendarDerived: true },
  period: CAREER,
});

// Requests of any content: one-line texts without the {{ that opens a placeholder,
// days from 1990-01-01 to 2030-12-31, one to five types with distinct identifiers.
const anyText = fc.string({ maxLength: 40 }).filter((text) => !text.includes('{{'));
const anyElement = fc.option(anyText, { nil: null });
const anyDay = fc
  .integer({ min: 7305, max: 22_279 })
  .map((day) => new Date(day * DAY_MS).toISOString().slice(0, 10));
const anyPeriod = fc.record({ startOn: fc.option(anyDay, { nil: null }), endOn: anyDay });
const anyThreshold = fc.record({
  outlets: fc.integer({ min: 2, max: 10 }),
  days: fc.integer({ min: 1, max: 7 }),
});
const anyRequestedType = (calendarMark: fc.Arbitrary<boolean>): fc.Arbitrary<PromptRequestedType> =>
  fc.record({
    sheet: fc.record({
      id: fc.stringMatching(/^[a-z0-9]{1,8}(?:-[a-z0-9]{1,8}){0,2}$/u),
      name: anyText,
      definition: anyElement,
      inclusionCriteria: anyElement,
      exclusionCriteria: anyElement,
      datingRule: anyElement,
      knownInAdvance: fc.boolean(),
      isCalendarDerived: calendarMark,
      coverageThreshold: fc.option(anyThreshold, { nil: null }),
      genericExample: anyElement,
    }),
    period: anyPeriod,
  });
const anyRequest = (calendarMark: fc.Arbitrary<boolean>): fc.Arbitrary<ResearchPromptInput> =>
  fc.record({
    reference: anyText,
    today: anyDay,
    player: fc.record({
      id: fc.uuid(),
      displayName: anyText,
      firstNbaGameOn: fc.option(anyDay, { nil: null }),
    }),
    overallPeriod: anyPeriod,
    requestedTypes: fc.uniqueArray(anyRequestedType(calendarMark), {
      minLength: 1,
      maxLength: 5,
      selector: (type) => type.sheet.id,
    }),
    maxTextLength: fc.nat(),
    maxSources: fc.nat(),
  });
const anyResearchRequest = anyRequest(fc.constant(false));
const anyRequestWithCalendarTypes = anyRequest(fc.boolean()).filter(
  (input) => calendarDerivedOf(input).length > 0,
);

describe('buildPrompt', () => {
  it('[BKT-21] [BKT-22] [CA-BKT-12] [CL-BKT-02] fills the English template of glossary section 6.3 for a request', () => {
    expect(buildPrompt(REQUEST)).toStrictEqual({ ok: true, prompt: EXPECTED });
  });

  describe('[BKT-21] [CA-BKT-12] the demands of the reference text, each in its place', () => {
    it('[H-01] asks for every event, those followed by a bad game included (rule 2.1)', () => {
      expect(rule('2.1')).toBe(
        '2.1 Exhaustiveness. Report every event that meets the criteria of a type, whether the player then played well, played badly or did not play. Never leave out an event because of the game that followed, and do not limit yourself to striking stories: a sorted history would distort the study.',
      );
      expect(checks()).toContain('- that you left out no event because of the game that followed.');
    });

    it('[D-27] forbids game statistics and scores (rules 2.2 and 2.7)', () => {
      expect(rule('2.2')).toBe(
        '2.2 No statistics. Do not look for, use or cite game statistics or scores. They will be fetched elsewhere, and knowing them could steer your sorting.',
      );
      expect(rule('2.7')).toMatch(/ No statistics, no score\.$/u);
      expect(checks()).toContain(
        '- that no field contains a statistic, a score or an intimate detail;',
      );
    });

    it('[D-10] asks for public, dated press with one source before the next game (rule 2.3)', () => {
      expect(rule('2.3')).toBe(
        '2.3 Sources. Only public, dated press articles: sports press, general press, news archives, in every useful language, English in particular. No social networks, forums, collaborative encyclopedias, or videos without an article. Each event you keep must have at least one source published before the first NBA game the player played after the event: keep the oldest sources possible. Give the exact address of the article, never that of a home page or a search page. For each source, give its publication date, with the time and the UTC offset when the article shows them.',
      );
    });

    it('[BKT-27] [H-BKT-11] asks to invent nothing and to set aside what could not be verified (rule 2.4)', () => {
      expect(rule('2.4')).toBe(
        '2.4 Nothing invented. Never invent a fact, a date, an address, a title or an outlet, and cite only articles whose existence you have checked. A fact you cannot support this way, or whose sources all postdate the game that followed, goes in "unverified_leads", never in "events". What remains doubtful about a kept event goes in its "unverified_note" field. The seasons, types or sources you could not explore properly go in "limitations". A shorter but true list is better than a list completed with guesses.',
      );
    });

    it('dates each fact when it became public by its type dating rule, with no birthday example (rule 2.5)', () => {
      expect(rule('2.5')).toBe(
        '2.5 Public date. It is the moment the fact became public, according to the dating rule of the type (point 3): usually the date of the first source that reports it; for a fact known in advance, the day it happens. Add the time and the UTC offset when a source gives them.',
      );
      expect(golden()).not.toMatch(/birthday/iu);
    });

    it('gives the definitions of SEN-13 and SEN-14 for a return from injury and high stakes (rule 2.7)', () => {
      expect(rule('2.7')).toBe(
        '2.7 Context. For the first NBA game the player played after the event, say whether he was returning from injury, that is whether the press presents this game as his return, or as one of his first games, after an absence due to an injury, without ever specifying the injury; and whether the game stakes were high, that is whether the outcome of this game directly decided a qualification, an elimination, a title or a final ranking. Answer "unknown" when you cannot establish it, or when this game has not been played yet. No statistics, no score.',
      );
    });

    it('[H-BKT-07] defines the three levels of research confidence (rule 2.8)', () => {
      expect(rule('2.8')).toBe(
        '2.8 Confidence. "high": at least two sources from different outlets, an established public date, the criteria of the type clearly met. "medium": a single source, or a slight doubt about the date or a criterion. "low": a fact established by a source, but its type or its public date uncertain.',
      );
    });

    it('[H-BKT-06] makes one fact one event, under the one type that fits it best (rule 2.9)', () => {
      expect(rule('2.9')).toBe(
        '2.9 One fact, one event. A fact reported by several articles is one event, with at most 3 sources, oldest first. A fact that seems to belong to two types goes under the one type whose sheet fits it best.',
      );
    });

    it('[H-BKT-12] never shortens the list, and stops at the end of a complete season (rule 2.11)', () => {
      expect(rule('2.11')).toBe(
        '2.11 Length. Never shorten the list: no ellipsis, no "etc.", no summary. If everything does not fit in one answer, process the period in chronological order, stop at the end of a complete season and give in "covered_period" the end date actually covered: the rest will be requested separately.',
      );
    });

    it('gives each type its dating rule, in its own block (point 3)', () => {
      expect(types(golden()).filter((line) => line.startsWith('Dating rule: '))).toStrictEqual([
        'Dating rule: the moment the coverage threshold is reached, that is the publication of the article that crosses it; one triggering fact gives only one event. Coverage threshold: 3 distinct outlets within 2 days.',
        'Dating rule: the moment the remark or act becomes public (live broadcast, publication), established by the first dated article that reports it.',
        'Dating rule: if the incident happened during a game, it is public from that moment, and the measured game is the next game; otherwise the date is that of the first dated article that reports it.',
        'Dating rule: the first publication that presents the record as within reach in the next game.',
      ]);
    });
  });

  describe('[BKT-21] [CA-BKT-12] [DSN-24] the wording rules of rule 2.6, each on its own', () => {
    it('[DSN-19] [DSN-23] asks for one factual, neutral sentence in English, within the maximum length', () => {
      expect(rule('2.6')).toContain(
        '2.6 Discretion. Describe each event in one factual, neutral sentence, in English, of at most 200 characters: who, designated by role, did what to the player, and what kind of outlet reported it.',
      );
      expect(lineOf(golden(), '      "description": ')).toBe(
        '      "description": "one factual sentence in English",',
      );
    });

    it('[DSN-22] forbids value judgments, interpretations of feelings and forecasts', () => {
      expect(rule('2.6')).toContain(
        "No value judgment, no interpretation of the player's feelings, no forecast.",
      );
    });

    it('[DSN-17] [CA-DSN-06] designates every person other than the player by role, never by name', () => {
      expect(rule('2.6')).toContain(
        'Designate every person other than the player by role (an opponent, a teammate, a coach, an executive, a spectator, a loved one), never by name.',
      );
      expect(checks()).toContain(
        '- that no person other than the player is named and that no description, detail, unverified note, lead or limitation contains quotation marks;',
      );
    });

    it('[DSN-12] [CA-DSN-04] says of a bereavement only that a loved one died', () => {
      expect(rule('2.6')).toContain(
        'for a bereavement, say only that a loved one died, with no name, family relationship, cause, circumstances or funeral;',
      );
    });

    it('[DSN-13] [CA-DSN-05] copies no racist term and names neither the origin, skin color, nationality nor religion of the player', () => {
      expect(rule('2.6')).toContain(
        "for racist remarks, neither the terms used nor the player's origin, skin color, nationality or religion;",
      );
      expect(rule('2.6')).toContain(
        'Summarize what was said: no quotation between quotation marks, no insult copied.',
      );
    });

    it('[DSN-16] says of a legal matter only that the player is publicly implicated', () => {
      expect(rule('2.6')).toContain(
        'for a legal matter, say only that the player is publicly implicated, without the alleged facts or the other parties.',
      );
    });

    it('[CL-BKT-14] applies the same rules to details, unverified notes, leads and limitations', () => {
      expect(rule('2.6')).toMatch(
        /These rules also apply to the "detail" and "unverified_note" fields, the leads and the limitations; article titles, however, are copied as published\.$/u,
      );
    });
  });

  describe('[BKT-11] [BKT-29] the header and the periods', () => {
    it('heads the prompt with the reference, today, the player, his identifier and his first NBA game', () => {
      expect(golden().split('\n').slice(2, 5)).toStrictEqual([
        'Request reference: REQ-2026-0007',
        "Today's date: 2026-11-11",
        'Player: Player A (ID 8b2e4f6a-1c3d-4a5b-9e7f-0a1b2c3d4e5f), first NBA game on 2019-10-23',
      ]);
    });

    it('says the first NBA game is to be established while its date is unknown, the periods starting from it', () => {
      const unknownStart = { startOn: null, endOn: '2026-11-11' };
      const prompt = built({
        ...requestFor({}, unknownStart),
        player: { ...REQUEST.player, firstNbaGameOn: null },
        overallPeriod: unknownStart,
      });

      expect(lineOf(prompt, 'Player: ')).toBe(
        'Player: Player A (ID 8b2e4f6a-1c3d-4a5b-9e7f-0a1b2c3d4e5f), first NBA game date to be established',
      );
      expect(lineOf(prompt, 'Draw up ')).toContain(
        'that became public from his first NBA game to 2026-11-11 inclusive, for each of the types',
      );
      expect(lineOf(prompt, 'Period to cover: ')).toBe(
        'Period to cover: from his first NBA game to 2026-11-11 inclusive',
      );
    });

    it('writes the period of each type in its block, and the overall period in the mission', () => {
      const prompt = built({
        ...REQUEST,
        overallPeriod: { startOn: '2021-07-01', endOn: '2026-11-11' },
        requestedTypes: [
          { sheet: SHEET, period: { startOn: '2022-07-01', endOn: '2026-11-11' } },
          {
            sheet: { ...SHEET, id: 'media-storm' },
            period: { startOn: '2021-07-01', endOn: '2025-06-30' },
          },
        ],
      });

      expect(types(prompt).filter((line) => line.startsWith('Period to cover: '))).toStrictEqual([
        'Period to cover: from 2021-07-01 to 2025-06-30 inclusive',
        'Period to cover: from 2022-07-01 to 2026-11-11 inclusive',
      ]);
      expect(lineOf(prompt, 'Draw up ')).toContain(
        'that became public from 2021-07-01 to 2026-11-11 inclusive, for each of the types',
      );
    });

    it('[CL-BKT-02] writes every date as given, YYYY-MM-DD, and none in the display format', () => {
      const career = ['2019-10-23', '2026-11-11'];
      const blocks = [career, career, career, career].flat();

      expect(golden().match(/\b\d{4}-\d{2}-\d{2}\b/gu)).toStrictEqual([
        '2026-11-11',
        '2019-10-23',
        ...career,
        ...blocks,
      ]);
    });

    it('keeps out the facts before his first NBA game, about the whole team or of a type not requested (rule 2.10)', () => {
      expect(rule('2.10')).toBe(
        '2.10 Out of scope. Ignore the facts that became public outside the requested period, those that target the whole team rather than the player (unless the sheet of the type provides for it) and any type not defined in point 3.',
      );
      expect(lineOf(golden(), 'Draw up ')).toContain(
        'that became public from 2019-10-23 to 2026-11-11 inclusive',
      );
    });
  });

  describe('[BKT-26] [BKT-27] the answer format', () => {
    it('[BKT-21] [BKT-26] [CA-BKT-12] asks for the JSON object alone, with no fence or citation marker, else complete and in one piece at the end', () => {
      expect(answerFormat()[1]).toBe(
        'Your answer consists only of one valid JSON object: no text before or after it, no formatting tags, no footnote calls or citation markers. If your tool still adds a report, the complete JSON must appear in one piece at the very end. Expected structure, where each value describes what to put there:',
      );
      expect(checks()[1]).toBe('- that your answer contains only the JSON, complete and valid;');
    });

    it('[BKT-26] asks for straight quotation marks only', () => {
      expect(lineOf(golden(), 'Format rules: ')).toMatch(
        /; add no other field; use straight quotation marks only\.$/u,
      );
    });

    it('[BKT-26] [BKT-27] [CL-BKT-02] shows the English keys of format 1.0, with the request, the player and the types filled in', () => {
      expect(keysOf(answerStructure())).toStrictEqual([
        'format',
        'format_version',
        'request_reference',
        'player',
        'player.id',
        'player.name',
        'covered_types',
        'covered_period',
        'covered_period.start',
        'covered_period.end',
        'events',
        'events[].event_type',
        'events[].public_date',
        'events[].description',
        'events[].sources',
        'events[].sources[].url',
        'events[].sources[].outlet',
        'events[].sources[].title',
        'events[].sources[].publication_date',
        'events[].context',
        'events[].context.injury_return',
        'events[].context.game_stakes',
        'events[].context.detail',
        'events[].confidence',
        'events[].unverified_note',
        'unverified_leads',
        'unverified_leads[].event_type',
        'unverified_leads[].approximate_period',
        'unverified_leads[].description',
        'unverified_leads[].reason',
        'limitations',
      ]);
      expect(answerFormat().slice(3, 7)).toStrictEqual([
        '  "format": "egoscope-backtest",',
        '  "format_version": "1.0",',
        '  "request_reference": "REQ-2026-0007",',
        '  "player": { "id": "8b2e4f6a-1c3d-4a5b-9e7f-0a1b2c3d4e5f", "name": "Player A" },',
      ]);
    });

    it('[BKT-27] gives what cannot be supported its own channel, unverified_leads, and lets a reader check each source', () => {
      expect(rule('2.4')).toContain('goes in "unverified_leads", never in "events".');
      expect(section(golden(), '5. IF YOU FIND NOTHING')[1]).toBe(
        'If no fact meets the criteria, send back the same object with "events": []. It is a valid and useful answer: invent nothing to fill it.',
      );
      expect(rule('2.3')).toContain(
        'Give the exact address of the article, never that of a home page',
      );
      expect(rule('2.8')).toContain('"high": at least two sources from different outlets');
    });

    it('[BKT-19] [BKT-26] names no research tool: inside its sentences, it capitalizes only the app and the language', () => {
      const names = golden().match(/(?<=[a-z,] )[A-Z][A-Za-z]*[a-z][A-Za-z]*/gu) ?? [];

      expect([...new Set(names)].toSorted(byCodeUnits)).toStrictEqual(['Egoscope', 'English']);
      expect(golden()).toContain('If your tool still adds a report');
    });
  });

  describe('[BKT-22] the placeholders and the type blocks', () => {
    it('leaves no placeholder in the prompt of any request', () => {
      fc.assert(
        fc.property(anyResearchRequest, (input) => {
          const prompt = built(input);

          expect(prompt.startsWith('DEEP RESEARCH — EVENT HISTORY OF AN NBA PLAYER\n')).toBe(true);
          expect(prompt).not.toContain('{{');
        }),
      );
    });

    it('writes the blocks in the alphabetical order of the type identifiers, which the type list follows', () => {
      fc.assert(
        fc.property(anyResearchRequest, (input) => {
          const prompt = built(input);

          expect(blockIds(prompt)).toStrictEqual(idsOf(input.requestedTypes));
          expect(typeListOf(prompt)).toStrictEqual(idsOf(input.requestedTypes));
        }),
      );
    });

    it('writes the type list as the JSON list of glossary section 6.3', () => {
      expect(lineOf(golden(), '  "covered_types": ')).toBe(
        '  "covered_types": ["media-storm", "public-humiliation", "racist-abuse", "record-approach"],',
      );
    });

    it.each([
      ['Type "public-humiliation": not provided', { name: '' }],
      ['Definition: not provided', { definition: null }],
      ['Inclusion criteria: not provided', { inclusionCriteria: '' }],
      ['Exclusion criteria: not provided', { exclusionCriteria: ' \n\t ' }],
      ['Dating rule: not provided', { datingRule: null }],
      ['Example: not provided', { genericExample: ' '.repeat(3) }],
    ] satisfies [string, Partial<PromptTypeSheet>][])(
      'reads "%s" for an empty element of the sheet',
      (line, change) => {
        expect(blockFor(change)).toContain(line);
      },
    );

    it('[TAX-33] sends the whole sheet, each element trimmed, in the block of its type', () => {
      expect(blockFor({ definition: '\n  a public remark.  \t' })).toStrictEqual([
        'Type "public-humiliation": Public humiliation',
        'Period to cover: from 2019-10-23 to 2026-11-11 inclusive',
        'Definition: a public remark.',
        'Inclusion criteria: the remark targets the player by name.',
        'Exclusion criteria: criticism of a specific play.',
        'Dating rule: the first dated article that reports the remark.',
        'Example: the coach of team X says that player A is overrated.',
        '',
      ]);
    });

    it('fills the maximum text length and the maximum number of sources from the request', () => {
      const prompt = built({ ...REQUEST, maxTextLength: 160, maxSources: 5 });

      expect(lineOf(prompt, '2.6 ')).toContain('in English, of at most 160 characters:');
      expect(lineOf(prompt, '2.9 ')).toContain(
        'is one event, with at most 5 sources, oldest first.',
      );
    });
  });

  describe('[TAX-33] [CL-TAX-14] the dating rule of a sheet', () => {
    it('marks the dating rule of a type known in advance, which rule 2.5 reads', () => {
      expect(datingRuleFor({ knownInAdvance: true })).toBe(
        'Dating rule: known in advance: the first dated article that reports the remark.',
      );
    });

    it('ends the dating rule with the coverage-threshold sentence, after the mark of a type known in advance', () => {
      const threshold = { outlets: 4, days: 1 };

      expect(datingRuleFor({ knownInAdvance: true, coverageThreshold: threshold })).toBe(
        'Dating rule: known in advance: the first dated article that reports the remark. Coverage threshold: 4 distinct outlets within 1 day.',
      );
      expect(datingRuleFor({ coverageThreshold: { outlets: 10, days: 7 } })).toBe(
        'Dating rule: the first dated article that reports the remark. Coverage threshold: 10 distinct outlets within 7 days.',
      );
    });
  });

  describe('[CL-BKT-03] calendar-derived types', () => {
    it('refuses a calendar-derived type with a typed error, so that no block and no type list holds it', () => {
      const requestedTypes = [
        calendarType('former-team'),
        ...REQUEST.requestedTypes,
        calendarType('birthday'),
      ];

      expect(buildPrompt({ ...REQUEST, requestedTypes })).toStrictEqual({
        ok: false,
        error: { kind: 'calendar_derived_type', eventTypeIds: ['birthday', 'former-team'] },
      });
    });

    it('refuses any request that holds calendar-derived types, naming each in alphabetical order', () => {
      fc.assert(
        fc.property(anyRequestWithCalendarTypes, (input) => {
          const eventTypeIds = idsOf(calendarDerivedOf(input));

          expect(buildPrompt(input)).toStrictEqual({
            ok: false,
            error: { kind: 'calendar_derived_type', eventTypeIds },
          });
        }),
      );
    });
  });
});
