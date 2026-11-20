import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { incidents, journalEntries, taskRuns } from '@/lib/db';

import {
  BLOCKING_ERROR_WORDS,
  CATEGORY_LABELS,
  CAUSE_WORDS,
  codesOf,
  INCIDENT_NAMES,
  LEVEL_LABELS,
  NOTIFICATION_CATEGORY_WORDS,
  SERVICE_LABELS,
  SERVICE_WORDS,
  TASK_NAMES,
  TRIGGER_WORDS,
  wordsFor,
} from './labels';

import type { Words } from './labels';

const GLOSSARY = readFileSync(
  path.join(import.meta.dirname, '../../../docs/engineering/glossary.md'),
  'utf8',
);
// A code in a table cell, as the glossary writes it: "`task_pass`".
const CODE_CELL = /^`(?<code>[a-z_-]+)`$/u;
// What follows the name of the two quota incidents: "Quota reached — {service function}".
const SERVICE_FUNCTION = ' — {service function}';

/** The cells of the table rows of `text`, trimmed. */
const rows = (text: string): readonly (readonly string[])[] =>
  text
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) => line.split('|').map((cell) => cell.trim()));

/** The table of glossary section 4.1 that follows the heading of the set `name`: code, then UI label. */
function setLabels(name: string): ReadonlyMap<string, string> {
  const start = GLOSSARY.indexOf(`\`${name}\` — `);
  const table = GLOSSARY.slice(start, GLOSSARY.indexOf('\n\n', GLOSSARY.indexOf('\n|', start)));
  // A row of a set: an empty cell before the first bar, the French term, the code, the label.
  return new Map(
    rows(table).flatMap((cells) => {
      const code = CODE_CELL.exec(cells[2] ?? '')?.groups?.['code'];
      return code === undefined ? [] : [[code, cells[3] ?? ''] as const];
    }),
  );
}

/** The English names of glossary section `section` (9.1 or 9.2), by key. */
function namesOf(section: string, next: string): ReadonlyMap<string, string> {
  const table = GLOSSARY.slice(GLOSSARY.indexOf(`### ${section}`), GLOSSARY.indexOf(`### ${next}`));
  return new Map(
    rows(table).flatMap(([, key = '', name = '']) => {
      const code = CODE_CELL.exec(key)?.groups?.['code'];
      return code === undefined ? [] : [[code, name.replace(SERVICE_FUNCTION, '')] as const];
    }),
  );
}

/** A label inside a sentence: its first letter in lower case, unless it opens with an acronym. */
const inSentence = (label: string): string =>
  /^[A-Z]{2}/u.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);

const lowered = (labels: ReadonlyMap<string, string>): ReadonlyMap<string, string> =>
  new Map([...labels].map(([code, label]) => [code, inSentence(label)]));

const inOrder = (codes: Iterable<string>): readonly string[] =>
  [...codes].toSorted((left, right) => left.localeCompare(right, 'en'));

describe('the words of the journal', () => {
  it('[TRV-41] [TRV-43] labels every category and every level of the journal as glossary section 4.1 does', () => {
    expect(CATEGORY_LABELS).toStrictEqual(setLabels('JournalEntryCategory'));
    expect(LEVEL_LABELS).toStrictEqual(setLabels('JournalLevel'));
    expect(inOrder(CATEGORY_LABELS.keys())).toStrictEqual(
      inOrder(journalEntries.category.enumValues),
    );
    expect(inOrder(LEVEL_LABELS.keys())).toStrictEqual(inOrder(journalEntries.level.enumValues));
    expect([
      wordsFor(CATEGORY_LABELS, 'trigger_refused'),
      wordsFor(LEVEL_LABELS, 'warning'),
    ]).toStrictEqual(['Refused trigger', 'Warning']);
  });

  it('[TRV-26] names every scheduled task and every incident kind as glossary section 9 does', () => {
    expect(TASK_NAMES).toStrictEqual(namesOf('9.1', '9.2'));
    expect(INCIDENT_NAMES).toStrictEqual(namesOf('9.2', '9.3'));
    expect(inOrder(TASK_NAMES.keys())).toStrictEqual(inOrder(taskRuns.taskKey.enumValues));
    expect(inOrder(INCIDENT_NAMES.keys())).toStrictEqual(inOrder(incidents.kind.enumValues));
  });

  it('labels every service role as the glossary does, and names each inside a sentence', () => {
    expect(SERVICE_LABELS).toStrictEqual(setLabels('ServiceRole'));
    expect(inOrder(SERVICE_WORDS.keys())).toStrictEqual(inOrder(incidents.serviceRole.enumValues));
    expect(inOrder(TRIGGER_WORDS.keys())).toStrictEqual(inOrder(taskRuns.trigger.enumValues));
  });

  it('[CL-IMP-33] [TEL-34] names the refusals, causes and notification categories by their glossary labels', () => {
    expect(BLOCKING_ERROR_WORDS).toStrictEqual(lowered(setLabels('BlockingErrorKind')));
    expect(CAUSE_WORDS).toStrictEqual(lowered(setLabels('VerdictChangeCause')));
    expect(NOTIFICATION_CATEGORY_WORDS).toStrictEqual(lowered(setLabels('NotificationCategory')));
    expect(wordsFor(BLOCKING_ERROR_WORDS, 'syntax_error')).toBe('JSON syntax error');
  });

  it('refuses, as bugs, a code that its table lacks and a table without codes', () => {
    const empty: Words<string> = new Map();

    expect(() => wordsFor(empty, 'purge')).toThrow('No words for the code purge.');
    expect(() => codesOf(empty)).toThrow('A table of words holds no code.');
  });
});
