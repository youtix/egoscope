import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  DEVIATIONS_PATH,
  readDeviations,
  REPORT_PATH,
  requirementStatus,
  runRequirementStatus,
  STATUS_PATH,
} from './requirement-status';
import { REGISTER_PATH } from './waiver-register';

const ROOT = path.join(import.meta.dirname, '..');
const SCRIPT = path.join(import.meta.dirname, 'requirement-status.ts');
const MANIFEST = z.object({ scripts: z.record(z.string(), z.string()) });
const SPEC_PATH = 'docs/01-joueurs-suivis.md';
const TEST_PATH = 'src/lib/players/add.test.ts';
const UNCITED = 'Criteria that cite';
const USAGE = 'Usage: bun scripts/requirement-status.ts [--committed]';

// JOU-01 and its criterion are tested; JOU-02 is, but not its criterion, which JOU-03
// cites too; JOU-04 is waived; only the criterion of JOU-05 is tested; JOU-06 has
// nothing; JOU-07 is tested, with a limit, and so is its criterion, written in bold.
// CA-JOU-04 names JOU-01 only inside its text, which cites nothing; CA-JOU-06 starts
// with JOU-99, which is no requirement.
const SPEC = [
  '# 01 — Joueurs suivis',
  '',
  '## Exigences',
  '',
  '- **JOU-01** [Lot 1] — Ajouter un joueur.',
  '- **JOU-02** [Lot 1] — Mettre un joueur en pause.',
  '- **JOU-03** [Lot 2] — Reprendre un joueur.',
  '- **JOU-04** [Lot 1] — Documenter les joueurs.',
  '- **JOU-05** [Lot 1] — Retirer un joueur.',
  '- **JOU-06** [Lot 2] — Renommer un joueur.',
  '- **JOU-07** [Lot 1] — Lire la réponse.',
  '',
  "## Critères d'acceptation",
  '',
  '- (JOU-01) Étant donné un ajout, alors le joueur est actif.',
  '- (JOU-02, JOU-03) Étant donné une pause, alors le joueur est en pause.',
  '- (JOU-05) Étant donné un retrait, alors le joueur est retiré.',
  '- Étant donné un ajout selon JOU-01, alors rien ne change.',
  '- **JOU-07** — Étant donné une réponse, alors elle est lue.',
  '- (JOU-99) Étant donné un joueur inconnu, alors rien ne change.',
  '',
].join('\n');

// A second spec file, whose one criterion cites its one requirement.
const SECOND_SPEC: readonly [path: string, text: string] = [
  'docs/02-taxonomie.md',
  [
    '# 02 — Taxonomie',
    '',
    '## Exigences',
    '',
    '- **TAX-01** [Lot 1] — Classer un événement.',
    '',
    "## Critères d'acceptation",
    '',
    '- (TAX-01) Étant donné un événement, alors il est classé.',
    '',
  ].join('\n'),
];

const TESTS = [
  "it('[JOU-01] [CA-JOU-01] adds a player', () => {});",
  "it('[JOU-02] pauses a player with *care* <now>', () => {});",
  "it('[CA-JOU-03] withdraws a player', () => {});",
  "it('[JOU-07] [CA-JOU-05] reads the answer', () => {});",
  '',
].join('\n');

const WAIVERS = [
  '# Requirement waivers',
  '',
  '| ID | kind | part | reason | manual check or reference |',
  '| --- | --- | --- | --- | --- |',
  '| JOU-04 | waiver | | A documentation requirement. | docs/guide/parameters.md |',
  '| JOU-07 | limit | the wording of an outside AI | Tests prove the parsing. | Read one answer. |',
  '',
].join('\n');

const DEVIATIONS = [
  '# Spec deviations register',
  '',
  '| Kind | Meaning | Example |',
  '| --- | --- | --- |',
  '| JOU-01 | three columns | not a row of the register |',
  '',
  '## 01 — Joueurs suivis',
  '',
  '| ID | What the spec says | What we do instead | Kind | Record |',
  '| --- | --- | --- | --- | --- |',
  String.raw`| JOU-06 | French. | English \| everywhere. | overridden | 0010 |`,
  '| CA-JOU-02 | Old value. | New value. | extended | 0015, 0016 |',
  '| Q-JOU-01 | Open. | Settled with the default. | settled | 0009 |',
  '',
].join('\n');

type Fixture = readonly (readonly [path: string, text: string])[];

const FILES: Fixture = [
  [SPEC_PATH, SPEC],
  [TEST_PATH, TESTS],
  [REGISTER_PATH, WAIVERS],
  [DEVIATIONS_PATH, DEVIATIONS],
  ['README.md', '# Egoscope\n'],
];

/** A repository that holds the files of `fixture`, and nothing else. */
function repositoryOf(fixture: Fixture) {
  const texts: ReadonlyMap<string, string> = new Map(fixture);
  return {
    paths: fixture.map(([file]) => file),
    read: (file: string): string => {
      const text = texts.get(file);
      if (text === undefined) {
        throw new Error(`The fixture has no ${file}.`);
      }
      return text;
    },
  };
}

const io = repositoryOf(FILES);

/** Runs the script on the fixture with `args`: its exit code, what it wrote and printed. */
async function run(args: readonly string[]) {
  const written = new Map<string, string>();
  const info: string[] = [];
  const errors: string[] = [];
  const code = await runRequirementStatus(args, {
    ...io,
    write: (file, text) => {
      written.set(file, text);
    },
    info: (line) => {
      info.push(line);
    },
    error: (line) => {
      errors.push(line);
    },
  });
  return { code, written, info, errors };
}

/** The lines of the section of `id` in `page`, from its heading to the next one. */
function section(page: string, id: string): string {
  const start = page.indexOf(`### ${id} `);
  const end = page.indexOf('\n#', start + 1);
  return (end === -1 ? page.slice(start) : page.slice(start, end)).trim();
}

describe('requirementStatus', () => {
  it('[TRV-79] marks Done a requirement whose criteria all have a test, ignoring a criterion that names it only in its text', async () => {
    const page = await requirementStatus(io);

    expect(section(page, 'JOU-01')).toBe(
      [
        '### JOU-01 — Done',
        '',
        '- JOU-01: `src/lib/players/add.test.ts:1` \\[JOU-01\\] \\[CA-JOU-01\\] adds a player',
        '- CA-JOU-01: `src/lib/players/add.test.ts:1` \\[JOU-01\\] \\[CA-JOU-01\\] adds a player',
      ].join('\n'),
    );
  });

  it('[TRV-79] marks Partial a tested requirement with a criterion that has no test, and shows the deviation of the criterion', async () => {
    const page = await requirementStatus(io);

    expect(section(page, 'JOU-02')).toBe(
      [
        '### JOU-02 — Partial',
        '',
        '- CA-JOU-02: extended in the deviations register, record 0015, 0016.',
        '- JOU-02: `src/lib/players/add.test.ts:2` \\[JOU-02\\] pauses a player with \\*care\\* \\<now\\>',
        '- CA-JOU-02: no test.',
      ].join('\n'),
    );
  });

  it('[TRV-79] marks Not done a requirement that neither it nor its criteria have a test or a waiver', async () => {
    const page = await requirementStatus(io);

    expect(section(page, 'JOU-03')).toBe(
      [
        '### JOU-03 — Not done',
        '',
        '- CA-JOU-02: extended in the deviations register, record 0015, 0016.',
        '- JOU-03: no test.',
        '- CA-JOU-02: no test.',
      ].join('\n'),
    );
  });

  it('[TRV-79] marks Partial a waived requirement, with the reason and reference of its waiver', async () => {
    const page = await requirementStatus(io);

    expect(section(page, 'JOU-04')).toBe(
      [
        '### JOU-04 — Partial',
        '',
        '- JOU-04: waived. A documentation requirement. Reference: docs/guide/parameters.md',
      ].join('\n'),
    );
  });

  it('[TRV-79] marks Partial a requirement that only one of its criteria tests', async () => {
    const page = await requirementStatus(io);

    expect(section(page, 'JOU-05')).toBe(
      [
        '### JOU-05 — Partial',
        '',
        '- JOU-05: no test.',
        '- CA-JOU-03: `src/lib/players/add.test.ts:3` \\[CA-JOU-03\\] withdraws a player',
      ].join('\n'),
    );
  });

  it('[TRV-79] shows a requirement that the deviations register changes, with its kind and record', async () => {
    const page = await requirementStatus(io);

    expect(section(page, 'JOU-06')).toBe(
      [
        '### JOU-06 — Not done',
        '',
        '- JOU-06: overridden in the deviations register, record 0010.',
        '- JOU-06: no test.',
      ].join('\n'),
    );
  });

  it('[TRV-79] keeps Done a tested requirement with a limit, and gives its manual check', async () => {
    const page = await requirementStatus(io);

    expect(section(page, 'JOU-07')).toBe(
      [
        '### JOU-07 — Done',
        '',
        '- JOU-07: limit on the wording of an outside AI. Tests prove the parsing. Checked by hand: Read one answer.',
        '- JOU-07: `src/lib/players/add.test.ts:4` \\[JOU-07\\] \\[CA-JOU-05\\] reads the answer',
        '- CA-JOU-05: `src/lib/players/add.test.ts:4` \\[JOU-07\\] \\[CA-JOU-05\\] reads the answer',
      ].join('\n'),
    );
  });

  it('[TRV-79] gives a status to every requirement ID of the specs, by spec file, and counts them by lot', async () => {
    const page = await requirementStatus(io);

    expect(page.match(/^### .+$/gmu)).toStrictEqual([
      '### JOU-01 — Done',
      '### JOU-02 — Partial',
      '### JOU-03 — Not done',
      '### JOU-04 — Partial',
      '### JOU-05 — Partial',
      '### JOU-06 — Not done',
      '### JOU-07 — Done',
      '### Criteria that cite no requirement',
    ]);
    expect(page).toContain(
      [
        '| Lot   | Done | Partial | Not done |',
        '| ----- | ---- | ------- | -------- |',
        '| Lot 1 | 2    | 3       | 0        |',
        '| Lot 2 | 0    | 0       | 2        |',
        '',
        '## [01-joueurs-suivis.md](../01-joueurs-suivis.md)',
      ].join('\n'),
    );
    expect(page.startsWith('# Requirement status\n\n')).toBe(true);
  });
});

describe('the criteria that cite no requirement', () => {
  it('[TRV-79] lists under their spec file, after its requirements, the criteria whose text starts with no requirement', async () => {
    const page = await requirementStatus(io);

    expect(section(page, UNCITED)).toBe(
      [
        '### Criteria that cite no requirement',
        '',
        '- CA-JOU-04: no test.',
        '- CA-JOU-06: no test.',
      ].join('\n'),
    );
    expect(page.indexOf('### JOU-07 ')).toBeLessThan(page.indexOf(`### ${UNCITED}`));
  });

  it('[TRV-79] lists such a criterion with the test that names it', async () => {
    const keep = "it('[CA-JOU-04] keeps the player', () => {});\n";
    const page = await requirementStatus(
      repositoryOf([...FILES, ['src/lib/players/keep.test.ts', keep]]),
    );

    expect(section(page, UNCITED)).toBe(
      [
        '### Criteria that cite no requirement',
        '',
        '- CA-JOU-04: `src/lib/players/keep.test.ts:1` \\[CA-JOU-04\\] keeps the player',
        '- CA-JOU-06: no test.',
      ].join('\n'),
    );
    expect(section(page, 'JOU-01')).toContain('### JOU-01 — Done');
  });

  it('[TRV-79] gives no such heading to a spec file whose criteria all cite a requirement', async () => {
    const page = await requirementStatus(repositoryOf([...FILES, SECOND_SPEC]));
    const second = page.slice(page.indexOf('## [02-taxonomie.md]'));

    expect(page.match(/^### Criteria that cite no requirement$/gmu)).toHaveLength(1);
    expect(page.indexOf(`### ${UNCITED}`)).toBeLessThan(page.indexOf('## [02-taxonomie.md]'));
    expect(second.trim()).toBe(
      [
        '## [02-taxonomie.md](../02-taxonomie.md)',
        '',
        '### TAX-01 — Not done',
        '',
        '- TAX-01: no test.',
        '- CA-TAX-01: no test.',
      ].join('\n'),
    );
  });
});

describe('readDeviations', () => {
  it('[TRV-79] reads the rows of the register tables, their escaped pipes restored, and nothing else', () => {
    expect(readDeviations(DEVIATIONS)).toStrictEqual([
      { id: 'JOU-06', kind: 'overridden', record: '0010' },
      { id: 'CA-JOU-02', kind: 'extended', record: '0015, 0016' },
      { id: 'Q-JOU-01', kind: 'settled', record: '0009' },
    ]);
  });
});

/**
 * The exit code of `git check-ignore --quiet` for `file` in the repository: 0 when git
 * ignores it, 1 when it does not. git reads neither the machine's nor the user's settings.
 */
function checkIgnore(file: string): number | null {
  return spawnSync('git', ['check-ignore', '--quiet', file], {
    cwd: ROOT,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  }).status;
}

describe('runRequirementStatus', () => {
  it('[TRV-79] writes the page to reports/requirement-status.md without a flag, and nothing under docs/', async () => {
    const { code, written, info, errors } = await run([]);

    expect(code).toBe(0);
    expect(written).toStrictEqual(
      new Map([['reports/requirement-status.md', await requirementStatus(io)]]),
    );
    expect(info).toStrictEqual(['Wrote reports/requirement-status.md.']);
    expect(errors).toStrictEqual([]);
  });

  it('[TRV-79] writes the page to docs/guide/requirement-status.md with --committed, with the same text and links, and says so', async () => {
    const report = await run([]);
    const { code, written, info } = await run(['--committed']);
    const page = written.get(STATUS_PATH);

    expect(code).toBe(0);
    expect(info).toStrictEqual(['Wrote docs/guide/requirement-status.md.']);
    expect(written).toStrictEqual(
      new Map([['docs/guide/requirement-status.md', report.written.get(REPORT_PATH)]]),
    );
    expect(page).toContain('[waiver register](../engineering/requirement-waivers.md)');
    expect(page).toContain('## [01-joueurs-suivis.md](../01-joueurs-suivis.md)');
  });

  it.each([
    ['a misspelled flag', ['--commited']],
    ['the flag without its dashes', ['committed']],
    ['the flag beside another argument', ['--committed', '--strict']],
  ])(
    '[TRV-79] refuses %s with exit code 2 and the usage line, and writes nothing',
    async (_case, args) => {
      const { code, written, info, errors } = await run(args);

      expect(code).toBe(2);
      expect(written.size).toBe(0);
      expect(info).toStrictEqual([]);
      expect(errors).toStrictEqual([`Unexpected arguments: ${args.join(' ')}\n${USAGE}`]);
    },
  );

  // It starts bun, which a busy machine can slow down past the default timeout.
  it(
    '[TRV-79] exits with code 2 from the command line on an unknown argument',
    { timeout: 30_000 },
    () => {
      const result = spawnSync('bun', [SCRIPT, '--commited'], {
        cwd: ROOT,
        encoding: 'utf8',
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain(`Unexpected arguments: --commited\n${USAGE}`);
    },
  );

  it('[TRV-79] has the scripts docs:status and docs:parameters, which docs:generate runs without --committed', () => {
    const manifest = readFileSync(path.join(ROOT, 'package.json'), 'utf8');
    const { scripts } = MANIFEST.parse(JSON.parse(manifest));

    expect(Object.entries(scripts).filter(([name]) => name.startsWith('docs:'))).toStrictEqual([
      ['docs:generate', 'bun run docs:status && bun run docs:parameters'],
      ['docs:status', 'bun scripts/requirement-status.ts'],
      ['docs:parameters', 'bun --no-env-file --conditions=react-server scripts/parameters-doc.ts'],
    ]);
  });

  it('[TRV-79] writes by default where git ignores the page, so that no run leaves a page to commit under docs/', () => {
    expect(checkIgnore(REPORT_PATH)).toBe(0);
    expect(checkIgnore(STATUS_PATH)).toBe(1);
  });
});
