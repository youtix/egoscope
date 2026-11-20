import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { definition, GLOSSARY } from './glossary';

const GLOSSARY_FILE = path.join(import.meta.dirname, '../../../docs/engineering/glossary.md');
const GLOSSARY_TEXT = readFileSync(GLOSSARY_FILE, 'utf8');

/** The cells of the rows of the tables of `section`, header and separator rows left out. */
function tableRows(section: string): readonly (readonly string[])[] {
  return section
    .split('\n')
    .filter(
      (line) => line.startsWith('| ') && !line.startsWith('| French') && !line.startsWith('| -'),
    )
    .map((line) => line.split('|').map((cell) => cell.trim()));
}

/** A term in camelCase: `signalToNoiseRatio` for "signal-to-noise ratio". */
const camelCase = (term: string): string =>
  term
    .split(/[\s-]+/u)
    .map((word, index) => (index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`))
    .join('');

/** A term in sentence case, as a label writes it: "Historical case" for "historical case". */
const sentenceCase = (term: string): string => `${term.charAt(0).toUpperCase()}${term.slice(1)}`;

const between = (start: string, end: string): string =>
  GLOSSARY_TEXT.slice(GLOSSARY_TEXT.indexOf(start), GLOSSARY_TEXT.indexOf(end));

/** The rows of the table of glossary section 7.7. */
const SECTION_7_7 = tableRows(between('### 7.7', '## 8.'));
/** The rows of the domain tables of glossary section 3. */
const SECTION_3 = tableRows(between('## 3.', '## 4.'));

/** The definitions of glossary section 7.7, by English term in camelCase. */
const SECTION_DEFINITIONS: ReadonlyMap<string, string> = new Map(
  SECTION_7_7.map((cells) => [camelCase(cells[2] ?? ''), cells[3] ?? '']),
);

/** The Meaning column of the domain tables of glossary section 3, a note for engineers. */
const MEANINGS: readonly string[] = SECTION_3.map((cells) => cells[5] ?? '');

/** The rows of section 3, each with the English terms it names and its UI label. */
const TERM_ROWS = SECTION_3.map((cells) => ({
  terms: (cells[2] ?? '').split(', '),
  uiLabel: cells[4] ?? '',
}));

// The four terms whose label the rule at the top of glossary.ts does not take from the
// rows that name them in section 3. The historical case and the dismissal keep their
// name, since their rows label a case origin, "Historical", and an action and a status,
// "Dismiss; Dismissed". The two status terms take the label of the row of their state
// set, which names them by a shorter term.
const OWN_NAMES: ReadonlySet<string> = new Set(['historical case', 'dismissal']);
const STATUS_ROWS: ReadonlyMap<string, string> = new Map([
  ['alert sheet status', 'sheet status'],
  ['season baseline status', 'baseline status'],
]);

/**
 * The label of a term of section 7.7 by the rule at the top of glossary.ts: the UI
 * label of the rows of section 3 that name the term, and, when they give more than one,
 * the label that names the term itself ("Tracked case", not the case origin "Tracked").
 */
function sectionLabel(term: string): string | undefined {
  if (OWN_NAMES.has(term)) {
    return sentenceCase(term);
  }
  const rowTerm = STATUS_ROWS.get(term) ?? term;
  const uiLabels = new Set(
    TERM_ROWS.filter((row) => row.terms.includes(rowTerm)).map((row) => row.uiLabel),
  );
  if (uiLabels.size === 1) {
    return [...uiLabels][0];
  }
  return uiLabels.has(sentenceCase(term)) ? sentenceCase(term) : undefined;
}

/** The label of every term of glossary section 7.7 by that rule, by English term in camelCase. */
const SECTION_LABELS: ReadonlyMap<string, string | undefined> = new Map(
  SECTION_7_7.map((cells) => [camelCase(cells[2] ?? ''), sectionLabel(cells[2] ?? '')]),
);

describe('one-sentence definitions', () => {
  it('[IHM-15] takes the definition of every term of glossary section 7.7 verbatim, and defines no other term', () => {
    const defined = new Map(Object.entries(GLOSSARY).map(([term, entry]) => [term, entry.text]));

    expect(defined).toStrictEqual(SECTION_DEFINITIONS);
  });

  it('[IHM-15] writes no definition from the Meaning column of glossary section 3', () => {
    const fromMeanings = Object.values(GLOSSARY).filter((entry) => MEANINGS.includes(entry.text));

    expect(MEANINGS).toContainEqual(
      expect.stringMatching(/^Instant the measured game is searched from/u),
    );
    expect(fromMeanings).toStrictEqual([]);
  });

  it('[IHM-15] defines the reference instant as section 7.7 does, naming no time zone', () => {
    const { text } = definition('referenceInstant');

    expect(text).toBe(
      'The moment an event is taken to have become public, from which its measured game is searched; a date without a time is moved, for caution, to the end of that day, except for an event known in advance.',
    );
    expect(text).not.toMatch(/Los Angeles|Pacific|Eastern|Paris|UTC|zone/u);
  });

  it('[VUE-08] [IHM-15] labels every term of glossary section 7.7 with the UI label of the rows that name it in section 3', () => {
    const labels = new Map(Object.entries(GLOSSARY).map(([term, entry]) => [term, entry.label]));

    expect(labels).toStrictEqual(SECTION_LABELS);
  });

  it('[IHM-15] gives a term the label that screens show it under, with its definition', () => {
    expect(definition('normalizedGap')).toStrictEqual({
      label: 'Gap',
      text: "How far the measured game's performance index is from the season mean, in season standard deviations.",
    });
    expect(definition('plausibleRange').label).toBe('Range');
    expect(definition('validCase').label).toBe('Valid case');
    expect(definition('alertSheetStatus').label).toBe('Status');
    expect(definition('historicalCase').label).toBe('Historical case');
  });

  it('[IHM-15] gives no definition to a term that section 7.7 leaves out, as screens never show it', () => {
    // @ts-expect-error: the retained dispersion is never shown, so it has no definition
    expect(definition('retainedDispersion')).toBeUndefined();
    // @ts-expect-error: a lot is never shown either
    expect(definition('lot')).toBeUndefined();
  });
});
