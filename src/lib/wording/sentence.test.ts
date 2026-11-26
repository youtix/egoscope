import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { sentence } from './sentence';
import { alertsSentences } from './sentences/alerts';
import { backtestsSentences } from './sentences/backtests';
import { collectionSentences } from './sentences/collection';
import { crossCuttingSentences } from './sentences/cross-cutting';
import { detectionSentences } from './sentences/detection';
import { importsSentences } from './sentences/imports';
import { interfaceSentences } from './sentences/interface';
import { notificationsSentences } from './sentences/notifications';
import { overviewSentences } from './sentences/overview';
import { playersSentences } from './sentences/players';
import { sensitiveDataSentences } from './sentences/sensitive-data';
import { sensitivitySentences } from './sentences/sensitivity';
import { statisticsSentences } from './sentences/statistics';
import { taxonomySentences } from './sentences/taxonomy';
import { trackingSentences } from './sentences/tracking';
import { fill } from './template';

const SENTENCES_FOLDER = path.join(import.meta.dirname, 'sentences');
// The names of the module map, section 2.1: one file per spec file, 00 to 14.
const SPEC_FILES = [
  'alerts.ts',
  'backtests.ts',
  'collection.ts',
  'cross-cutting.ts',
  'detection.ts',
  'imports.ts',
  'interface.ts',
  'notifications.ts',
  'overview.ts',
  'players.ts',
  'sensitive-data.ts',
  'sensitivity.ts',
  'statistics.ts',
  'taxonomy.ts',
  'tracking.ts',
];
// The slot that ends every file, above which an area adds its own groups.
const AREA_SLOT =
  '\n  // An area adds its groups above this line, one commented group per screen or task.\n} as const;\n';
// Every fixed sentence, by the name of its file in the keys of `sentence`, in the order of
// the spec files.
const SENTENCE_FILES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  overview: overviewSentences,
  players: playersSentences,
  taxonomy: taxonomySentences,
  collection: collectionSentences,
  detection: detectionSentences,
  backtests: backtestsSentences,
  imports: importsSentences,
  statistics: statisticsSentences,
  sensitivity: sensitivitySentences,
  alerts: alertsSentences,
  tracking: trackingSentences,
  notifications: notificationsSentences,
  interface: interfaceSentences,
  sensitiveData: sensitiveDataSentences,
  crossCutting: crossCuttingSentences,
};
// Every fixed sentence, by its key: `sensitivity.possible`.
const TEMPLATES: readonly (readonly [string, string])[] = Object.entries(SENTENCE_FILES).flatMap(
  ([file, sentences]) =>
    Object.entries(sentences).map(([name, text]) => [`${file}.${name}`, text] as const),
);
// The name that opens a placeholder, well formed or not: `k` of `{k|case}` too.
const PLACEHOLDER_NAME = /\{(?<name>[A-Za-z]+)/gu;
// A written count that takes the plural, given to every placeholder.
const WRITTEN_VALUE = '2';
const BRACE = /[{}]/u;

/** `template` filled with a value for each placeholder that it names. */
function filled(template: string): string {
  const names = Array.from(
    template.matchAll(PLACEHOLDER_NAME),
    (match) => match.groups?.['name'] ?? '',
  );
  return fill(template, [Object.fromEntries(names.map((name) => [name, WRITTEN_VALUE]))]);
}

const GLOSSARY_TEXT = readFileSync(
  path.join(import.meta.dirname, '../../../docs/engineering/glossary.md'),
  'utf8',
);
// A placeholder of a template, {date}, or a noun that a count governs, {k|case|cases}.
const TEMPLATE_PLACEHOLDER = /\{[A-Za-z]+(?:\|(?<one>[^{}|]+)\|(?<many>[^{}|]+))?\}/gu;
// What a placeholder matches in a row: any text, since a row writes the placeholder, an
// example value ("7 valid cases: 5 historical, 2 tracked") or a bare letter ("k").
const ANY_TEXT = '.+';
const PATTERN_SYNTAX = /[$()*+.?[\\\]^{|}]/gu;
// The words that only join placeholders: "{k} of {m}", "from {low} to {high}".
const CONNECTING_WORDS: ReadonlySet<string> = new Set(['from', 'of', 'on', 'to']);
const WORD = /\p{L}+/gu;
// The code value of a row of a set's table in section 4.1: "`active`".
const SET_CODE_VALUE = /^`[a-z_]+`$/u;
// The note that ends a cell: `{k} characters received ("1 character received" for one)`.
const TRAILING_NOTE = / \([^()]*\)$/u;
// What separates the texts that one cell lists: "Home / Players / Alerts / Types / More".
const PART_SEPARATOR = ' / ';

/** Whether a line of a glossary table is the separator row under its header. */
const isSeparator = (line: string | undefined): boolean => line?.startsWith('| -') === true;

/** The rows of the tables of a glossary text between two headings, as their cells, without their header and separator rows. */
function tableRows(glossary: string, start: string, end: string): readonly (readonly string[])[] {
  const lines = glossary.slice(glossary.indexOf(start), glossary.indexOf(end)).split('\n');
  return lines
    .filter(
      (line, index) =>
        line.startsWith('| ') && !isSeparator(line) && !isSeparator(lines[index + 1]),
    )
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
}

/**
 * The cells of the glossary that give wording: every cell of the tables of sections 7.1 to
 * 7.6, whose sub-tables put the English in other columns than the first ones, and the UI
 * label of the rows of section 3 and of the sets of section 4.1. The Meaning column of
 * section 3 is a note for engineers, never wording.
 */
function wordingCells(glossary: string): readonly string[] {
  return [
    ...tableRows(glossary, '### 7.1', '### 7.7').flat(),
    ...tableRows(glossary, '## 3.', '## 4.').map((cells) => cells[3] ?? ''),
    ...tableRows(glossary, '### 4.1', '### 4.2')
      .filter((cells) => SET_CODE_VALUE.test(cells[1] ?? ''))
      .map((cells) => cells[2] ?? ''),
  ];
}

/** The texts that a cell gives: its whole text and each part it lists, each also without its trailing note. */
function cellTexts(cell: string): readonly string[] {
  return [cell, ...cell.split(PART_SEPARATOR)].flatMap((text) => [
    text,
    text.replace(TRAILING_NOTE, ''),
  ]);
}

const escaped = (text: string): string => text.replaceAll(PATTERN_SYNTAX, String.raw`\$&`);

/** A template as a pattern: its text literal, a placeholder any text, a noun that a count governs either of its forms. */
function templatePattern(template: string): string {
  let pattern = '';
  let end = 0;
  for (const match of template.matchAll(TEMPLATE_PLACEHOLDER)) {
    const one = match.groups?.['one'];
    const many = match.groups?.['many'];
    pattern += escaped(template.slice(end, match.index));
    pattern +=
      one === undefined || many === undefined ? ANY_TEXT : `(?:${escaped(one)}|${escaped(many)})`;
    end = match.index + match[0].length;
  }
  return pattern + escaped(template.slice(end));
}

/**
 * Whether a template is nothing but placeholders and the words that join them, "{level},
 * {direction}" or "{k} of {m}", which match any cell that holds the joining word.
 */
function isOnlyPlaceholders(template: string): boolean {
  // The forms of its nouns, one entry for each placeholder.
  const forms = Array.from(
    template.matchAll(TEMPLATE_PLACEHOLDER),
    (match) => `${match.groups?.['one'] ?? ''} ${match.groups?.['many'] ?? ''}`,
  );
  // The words of the template: its literal text and the forms of its nouns.
  const text = [template.replaceAll(TEMPLATE_PLACEHOLDER, ' '), ...forms].join(' ');
  return forms.length > 0 && (text.match(WORD) ?? []).every((word) => CONNECTING_WORDS.has(word));
}

/** How a glossary text holds a sentence: as a text of a cell, only inside a cell, or not at all. */
type Reading = 'whole' | 'inside' | 'none';

/**
 * The reading of the fixed sentences against a glossary text. A sentence is found whole
 * when it is a text of a wording cell, as a pattern (`cellTexts`, `templatePattern`); when
 * it is not, or when it is nothing but placeholders and joining words, which a text of
 * many unrelated cells matches, it must occur inside a cell, between word boundaries.
 * Found whole, a sentence has the wording of its row: a changed word in either fails it.
 * Found inside, it only proves that the glossary writes it as part of a longer text, and
 * for a sentence of placeholders, such as "{k} of {m}", that a cell holds its joining
 * word, which proves little: the test records which sentences only that reading finds.
 */
function glossaryReader(glossary: string): (template: string) => Reading {
  const cells = wordingCells(glossary);
  const texts = cells.flatMap((cell) => cellTexts(cell));
  return (template) => {
    const pattern = templatePattern(template);
    const whole = new RegExp(`^${pattern}$`, 'u');
    if (!isOnlyPlaceholders(template) && texts.some((text) => whole.test(text))) {
      return 'whole';
    }
    const inside = new RegExp(String.raw`(?<![\p{L}\p{N}])${pattern}(?![\p{L}\p{N}])`, 'u');
    return cells.some((cell) => inside.test(cell)) ? 'inside' : 'none';
  };
}

/** The keys of the fixed sentences that the glossary holds by `reading`. */
function sentencesRead(reading: Reading): readonly string[] {
  const read = glossaryReader(GLOSSARY_TEXT);
  return TEMPLATES.filter(([, template]) => read(template) === reading).map(([key]) => key);
}

/** A glossary text of one table per section that the reading reads, with one English text of section 7. */
function madeUpGlossary(english: string): string {
  return [
    '## 3. Terms by domain',
    '| French | English | Code | UI label | Meaning |',
    '| ------ | ------- | ---- | -------- | ------- |',
    '| joueur | player | `playerId` | Player | A followed player. |',
    '## 4. Enumerations',
    '### 4.1 Sets by domain',
    '`PlayerStatus` — JOU-15',
    '| French | Code value | UI label |',
    '| ------ | ---------- | -------- |',
    '| actif | `active` | Active |',
    '### 4.2 Near-synonyms',
    '## 7. Fixed sentences and labels',
    '### 7.1 Notices and disclaimers',
    '| French | English | IDs |',
    '| ------ | ------- | --- |',
    `| — (essai) | ${english} | IMP-02 |`,
    '### 7.7 One-sentence definitions',
  ].join('\n');
}

describe('fixed sentences', () => {
  it('keeps one sentences file per spec file, each ending with the slot of the areas', () => {
    const files = readdirSync(SENTENCES_FOLDER).toSorted((left, right) =>
      left.localeCompare(right, 'en'),
    );
    const withoutSlot = files.filter(
      (file) => !readFileSync(path.join(SENTENCES_FOLDER, file), 'utf8').endsWith(AREA_SLOT),
    );

    expect(files).toStrictEqual(SPEC_FILES);
    expect(withoutSlot).toStrictEqual([]);
  });

  it('[VUE-08] fills every placeholder of every fixed sentence, and leaves no brace to reach a screen', () => {
    const withBraces = TEMPLATES.map(([, text]) => filled(text));

    expect(withBraces.filter((text) => BRACE.test(text))).toStrictEqual([]);
  });

  it('[SEN-30] gives the reminder that accompanies every general trend', () => {
    expect(sentence('sensitivity.generalTrendReminder')).toBe(
      'The general trend describes all observed players, not any one of them.',
    );
  });

  it('[SEN-31] labels a profile under the case threshold and titles the general trend beside it', () => {
    expect(sentence('sensitivity.inconclusiveForPlayer', { k: '4', n: '5' })).toBe(
      'inconclusive for this player (4 valid cases of the 5 needed)',
    );
    expect(sentence('sensitivity.generalTrendTitle')).toBe(
      'general trend of the type, does not describe this player',
    );
  });

  it('[SEN-31] [CL-SEN-15] [CL-TEL-16] writes one valid case in the singular, and none or several in the plural', () => {
    expect(
      ['0', '1', '4'].map((k) => sentence('sensitivity.inconclusiveForPlayer', { k, n: '5' })),
    ).toStrictEqual([
      'inconclusive for this player (0 valid cases of the 5 needed)',
      'inconclusive for this player (1 valid case of the 5 needed)',
      'inconclusive for this player (4 valid cases of the 5 needed)',
    ]);
  });

  it('[IHM-50] gives the profile and validation screens their short notice', () => {
    expect(sentence('interface.shortNotice')).toBe(
      'A measure of the past, an unproven hypothesis, no betting recommendation',
    );
  });

  it('[ALE-17] gives the standing notice that ends every alert sheet', () => {
    expect(sentence('alerts.standingNotice')).toBe(
      'This sheet describes past games. It does not predict the next game and is not a betting recommendation.',
    );
  });

  it('[TEL-05] gives the mention that closes every alert message', () => {
    expect(sentence('notifications.closingLine')).toBe('A measure of the past, not a forecast.');
  });

  it('[IHM-54] [IHM-55] [IHM-56] writes each empty state with the action that fills it', () => {
    expect([
      sentence('interface.addPlayer'),
      sentence('interface.noValidatedType'),
      sentence('interface.noBacktestYet'),
      sentence('interface.requestBacktest'),
      sentence('interface.noEventOfType', { date: 'Tue 17 Nov 2026' }),
      sentence('interface.nothingToDo'),
      sentence('interface.noAlertYet'),
      sentence('interface.noPressSource'),
    ]).toStrictEqual([
      'Add a player',
      'no validated type',
      'no backtest yet',
      'Request a backtest',
      'no event of this type found by the backtest of Tue 17 Nov 2026',
      'Nothing to do right now',
      'an alert is produced when a profiled player has a new event',
      'detection cannot work',
    ]);
  });

  it('presents Home at first launch, the third disclaimer that says what the app does not do', () => {
    expect(sentence('interface.firstLaunchPresentation')).toBe(
      'Egoscope measures how followed players played after public events. It does not predict games or give betting advice.',
    );
  });

  it('[CL-DSN-20] describes a calendar-derived event, naming only the player and his former team', () => {
    expect(sentence('sensitiveData.birthdayDescription', { player: 'Player A' })).toBe(
      'Player A plays on his birthday.',
    );
    expect(
      sentence('sensitiveData.formerTeamDescription', { player: 'Player A', team: 'Team X' }),
    ).toBe('Player A faces his former team Team X for the first time since leaving it.');
  });

  describe('against the glossary', () => {
    it('[VUE-08] finds every fixed sentence in the wording of the glossary', () => {
      expect(sentencesRead('none')).toStrictEqual([]);
    });

    it('[VUE-08] finds only these sentences inside a longer text of the glossary, and none other', () => {
      // Pieces that the glossary writes only inside its rows ("possible, increase", "range
      // from +0.09 to +1.51", "5 of 7 cases above zero", "7 valid cases: 5 historical, 2
      // tracked"), and sentences of placeholders and joining words, which a whole text
      // cannot prove. A sentence that joins them or leaves them is seen by a reviewer here.
      expect(sentencesRead('inside')).toStrictEqual([
        'sensitivity.rangeBounds',
        'sensitivity.validCaseCount',
        'sensitivity.possible',
        'sensitivity.probable',
        'sensitivity.increase',
        'sensitivity.decrease',
        'sensitivity.levelAndDirection',
        'sensitivity.proportionAsCounts',
        'interface.deviceDescription',
        'interface.teamName',
        'interface.correctionEntry',
        'interface.correctionWithValues',
        'interface.datedValue',
      ]);
    });

    it('[VUE-08] finds a sentence whole in a text of a cell, one of its parts or a UI label, read as a pattern', () => {
      const cases = [
        [
          '{k} characters received ("1 character received" for one)',
          '{k} {k|character|characters} received',
        ],
        [
          'This file is {size} MB, over the {limit} MB limit: choose a smaller text file.',
          'This file is {size} MB, over the {limit} MB limit: choose a smaller text file.',
        ],
        [
          '7 valid cases: 5 historical, 2 tracked',
          '{k} valid {k|case|cases}: {h} historical, {t} tracked',
        ],
        ['Home / Players / More', 'Players'],
        ['Home / Players / More', 'Player'],
        ['Home / Players / More', 'Active'],
      ] as const;

      expect(
        cases.map(([english, template]) => glossaryReader(madeUpGlossary(english))(template)),
      ).toStrictEqual(['whole', 'whole', 'whole', 'whole', 'whole', 'whole']);
    });

    it('[VUE-08] finds a piece of a longer text, or a sentence of placeholders, only inside a cell', () => {
      const read = glossaryReader(madeUpGlossary('possible, increase / inconclusive'));

      expect(
        ['possible', '{level}, {direction}', 'inconclusive (the level alone)'].map((template) =>
          read(template),
        ),
      ).toStrictEqual(['inside', 'inside', 'none']);
    });

    it('[VUE-08] finds no sentence that differs from its row by a word, nor one in a header or the Meaning column', () => {
      const read = glossaryReader(
        madeUpGlossary('This file is far over the {limit} MB limit: choose a smaller text file.'),
      );

      expect(
        [
          'This file is {size} MB, over the {limit} MB limit: choose a smaller text file.',
          'This file is far over the {limit} MB limit: choose another text file.',
          'English',
          'UI label',
          'A followed player.',
          'active',
        ].map((template) => read(template)),
      ).toStrictEqual(['none', 'none', 'none', 'none', 'none', 'none']);
    });
  });

  it('refuses a sentence that no spec file holds', () => {
    // @ts-expect-error: no spec file holds a sentence of this name
    expect(() => sentence('sensitivity.prediction')).toThrow(
      'No fixed sentence is named sensitivity.prediction',
    );
  });
});
