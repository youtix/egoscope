import { describe, expect, it } from 'vitest';

import { incidents, journalEntries, taskRuns } from '@/lib/db';

import {
  CATEGORY_LABELS,
  codesOf,
  INCIDENT_NAMES,
  LEVEL_LABELS,
  SERVICE_LABELS,
  SERVICE_WORDS,
  TASK_NAMES,
  TRIGGER_WORDS,
  wordsFor,
} from './labels';

import type { Words } from './labels';

const inOrder = (codes: Iterable<string>): readonly string[] =>
  [...codes].toSorted((left, right) => left.localeCompare(right, 'en'));

describe('the words of the journal', () => {
  it('[TRV-41] [TRV-43] labels every category and every level of the journal, as the glossary does', () => {
    expect(inOrder(CATEGORY_LABELS.keys())).toStrictEqual(
      inOrder(journalEntries.category.enumValues),
    );
    expect(inOrder(LEVEL_LABELS.keys())).toStrictEqual(inOrder(journalEntries.level.enumValues));
    expect([
      wordsFor(CATEGORY_LABELS, 'trigger_refused'),
      wordsFor(LEVEL_LABELS, 'warning'),
    ]).toStrictEqual(['Refused trigger', 'Warning']);
  });

  it('[TRV-26] names every scheduled task, every incident kind and every service role', () => {
    expect(inOrder(TASK_NAMES.keys())).toStrictEqual(inOrder(taskRuns.taskKey.enumValues));
    expect(inOrder(TRIGGER_WORDS.keys())).toStrictEqual(inOrder(taskRuns.trigger.enumValues));
    expect(inOrder(INCIDENT_NAMES.keys())).toStrictEqual(inOrder(incidents.kind.enumValues));
    expect(inOrder(SERVICE_WORDS.keys())).toStrictEqual(inOrder(incidents.serviceRole.enumValues));
    expect(inOrder(SERVICE_LABELS.keys())).toStrictEqual(inOrder(incidents.serviceRole.enumValues));
  });

  it('refuses, as bugs, a code that its table lacks and a table without codes', () => {
    const empty: Words<string> = new Map();

    expect(() => wordsFor(empty, 'purge')).toThrow('No words for the code purge.');
    expect(() => codesOf(empty)).toThrow('A table of words holds no code.');
  });
});
