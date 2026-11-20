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

const between = (start: string, end: string): string =>
  GLOSSARY_TEXT.slice(GLOSSARY_TEXT.indexOf(start), GLOSSARY_TEXT.indexOf(end));

/** The definitions of glossary section 7.7, by English term in camelCase. */
const SECTION_DEFINITIONS: ReadonlyMap<string, string> = new Map(
  tableRows(between('### 7.7', '## 8.')).map((cells) => [
    camelCase(cells[2] ?? ''),
    cells[3] ?? '',
  ]),
);

/** The Meaning column of the domain tables of glossary section 3, a note for engineers. */
const MEANINGS: readonly string[] = tableRows(between('## 3.', '## 4.')).map(
  (cells) => cells[5] ?? '',
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
