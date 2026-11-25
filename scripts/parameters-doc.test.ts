import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { DATABASE_TEST_TIMEOUT_MS } from '@/lib/testing';

import { PARAMETERS_PATH, parametersDoc, parametersPage, registryRows } from './parameters-doc';

import type { EntryFacts, RegistryRow } from '@/lib/params';

const FACTS: EntryFacts = {
  label: 'Maximum active players',
  sentence: 'How many followed players can be active at once.',
  unit: 'active players',
  allowed: '1 to 100 active players',
  file: '01',
  requirement: 'JOU-04',
  source: 'H-JOU-01',
  origin: 'local_hypothesis',
  affectsCalculations: false,
  movesSchedule: false,
  lot: 1,
  engineeringBounds: false,
  editedOn: null,
};

const MAXIMUM: RegistryRow = {
  ...FACTS,
  key: 'players.maxActive',
  setting: {
    value: 30,
    written: '30 active players',
    defaultValue: 30,
    defaultWritten: '30 active players',
    version: 0,
    lastChangedAt: null,
  },
};

// A changed value: the page shows the default, never the value in force.
const MINIMUM: RegistryRow = {
  ...FACTS,
  key: 'players.indicativeMin',
  label: 'Minimum games of a season',
  sentence: 'Below this number of games, a season counts as short.',
  unit: 'games',
  allowed: '0 to 82 games',
  file: '07',
  requirement: 'STA-11',
  source: 'H-03',
  origin: 'journal_hypothesis',
  lot: 2,
  setting: {
    value: 25,
    written: '25 games',
    defaultValue: 20,
    defaultWritten: '20 games',
    version: 3,
    lastChangedAt: null,
  },
};

// An entry that holds no value of its own, such as the per-type criterion switch.
const SWITCH: RegistryRow = {
  ...FACTS,
  key: 'taxonomy.switchedOffCriterion',
  label: 'Criterion switched off',
  sentence: 'The doubtful-case criterion that one event type ignores.',
  unit: 'one doubtful-case criterion of a type',
  allowed: 'at most one criterion',
  file: '02',
  requirement: 'TAX-01',
  source: 'ADR 0016',
  origin: 'journal_decision',
  setting: null,
};

const SPEC_FILES = [
  'docs/01-joueurs-suivis.md',
  'docs/02-taxonomie-des-evenements.md',
  'docs/07-statistiques-de-match.md',
  'docs/90-journal-des-decisions.md',
  'docs/README.md',
];

/** The page from its first spec file heading on, past the introduction. */
const sections = (page: string): string => page.slice(page.indexOf('\n## ') + 1);

describe('parametersPage', () => {
  it('[TRV-79] writes each parameter with its default, unit, bounds, owning file, requirement and origin, by spec file', async () => {
    const page = await parametersPage([MAXIMUM, MINIMUM, SWITCH], SPEC_FILES);

    expect(sections(page)).toBe(
      [
        '## [01-joueurs-suivis.md](../01-joueurs-suivis.md)',
        '',
        '### Maximum active players',
        '',
        'How many followed players can be active at once.',
        '',
        '- Key: `players.maxActive`',
        '- Default: 30 active players',
        '- Unit: active players',
        '- Allowed values: 1 to 100 active players',
        '- Requirement: JOU-04',
        '- Origin: Local hypothesis, to be confirmed (H-JOU-01)',
        '- Lot: 1',
        '',
        '## [02-taxonomie-des-evenements.md](../02-taxonomie-des-evenements.md)',
        '',
        '### Criterion switched off',
        '',
        'The doubtful-case criterion that one event type ignores.',
        '',
        '- Key: `taxonomy.switchedOffCriterion`',
        '- Default: None',
        '- Unit: one doubtful-case criterion of a type',
        '- Allowed values: at most one criterion',
        '- Requirement: TAX-01',
        '- Origin: Decision (ADR 0016)',
        '- Lot: 1',
        '',
        '## [07-statistiques-de-match.md](../07-statistiques-de-match.md)',
        '',
        '### Minimum games of a season',
        '',
        'Below this number of games, a season counts as short.',
        '',
        '- Key: `players.indicativeMin`',
        '- Default: 20 games',
        '- Unit: games',
        '- Allowed values: 0 to 82 games',
        '- Requirement: STA-11',
        '- Origin: Hypothesis (H-03)',
        '- Lot: 2',
        '',
      ].join('\n'),
    );
  });

  it('[TRV-79] keeps the order of the registry inside a spec file', async () => {
    const page = await parametersPage([SWITCH, { ...MINIMUM, file: '02' }], SPEC_FILES);

    expect(page.indexOf('### Criterion switched off')).toBeLessThan(
      page.indexOf('### Minimum games of a season'),
    );
    expect(page).not.toContain('07-statistiques-de-match.md');
  });

  it('[TRV-79] starts with the title and says that the page is generated', async () => {
    const page = await parametersPage([MAXIMUM], SPEC_FILES);

    expect(page.startsWith('# Parameters\n\n')).toBe(true);
    expect(page).toContain('`bun run docs:generate` writes it from the');
  });

  it('refuses a parameter whose spec file the repository does not hold, a bug of the registry', async () => {
    await expect(parametersPage([MAXIMUM], ['docs/07-statistiques-de-match.md'])).rejects.toThrow(
      'No spec file has the number 01.',
    );
  });
});

describe('the committed parameter list', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  it('[TRV-79] lists every parameter of the registry, Lot 2 included', async () => {
    const rows = await registryRows();
    const page = await parametersDoc();

    expect(rows.some((row) => row.lot === 2)).toBe(true);
    expect(page.match(/^### /gmu)).toHaveLength(rows.length);
    for (const row of rows) {
      expect(page).toContain(`- Key: \`${row.key}\``);
    }
  });

  it('[TRV-79] docs/guide/parameters.md matches the registry', async () => {
    expect(
      readFileSync(PARAMETERS_PATH, 'utf8'),
      'docs/guide/parameters.md is stale: run `bun run docs:generate`, then commit it.',
    ).toBe(await parametersDoc());
  });
});
