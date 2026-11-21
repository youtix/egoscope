import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import closedValuesSpelledOtherwise from '@data/fixtures/ai-exchange/exploration/closed-values-spelled-otherwise.json';
import codeFences from '@data/fixtures/ai-exchange/exploration/code-fences.json';
import comment from '@data/fixtures/ai-exchange/exploration/comment.json';
import completeResponse from '@data/fixtures/ai-exchange/exploration/complete-response.json';
import curlyQuotes from '@data/fixtures/ai-exchange/exploration/curly-quotes.json';
import cutAnswer from '@data/fixtures/ai-exchange/exploration/cut-answer.json';
import emptyName from '@data/fixtures/ai-exchange/exploration/empty-name.json';
import emptyOptionalElements from '@data/fixtures/ai-exchange/exploration/empty-optional-elements.json';
import formatAndVersionMissing from '@data/fixtures/ai-exchange/exploration/format-and-version-missing.json';
import invisibleCharacters from '@data/fixtures/ai-exchange/exploration/invisible-characters.json';
import markerBetweenTokens from '@data/fixtures/ai-exchange/exploration/marker-between-tokens.json';
import markerInsideText from '@data/fixtures/ai-exchange/exploration/marker-inside-text.json';
import proseAround from '@data/fixtures/ai-exchange/exploration/prose-around.json';
import renamedKeys from '@data/fixtures/ai-exchange/exploration/renamed-keys.json';
import researchResult from '@data/fixtures/ai-exchange/exploration/research-result.json';
import sameObjectTwice from '@data/fixtures/ai-exchange/exploration/same-object-twice.json';
import trailingComma from '@data/fixtures/ai-exchange/exploration/trailing-comma.json';
import twoResponses from '@data/fixtures/ai-exchange/exploration/two-responses.json';
import unicodeSpaces from '@data/fixtures/ai-exchange/exploration/unicode-spaces.json';
import versionWrittenOne from '@data/fixtures/ai-exchange/exploration/version-written-one.json';

import { parseExplorationResponse } from './response';

import type {
  ExplorationResponseError,
  ExplorationResponseResult,
  ExplorationWarning,
  ProposedIllustrationSource,
  ProposedType,
  ProposedTypeElement,
} from './response';

const parse = (text: string, maxPastedTextMegabytes = 2): ExplorationResponseResult =>
  parseExplorationResponse(text, { maxPastedTextMegabytes });

/** The answer that a fixture holds, line by line. */
const answer = (fixture: Readonly<{ pasted: readonly string[] }>): string =>
  fixture.pasted.join('\n');

// The format and its version, as the members of a response.
const HEADER = '"format": "egoscope-exploration", "format_version": "1.0"';

/** A response under this header with these proposed types, both written in JSON. */
const respond = (proposedTypes: string, header = HEADER): string =>
  `{${header}, "proposed_types": [${proposedTypes}]}`;

const read = (
  proposedTypes: readonly ProposedType[],
  warnings: readonly ExplorationWarning[] = [],
): ExplorationResponseResult => ({ ok: true, response: { proposedTypes, warnings } });

const refused = (
  kind: ExplorationResponseError['kind'],
  message: string,
): ExplorationResponseResult => ({ ok: false, error: { kind, message } });

const syntaxError = (place: string): ExplorationResponseResult =>
  refused(
    'syntax_error',
    `The JSON is not valid ${place}. Ask the AI to send the whole response again as strict JSON: straight quotation marks, no comment, no citation marker and no comma after the last item of a list.`,
  );

const MISSING: ExplorationWarning = {
  kind: 'format_or_version_missing',
  message: 'Format or version missing: version 1.0 assumed',
};
const NORMALIZED = { kind: 'version_normalized', message: 'Format version read as 1.0' } as const;
const UNKNOWN = { kind: 'unknown_fields', message: 'Unknown fields ignored' } as const;

const EVERY_ELEMENT: readonly ProposedTypeElement[] = [
  'name',
  'definition',
  'inclusion_criteria',
  'exclusion_criteria',
  'dating_rule',
  'known_in_advance',
  'generic_example',
  'documentation_difficulty',
  'possible_overlaps',
  'illustration_sources',
];
/** Every element but the name and these ones. */
const allBut = (...present: readonly ProposedTypeElement[]): readonly ProposedTypeElement[] =>
  EVERY_ELEMENT.filter((key) => key !== 'name' && !present.includes(key));

type Elements = Partial<
  Omit<Extract<ProposedType, { canBecomeProposal: true }>, 'canBecomeProposal' | 'name'>
>;

const NOTHING_READ = {
  definition: undefined,
  inclusionCriteria: undefined,
  exclusionCriteria: undefined,
  datingRule: undefined,
  knownInAdvance: undefined,
  genericExample: undefined,
  documentationDifficulty: undefined,
  possibleOverlaps: undefined,
  illustrationSources: undefined,
  missingElements: allBut(),
  citationMarkers: [],
};

/** A proposed type with this name, which can become a proposal, holding only `elements`. */
const named = (name: string, elements: Elements = {}): ProposedType => ({
  ...NOTHING_READ,
  ...elements,
  canBecomeProposal: true,
  name,
});

/** An item without a name, which cannot become a proposal, holding only `elements`. */
const unnamed = (elements: Elements = {}): ProposedType => ({
  ...NOTHING_READ,
  missingElements: EVERY_ELEMENT,
  ...elements,
  canBecomeProposal: false,
  name: undefined,
});

const NO_SOURCE_FIELD: ProposedIllustrationSource = {
  url: undefined,
  outlet: undefined,
  title: undefined,
  publicationDate: undefined,
  citationMarkers: [],
};

const SOURCE = {
  url: 'https://www.national-outlet.example/basketball/2024/02/01/trade-request',
  outlet: 'National Outlet',
  title: 'Forward asks to be traded, sources say',
  publicationDate: '2024-02-01',
  citationMarkers: [],
} as const satisfies ProposedIllustrationSource;

const TRADE_REQUEST = named('Trade request made public', {
  definition: 'A public report that the player asked his team to trade him.',
  inclusionCriteria:
    'A dated press article reports that the player or his agent asked the team for a trade.',
  exclusionCriteria:
    'Rumors that name no request by the player or his agent; trades that the team starts.',
  datingRule: 'The publication date of the first article that reports the request.',
  knownInAdvance: false,
  genericExample: 'A national outlet reports that player A asked team X to trade him.',
  documentationDifficulty: 'easy',
  possibleOverlaps: ['Media storm, when the request sparks wide coverage.'],
  illustrationSources: [SOURCE],
  missingElements: [],
});

// Its illustration sources are written as an empty list, which the format leaves out.
const ALL_STAR_SNUB = named('Left off the all-star roster', {
  definition: 'The official all-star rosters leave out a player whom the press expected on them.',
  inclusionCriteria:
    'The league announces the rosters and dated articles call the omission a snub.',
  datingRule: 'The date of the official roster announcement.',
  knownInAdvance: true,
  documentationDifficulty: 'medium',
  missingElements: [
    'exclusion_criteria',
    'generic_example',
    'possible_overlaps',
    'illustration_sources',
  ],
});

describe('parseExplorationResponse: the shape of the response', () => {
  it('[TAX-17] [CL-TAX-04] reads every element of each proposed type, in the order of the response', () => {
    const text = JSON.stringify(completeResponse, null, 2);

    expect(parse(text)).toStrictEqual(read([TRADE_REQUEST, ALL_STAR_SNUB]));
  });

  it('[TAX-17] [CL-TAX-04] reads an empty list of proposed types as a response that proposes no type', () => {
    expect(parse(respond(''))).toStrictEqual(read([]));
  });

  it('[TAX-17] [CL-IMP-06] reads null or an empty text for an optional element as missing, without a warning', () => {
    const { datingRule } = TRADE_REQUEST;
    const expected = named('Trade request made public', {
      datingRule,
      missingElements: allBut('dating_rule'),
    });

    expect(parse(answer(emptyOptionalElements))).toStrictEqual(read([expected]));
  });

  it('[TAX-17] [CL-IMP-06] reports each item whose name is null or empty as one that cannot become a proposal', () => {
    const missingElements = EVERY_ELEMENT.filter((key) => key !== 'definition');
    const coach =
      'His own head coach criticizes the player by name in a press conference or an interview.';

    expect(parse(answer(emptyName))).toStrictEqual(
      read([
        unnamed({ definition: TRADE_REQUEST.definition, missingElements }),
        unnamed({ definition: ALL_STAR_SNUB.definition, missingElements }),
        unnamed({ definition: coach, missingElements }),
        named('Trade request made public'),
      ]),
    );
  });

  it.each(['{}', '"A"', '3', 'true', 'null', '["A"]'])(
    '[TAX-17] reads the item %s as one without a name, which cannot become a proposal',
    (item) => {
      expect(parse(respond(item))).toStrictEqual(read([unnamed()]));
    },
  );

  it.each([
    ['name', '7'],
    ['name', '["A"]'],
    ['definition', '{"text": "A report."}'],
    ['definition', '["A report [1]."]'],
    ['known_in_advance', '"true"'],
    ['known_in_advance', '1'],
    ['documentation_difficulty', '"difficult"'],
    ['documentation_difficulty', '2'],
    ['possible_overlaps', '"Media storm."'],
    ['possible_overlaps', '[]'],
    ['possible_overlaps', '[null, 3, " ", {"type": "Media storm"}]'],
    ['illustration_sources', '{"url": "https://www.national-outlet.example/a"}'],
    ['illustration_sources', '[]'],
  ])('[TAX-17] [CL-TAX-04] reports the element %s written %s as missing', (key, value) => {
    const text = respond(`{"name": "A", "${key}": ${value}}`);

    expect(parse(text)).toStrictEqual(read([key === 'name' ? unnamed() : named('A')]));
  });

  it('[TAX-17] keeps the texts of the possible overlaps as written, and only them', () => {
    const overlaps = '[" Storm. ", "", "  ", 3, null, ["Feud."], "Humiliation."]';
    const text = respond(`{"name": "A", "possible_overlaps": ${overlaps}}`);
    const missingElements = allBut('possible_overlaps');

    expect(parse(text)).toStrictEqual(
      read([named('A', { possibleOverlaps: [' Storm. ', 'Humiliation.'], missingElements })]),
    );
  });

  it('[TAX-17] [CL-TAX-04] reads each illustration source with the keys of a research-result source, a value of another form missing', () => {
    const { url, outlet, title } = SOURCE;
    const sources = [
      `{"url": "${url}", "outlet": "${outlet}", "title": "${title}", "publication_date": "2024-02-01T09:30-05:00"}`,
      '{"url": 42, "outlet": "", "title": null, "publication_date": 20240201}',
      `"${url}"`,
      'null',
      `["${url}"]`,
      '{}',
    ];
    const illustrationSources = [
      { ...SOURCE, publicationDate: '2024-02-01T09:30-05:00' },
      ...Array.from({ length: 5 }, () => NO_SOURCE_FIELD),
    ];
    const text = respond(`{"name": "A", "illustration_sources": [${sources.join(', ')}]}`);
    const expected = named('A', {
      illustrationSources,
      missingElements: allBut('illustration_sources'),
    });

    expect(parse(text)).toStrictEqual(read([expected]));
  });

  it('[TAX-17] [CL-TAX-20] reads known_in_advance as the known-in-advance mark only, never as derived from the calendar', () => {
    const text = respond(
      '{"name": "A", "known_in_advance": true, "calendar_derivation": "birthday"}, {"name": "B", "known_in_advance": false, "derived_from_calendar": true}',
    );
    const missingElements = allBut('known_in_advance');
    const expected = [
      named('A', { knownInAdvance: true, missingElements }),
      named('B', { knownInAdvance: false, missingElements }),
    ];

    expect(parse(text)).toStrictEqual(read(expected, [UNKNOWN]));
  });

  it('[TAX-17] [CL-IMP-22] compares the format, the version and the documentation difficulty trimmed, ignoring case and accents', () => {
    const missingElements = allBut('documentation_difficulty');

    expect(parse(answer(closedValuesSpelledOtherwise))).toStrictEqual(
      read([
        named('Trade request', { documentationDifficulty: 'easy', missingElements }),
        named('All-star snub', { documentationDifficulty: 'medium', missingElements }),
        named('Coach criticism', { documentationDifficulty: 'hard', missingElements }),
      ]),
    );
  });
});

describe('parseExplorationResponse: the quirks of research AIs (CL-IMP-06)', () => {
  it.each([
    ['an introduction, a report and a conclusion with sources around the JSON', proseAround],
    ['the JSON between code fences with a language tag', codeFences],
    ['the five invisible characters, in keys, in a text and between tokens', invisibleCharacters],
    ['no-break and other Unicode spaces between the tokens', unicodeSpaces],
    ['the same response twice, on one line and laid out', sameObjectTwice],
  ])('[TAX-17] [CL-IMP-06] reads the response of an answer with %s', (_quirk, fixture) => {
    expect(parse(answer(fixture))).toStrictEqual(read([TRADE_REQUEST]));
  });

  it('[TAX-17] [CL-IMP-06] keeps the exploration response of a text that also holds a research result', () => {
    const text = `${answer(researchResult)}\n${answer(proseAround)}`;

    expect(parse(text)).toStrictEqual(read([TRADE_REQUEST]));
  });

  it('[TAX-17] [CL-IMP-06] refuses two different exploration responses, asking to paste only one', () => {
    expect(parse(answer(twoResponses))).toStrictEqual(
      refused(
        'several_results',
        'The text holds several different JSON objects. Paste only one exploration response.',
      ),
    );
  });

  it.each([
    ['a citation marker between two tokens', answer(markerBetweenTokens), 'around proposed type 2'],
    ['curly quotation marks as delimiters', answer(curlyQuotes), 'at the start of the response'],
    ['a comma after the last element of a type', answer(trailingComma), 'around proposed type 2'],
    ['a comment between two types', answer(comment), 'around proposed type 2'],
    ['a missing comma', '{"format": "a" "proposed_types": []}', 'around the field format'],
    ['a missing colon', '{"format_version" "1.0"}', 'around the field format_version'],
    ['a fault in an unknown list', '{"notes": [1 2]}', 'around an unknown field'],
    ['a comma after the list', '{"proposed_types": [],}', 'around the field proposed_types'],
    [
      'a fault before the format of a research result, which is then never read',
      '{"covered_types": ["media-storm"] [2], "format": "egoscope-backtest"}',
      'around an unknown field',
    ],
  ])('[TAX-17] [CL-IMP-06] repairs nothing: %s is a located syntax error', (_, text, place) => {
    expect(parse(text)).toStrictEqual(syntaxError(place));
  });

  it('[TAX-17] [CL-TAX-04] locates a syntax error around the proposed type that holds it, in a list of any length', () => {
    const faulty = fc
      .integer({ min: 1, max: 30 })
      .chain((count) => fc.tuple(fc.constant(count), fc.integer({ min: 1, max: count })));

    fc.assert(
      fc.property(faulty, ([count, position]) => {
        const types = Array.from({ length: count }, (_, index) => {
          const marker = index + 1 === position ? ' [3]' : '';
          return `{"name": "Type ${String(index + 1)}"${marker}}`;
        });
        const text = respond(types.join(', '));

        expect(parse(text)).toStrictEqual(syntaxError(`around proposed type ${String(position)}`));
      }),
    );
  });

  it.each([
    ['in a proposed type', answer(cutAnswer), ': proposed type 3 is cut off'],
    ['in the version', '{"format": "egoscope-exploration", "format_version": "1.', ''],
    ['after the list of proposed types', '{"proposed_types": []', ''],
  ])('[TAX-17] [CL-TAX-04] refuses an answer cut %s, never recovered', (_, text, cutOff) => {
    expect(parse(text)).toStrictEqual(
      refused(
        'cut_not_recoverable',
        `The text stops before the end of the response${cutOff}. Copy the whole answer again, or ask the AI for fewer types.`,
      ),
    );
  });

  it('[TAX-17] [CL-IMP-07] flags a citation marker in each text of the sheet and in the outlet and title of a source, kept as written, never in a possible overlap or a link', () => {
    const expected = named('Trade request made public [1]', {
      ...TRADE_REQUEST,
      definition: 'A public report that the player asked his team to trade him [^2].',
      inclusionCriteria: 'A dated press article reports the request [cite: 3].',
      exclusionCriteria: 'Rumors that name no request by the player or his agent【4】.',
      datingRule: 'The publication date of the first article that reports the request†.',
      genericExample: 'A national outlet reports that player A asked team X to trade him.¹',
      possibleOverlaps: ['Media storm [5], when the request sparks wide coverage.'],
      illustrationSources: [
        {
          ...SOURCE,
          outlet: 'National Outlet [6]',
          title: 'Forward asks to be traded【7†source】',
          citationMarkers: ['outlet', 'title'],
        },
        {
          url: 'https://www.city-daily.example/sports/2024/02/02/trade-request[8]',
          outlet: 'City Daily',
          title: 'The forward wants out',
          publicationDate: '2024-02-02',
          citationMarkers: [],
        },
      ],
      citationMarkers: [
        'name',
        'definition',
        'inclusion_criteria',
        'exclusion_criteria',
        'dating_rule',
        'generic_example',
      ],
    });

    expect(parse(answer(markerInsideText))).toStrictEqual(read([expected]));
  });

  // A proposed type named A, with one illustration source that holds no field of the format.
  const A_WITH_AN_EMPTY_SOURCE = named('A', {
    illustrationSources: [NO_SOURCE_FIELD],
    missingElements: allBut('illustration_sources'),
  });

  it.each([
    { level: 'at the root', root: ', "notes": "Searched from 2015."', item: '', source: '' },
    { level: 'in a proposed type', root: '', item: ', "points_scored": 31', source: '' },
    { level: 'in an illustration source', root: '', item: '', source: '"author": "A reporter"' },
    { level: 'at every level', root: ', "notes": 1', item: ', "notes": 2', source: '"notes": 3' },
  ])(
    '[TAX-17] [CL-IMP-06] ignores an unknown field $level, flagged once',
    ({ root, item, source }) => {
      const text = respond(
        `{"name": "A"${item}, "illustration_sources": [{${source}}]}`,
        HEADER + root,
      );

      expect(parse(text)).toStrictEqual(read([A_WITH_AN_EMPTY_SOURCE], [UNKNOWN]));
    },
  );

  it('[TAX-17] [CL-IMP-06] reads keys renamed by the AI, camel-cased or French, as unknown fields, the elements they stood for missing', () => {
    const { definition, datingRule } = TRADE_REQUEST;
    const expected = named('Trade request made public', {
      definition,
      datingRule,
      missingElements: allBut('definition', 'dating_rule'),
    });

    expect(parse(answer(renamedKeys))).toStrictEqual(read([expected], [MISSING, UNKNOWN]));
  });
});

describe('parseExplorationResponse: the format and its version', () => {
  const NOT_AN_EXPLORATION_RESPONSE = refused(
    'not_an_exploration_response',
    'This text is not an exploration response.',
  );

  it('[TAX-17] [CA-TAX-17] [CL-TAX-04] refuses a research result pasted by mistake: "This text is not an exploration response."', () => {
    expect(parse(answer(researchResult))).toStrictEqual(NOT_AN_EXPLORATION_RESPONSE);
  });

  // The research result of the fixture, and the same with a citation marker between tokens.
  const RESULT = answer(researchResult);
  const BROKEN_RESULT = RESULT.replace('["media-storm"]', '["media-storm"] [2]');

  it.each([
    ['cut before its events', RESULT.slice(0, RESULT.indexOf('"events"'))],
    ['with a citation marker after its covered types', BROKEN_RESULT],
    ['twice, for two requests', `${RESULT}\n${RESULT.replaceAll('0007', '0008')}`],
  ])(
    '[TAX-17] [CA-TAX-17] refuses a research result %s: "This text is not an exploration response."',
    (_, text) => {
      expect(parse(text)).toStrictEqual(NOT_AN_EXPLORATION_RESPONSE);
    },
  );

  it.each([
    ['a citation marker between tokens', answer(markerBetweenTokens), 'syntax_error'],
    ['a cut', answer(cutAnswer), 'cut_not_recoverable'],
    ['a second, different response', answer(twoResponses), 'several_results'],
  ] as const)(
    '[TAX-17] [CL-IMP-06] keeps the refusal of an exploration response with %s, next to a research result that can be read or not',
    (_, response, kind) => {
      const alone = parse(response);

      expect(alone).toMatchObject({ ok: false, error: { kind } });
      expect(parse(`${RESULT}\n${response}`)).toStrictEqual(alone);
      expect(parse(`${BROKEN_RESULT}\n${response}`)).toStrictEqual(alone);
    },
  );

  it.each([
    '{"format": "egoscope_exploration", "proposed_types": []}',
    '{"format": "exploration", "proposed_types": []}',
    '{"format": 1, "proposed_types": []}',
    '{"format": ["egoscope-exploration"], "proposed_types": []}',
    '{"format_version": "1.0", "types": []}',
    '{"proposed_types": null}',
    '{"proposed_types": {"name": "A"}}',
  ])('[TAX-17] [CL-TAX-04] refuses %s: "This text is not an exploration response."', (text) => {
    expect(parse(text)).toStrictEqual(NOT_AN_EXPLORATION_RESPONSE);
  });

  it.each(['"2.0"', '"1.1"', '"1.0.0"', '"v1"', '2', '1.5', 'true', '["1.0"]'])(
    '[TAX-17] [CL-TAX-04] refuses the format version %s with the advice to generate the prompt again',
    (version) => {
      const text = respond('', `"format": "egoscope-exploration", "format_version": ${version}`);

      expect(parse(text)).toStrictEqual(
        refused(
          'unknown_version',
          'This response is not in format version 1.0, the only one Egoscope reads. Generate the exploration prompt again and give it to the AI.',
        ),
      );
    },
  );

  it('[TAX-17] [CL-IMP-06] reads the format version written 1 as 1.0, and a response without its format and version as 1.0, each with a warning', () => {
    expect(parse(answer(versionWrittenOne))).toStrictEqual(read([TRADE_REQUEST], [NORMALIZED]));
    expect(parse(answer(formatAndVersionMissing))).toStrictEqual(read([TRADE_REQUEST], [MISSING]));
  });

  it.each([
    ['"format": "egoscope-exploration", "format_version": " 1 "', [NORMALIZED]],
    ['"format": "egoscope-exploration", "format_version": 1', [NORMALIZED]],
    ['"format": "egoscope-exploration", "format_version": 1.0', [NORMALIZED]],
    ['"format_version": "1.0"', [MISSING]],
    ['"format": null, "format_version": "1.0"', [MISSING]],
    ['"format": "egoscope-exploration"', [MISSING]],
    ['"format": "egoscope-exploration", "format_version": ""', [MISSING]],
    ['"format": " ", "format_version": 1', [MISSING, NORMALIZED]],
  ])(
    '[TAX-17] [CL-IMP-06] reads the header %s, its list there, with the warnings %j',
    (header, warnings) => {
      expect(parse(respond('', header))).toStrictEqual(read([], warnings));
    },
  );

  it.each([
    `{${HEADER}}`,
    `{${HEADER}, "proposed_types": null}`,
    `{${HEADER}, "proposed_types": ""}`,
    `{${HEADER}, "proposed_types": "none"}`,
    `{${HEADER}, "proposed_types": {"name": "A"}}`,
  ])(
    '[TAX-17] [CL-TAX-04] refuses %s, in the format but without its list of proposed types',
    (text) => {
      expect(parse(text)).toStrictEqual(
        refused(
          'proposed_types_missing',
          'The response has no list of proposed types (proposed_types). Ask the AI to answer again in the format of the exploration prompt.',
        ),
      );
    },
  );

  it.each(['', 'I could not find any type that fits these rules.'])(
    '[TAX-17] finds no response in %j',
    (text) => {
      expect(parse(text)).toStrictEqual(
        refused(
          'no_result_found',
          "No recognizable response: check that you copied the AI's whole answer.",
        ),
      );
    },
  );
});

describe('parseExplorationResponse: the size bound', () => {
  // pasted-text-size.test.ts gives the rules of the size and of its message.
  it('[TAX-17] [CL-IMP-27] reads a response of the size bound set, and refuses one byte more before reading it', () => {
    const empty = respond('');
    const atLimit = `${empty}${' '.repeat(500_000 - empty.length)}`;

    expect(parse(atLimit, 0.5)).toStrictEqual(read([]));
    expect(parse(` ${atLimit}`, 0.5)).toStrictEqual(
      refused('text_too_large', 'The pasted text is 0.51 MB, over the 0.5 MB limit.'),
    );
  });
});
