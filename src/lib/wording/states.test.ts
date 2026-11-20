import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { label, STATUS_LABELS } from './states';

const GLOSSARY_FILE = path.join(import.meta.dirname, '../../../docs/engineering/glossary.md');

// A set's heading in glossary section 4.1: "`PlayerStatus` — JOU-15, VUE-08".
const SET_HEADING = /^`(?<name>\w+)` — /u;
// The code value of a row of a set's table: "`active`" of "| actif | `active` | Active |".
const CODE_VALUE = /^`(?<code>[a-z_]+)`$/u;

/**
 * The state that a row of a set's table shows, with its UI label, if it shows one: a
 * UI label of "—", or a note in parentheses, is none.
 */
function shownState(line: string): readonly [string, string] | undefined {
  const cells = line.split('|').map((cell) => cell.trim());
  const code = CODE_VALUE.exec(cells[2] ?? '')?.groups?.['code'];
  const uiLabel = cells[3] ?? '';
  const isShown = code !== undefined && uiLabel !== '—' && !uiLabel.startsWith('(');
  return isShown ? [code, uiLabel] : undefined;
}

/**
 * The state sets of glossary section 4.1, the sets named `…Status`, each with the UI
 * label of every state it shows; a set that shows none is left out.
 */
function glossaryStateSets(): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const text = readFileSync(GLOSSARY_FILE, 'utf8');
  const section = text.slice(text.indexOf('### 4.1'), text.indexOf('### 4.2'));
  const sets = new Map<string, Map<string, string>>();
  let current: Map<string, string> | undefined;
  for (const line of section.split('\n')) {
    const name = SET_HEADING.exec(line)?.groups?.['name'];
    if (name !== undefined) {
      current = name.endsWith('Status') ? new Map<string, string>() : undefined;
      sets.set(name, current ?? new Map<string, string>());
    }
    const state = shownState(line);
    if (current !== undefined && state !== undefined) {
      current.set(...state);
    }
  }
  return new Map([...sets].filter(([name, states]) => name.endsWith('Status') && states.size > 0));
}

/** The labels of this module, in the same shape. */
function moduleStateSets(): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const sets: Readonly<Record<string, readonly (readonly [string, string])[]>> = STATUS_LABELS;
  return new Map(Object.entries(sets).map(([name, states]) => [name, new Map(states)]));
}

describe('state labels', () => {
  it('[VUE-08] [CL-VUE-02] labels each common state of 00 with its English rendering', () => {
    const types = ['proposed', 'validated', 'rejected', 'withdrawn'] as const;
    const players = ['active', 'paused', 'withdrawn'] as const;
    const detected = ['detected', 'dismissed'] as const;
    const requests = ['to_do', 'imported', 'canceled'] as const;
    const cases = ['awaiting_game', 'measured', 'excluded', 'not_measurable'] as const;

    expect(types.map((status) => label('EventTypeStatus', status))).toStrictEqual([
      'Proposed',
      'Validated',
      'Rejected',
      'Withdrawn',
    ]);
    expect(players.map((status) => label('PlayerStatus', status))).toStrictEqual([
      'Active',
      'Paused',
      'Withdrawn',
    ]);
    expect(detected.map((status) => label('DetectedEventStatus', status))).toStrictEqual([
      'Detected',
      'Dismissed',
    ]);
    expect(requests.map((status) => label('BacktestRequestStatus', status))).toStrictEqual([
      'To do',
      'Imported',
      'Canceled',
    ]);
    expect(cases.map((status) => label('CaseStatus', status))).toStrictEqual([
      'Awaiting game',
      'Measured',
      'Excluded (doubtful case)',
      'Not measurable',
    ]);
  });

  it('[VUE-08] gives every state that glossary section 4.1 shows its UI label, and no other state one', () => {
    expect(moduleStateSets()).toStrictEqual(glossaryStateSets());
  });

  it('[VUE-08] never gives two states of one set the same label', () => {
    const shared = [...moduleStateSets()].filter(
      ([, states]) => new Set(states.values()).size !== states.size,
    );

    expect(shared).toStrictEqual([]);
  });

  it('[VUE-08] fills the placeholder of a label with the written value it is given', () => {
    expect(label('HealthStatus', 'down', { date: 'Wed 18 Nov 2026' })).toBe(
      'Down since Wed 18 Nov 2026',
    );
    expect(label('PlayerBacktestStatus', 'imported', { date: 'Tue 17 Nov 2026' })).toBe(
      'Imported on Tue 17 Nov 2026',
    );
    expect(label('PauseSuggestionStatus', 'suggested', { player: 'Player A' })).toBe(
      'Suggest pausing Player A',
    );
  });

  it('[VUE-08] refuses a placeholder left without its value', () => {
    // @ts-expect-error: the label "Down since {date}" needs its date
    expect(() => label('HealthStatus', 'down')).toThrow('needs a value for {date}');
  });

  it('[VUE-08] has no label for a state that the glossary never shows', () => {
    // @ts-expect-error: the glossary shows no label for a normal quota
    expect(() => label('QuotaStatus', 'normal')).toThrow('QuotaStatus normal has no label');
  });
});
