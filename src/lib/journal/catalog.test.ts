import { describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';
import { assertNoBettingWords } from '@/lib/wording';

import { JOURNAL_MESSAGES, messageOf } from './catalog';
import { JOURNAL_ENTRY_CATEGORIES } from './entries';
import { messageText, renderEntry } from './render';

import type { ResolvedMessage } from './catalog';
import type { ParamKind } from './message-types';
import type { ReferenceColumns } from './references';

const PARIS = 'Europe/Paris';
// One value of each kind, as a writer would give it.
const SAMPLES: Readonly<Record<ParamKind, unknown>> = {
  count: 1234,
  instant: toEpochMs(Date.UTC(2026, 10, 18, 0, 30)),
  duration: 3 * 3_600_000,
  task: 'purge',
  trigger: 'on_demand',
  service: 'stats_source',
  incident: { kind: 'quota_reached', service: 'language_model' },
  parameter: 'journal.retentionDays',
  value: 120,
  conversation: 'group',
  refusal: 'syntax_error',
  cause: 'new_cases',
  notificationCategory: 'alerts',
  code: 'suspended',
};
// Every reference of an entry, each naming something.
const LIVE: ReferenceColumns = {
  playerId: '5b0d2f8e-3c41-4f6a-9d7e-2a1c8b9e4f60',
  playerEventId: 11,
  eventTypeId: 'media-storm',
  backtestRequestId: 12,
  importId: 13,
  caseId: 14,
  incidentId: 15,
  taskRunId: 16,
  lot2ObjectKind: null,
  lot2ObjectId: null,
};
// The same entry once every item it named was erased.
const ERASED: ReferenceColumns = {
  playerId: null,
  playerEventId: null,
  eventTypeId: null,
  backtestRequestId: null,
  importId: null,
  caseId: null,
  incidentId: null,
  taskRunId: null,
  lot2ObjectKind: null,
  lot2ObjectId: null,
};

/** Sample parameters for every parameter of `message`. */
function paramsOf(message: ResolvedMessage): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(message.params ?? {}).map(([name, kind]) => [name, SAMPLES[kind]]),
  );
}

/** The text of `key` with sample parameters, naming its subject or not. */
function textOf(key: string, references: ReferenceColumns): string {
  const message = messageOf(key);
  if (message === undefined) {
    throw new Error(`No message ${key}.`);
  }
  return renderEntry({ ...references, messageKey: key, messageParams: paramsOf(message) }, PARIS)
    .text;
}

const KEYS = JOURNAL_MESSAGES.map((message) => message.key);

const inOrder = (values: Iterable<string>): readonly string[] =>
  [...values].toSorted((left, right) => left.localeCompare(right, 'en'));

describe('the closed list of journal messages', () => {
  it('[TRV-41] names each message once, by a stored snake_case key', () => {
    expect(new Set(KEYS).size).toBe(KEYS.length);
    expect(KEYS.filter((key) => !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u.test(key))).toStrictEqual([]);
  });

  it('[TRV-41] [TEL-34] [CL-TRV-25] files every message under one category of the complete closed list, and uses them all', () => {
    const used = new Set(JOURNAL_MESSAGES.map((message) => message.category));

    expect(inOrder(used)).toStrictEqual(inOrder(JOURNAL_ENTRY_CATEGORIES));
  });

  it('[TRV-43] gives each message one of the three levels: info by default, warning, or incident', () => {
    const levels = new Set(KEYS.flatMap((key) => messageOf(key)?.level ?? []));

    expect(inOrder(levels)).toStrictEqual(['incident', 'info', 'warning']);
    expect(messageOf('task_run_succeeded')?.level).toBe('info');
    expect(messageOf('trigger_refused')?.level).toBe('warning');
    expect(messageOf('login_locked')?.level).toBe('incident');
  });

  it('[TRV-42] gives every message a text that says what happened, the consequence and what to do, every placeholder filled', () => {
    const texts = KEYS.flatMap((key) => [textOf(key, LIVE), textOf(key, ERASED)]);

    expect(texts.filter((text) => /[{}]/u.test(text))).toStrictEqual([]);
    expect(texts.filter((text) => !/^\S.+\. .+\. What to do: \S.+\.$/u.test(text))).toStrictEqual(
      [],
    );
  });

  it('[VUE-02] writes no betting word in any message', () => {
    const texts = KEYS.map((key) => textOf(key, LIVE));

    expect(() => {
      for (const text of texts) {
        assertNoBettingWords(text);
      }
    }).not.toThrow();
  });

  it('writes each kind of parameter for people, an instant in the owner zone and a count with its separator', () => {
    expect(textOf('task_run_missed', LIVE)).toBe(
      'Data purge did not run in time: it was due at Wed 18 Nov 2026, 01:30. A catch-up run starts at once, and the incident "Task not run" stays open until a run succeeds. What to do: nothing if the catch-up run succeeds; if tasks keep missing their time, check the task trigger on the app status screen.',
    );
    expect(textOf('data_purged', LIVE)).toBe(
      'The data purge deleted 1,234 items past their retention. Open incidents and the entries tied to them stay. What to do: nothing.',
    );
    expect(textOf('warning_opened', LIVE)).toBe(
      'The warning "Quota reached — Language model" was given. Nothing is lost yet; it ends by itself once its cause is gone. What to do: look at it on the app status screen.',
    );
  });

  it('[CL-TRV-10] names a subject that exists, and says what became of one erased', () => {
    expect([textOf('player_paused', LIVE), textOf('player_paused', ERASED)]).toStrictEqual([
      'You paused a followed player. He stays in the followed players, and his profiles keep their cases. What to do: nothing.',
      'You paused a deleted player. He stays in the followed players, and his profiles keep their cases. What to do: nothing.',
    ]);
    expect(textOf('historical_event_corrected', ERASED)).toBe(
      'You corrected an item that no longer exists. Its case and the profiles concerned are recalculated. What to do: nothing.',
    );
  });

  it('[CL-TRV-10] writes the withdrawal of an event with no player, type or date', () => {
    expect(textOf('event_withdrawn', LIVE)).toBe(
      'An event was withdrawn. It and every trace of it are erased, and the profiles are recalculated. What to do: nothing.',
    );
  });

  it('agrees a noun with its count, one and many', () => {
    const one = {
      ...ERASED,
      messageKey: 'installation_check_failed',
      messageParams: { failedCount: 1 },
    };

    expect(renderEntry(one, PARIS).text).toMatch(
      /^The installation check found 1 service not working\./u,
    );
    expect(renderEntry({ ...one, messageParams: { failedCount: 2 } }, PARIS).text).toMatch(
      /^The installation check found 2 services not working\./u,
    );
  });

  it('shows a parameter that a damaged row holds as it is stored, rather than hiding the entry', () => {
    const damaged = { ...ERASED, messageKey: 'data_purged', messageParams: { count: 'many' } };

    expect(renderEntry(damaged, PARIS).text).toMatch(/^The data purge deleted "many" items/u);
  });

  it('refuses, as bugs, an entry of no known message and a message that names no parameter of its own', () => {
    const unknown = { ...ERASED, messageKey: 'unknown_message', messageParams: {} };
    const broken: ResolvedMessage = {
      category: 'task_pass',
      level: 'info',
      subject: 'none',
      happened: 'It deleted {count} items.',
      consequence: 'Nothing else.',
      whatToDo: 'nothing.',
    };

    expect(() => renderEntry(unknown, PARIS)).toThrow(
      'The journal holds an entry of no known message: unknown_message.',
    );
    expect(() =>
      messageText(broken, { ...ERASED, messageKey: 'data_purged', messageParams: {} }, PARIS),
    ).toThrow('A message names {count}, which is not one of its parameters.');
  });
});
