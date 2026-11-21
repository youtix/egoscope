import { describe, expect, it } from 'vitest';

import { criteriaIndex, INDEX_PATH } from './criteria-index';
import { readSpecIds } from './spec-ids';
import { findTitleTags, isTestFile } from './test-titles';
import { REPORT_PATH } from './trace-report';
import { claimedIds, runTrace, systemIo } from './trace-requirements';
import { REGISTER_PATH } from './waiver-register';

import type { TraceIo } from './trace-requirements';

const PLAYERS = 'docs/01-joueurs-suivis.md';
const TEST = 'src/lib/players/cap.test.ts';
const SPECS: Readonly<Record<string, string>> = {
  [PLAYERS]: [
    '# 01 — Joueurs suivis',
    '',
    '## Règles de gestion',
    '',
    '- **JOU-04** [Lot 1] — Le nombre de joueurs actifs est plafonné.',
    '- **JOU-05** [Lot 1] — Un message explique le refus.',
    '',
    "## Critères d'acceptation",
    '',
    '1. (JOU-04, JOU-05) Étant donné 30 joueurs actifs, quand un 31e est ajouté, alors il est refusé.',
    '2. (JOU-04) Étant donné 30 joueurs actifs dont un en pause, quand un joueur est ajouté, alors il est accepté.',
    '',
  ].join('\n'),
  'docs/90-journal-des-decisions.md': "- **H-13 — Formule de l'indicateur.** Le Game Score.\n",
};
const SPEC_FILES = Object.entries(SPECS).map(([path, text]) => ({ path, text }));
// They define IDs of the prefixes JOU, CA and H only.
const SPEC_IDS = readSpecIds(SPEC_FILES);
const INDEX = await criteriaIndex(SPEC_IDS.criteria);
// The most characters that GitHub accepts in a pull request body.
const BODY_LIMIT = 65_536;
// What the claims of the longest body must be read in: one linear scan takes a few
// milliseconds, while removing nested comments until none is left takes minutes.
const WELL_UNDER_A_SECOND = 250;
// A comment nested in the text around it: `<!-<!-- x -->- -->`.
const NESTED_OPEN = '<!-';
const NESTED_CLOSE = '- -->';
const UNCLOSED = '<!--';
// Capitals chained with hyphens and no number: `A-A-A-`.
const CHAIN_LINK = 'A-';
// Reading every test title of the repository takes 1 to 1.5 seconds locally and 3 to 3.5
// seconds on an idle CI runner, grows with the repository, and a busy machine slows it
// past Vitest's default of 5 seconds.
const REPOSITORY_TIMEOUT_MS = 30_000;

/** The waiver register, with these rows in its table. */
const register = (...rows: readonly string[]): string =>
  [
    '# Requirement waivers',
    '',
    '| ID | kind | part | reason | manual check or reference |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');

/** A test file whose one test has this title. */
const testOf = (title: string): string => `it('${title}', () => {});\n`;

/** A pull request body that lists `claims` under "Requirements covered". */
const body = (claims: string): string =>
  ['## Summary', '', 'Adds the cap.', '', '## Requirements covered', '', claims, ''].join('\r\n');

/** The IDs that a body claims whose section holds these lines. */
const claimsOf = (lines: readonly string[]): readonly string[] | undefined =>
  claimedIds(body(lines.join('\r\n')), SPEC_IDS);

type Run = Readonly<{
  code: number;
  info: readonly string[];
  errors: readonly string[];
  written: ReadonlyMap<string, string>;
}>;

/**
 * Runs the check on a repository of the specs above, an up-to-date index and an empty
 * register, changed by `files`, where `undefined` removes a file.
 */
async function run(
  args: readonly string[],
  files: Readonly<Record<string, string | undefined>> = {},
  input = '',
): Promise<Run> {
  const repository: Readonly<Record<string, string | undefined>> = {
    ...SPECS,
    [REGISTER_PATH]: register(),
    [INDEX_PATH]: INDEX,
    ...files,
  };
  const info: string[] = [];
  const errors: string[] = [];
  const written = new Map<string, string>();
  const io: TraceIo = {
    paths: Object.keys(repository).filter((file) => repository[file] !== undefined),
    read: (file) => repository[file] ?? '',
    write: (file, text) => {
      written.set(file, text);
    },
    input: () => input,
    info: (line) => {
      info.push(line);
    },
    error: (line) => {
      errors.push(line);
    },
  };
  return { code: await runTrace(args, io), info, errors, written };
}

describe('runTrace', () => {
  it('passes when every title ID exists, the register holds and the index is up to date', async () => {
    const result = await run([], {
      [TEST]: testOf('[JOU-04] [H-13] refuses a 31st active player'),
    });

    expect(result.code).toBe(0);
    expect(result.errors).toStrictEqual([]);
    expect(result.info.at(-1)).toBe('Requirement traceability passed.');
    expect(result.written.get(REPORT_PATH)).toContain(
      '| JOU-04 | 01-joueurs-suivis.md | covered |',
    );
  });

  it('fails on a test title that cites an ID the specs do not define', async () => {
    const result = await run([], { [TEST]: testOf('[JOU-4] refuses a 31st active player') });

    expect(result.code).toBe(1);
    expect(result.errors).toStrictEqual([
      `${TEST}:1: [JOU-4] is not an ID that the specs define: check it against the spec, or against docs/engineering/acceptance-criteria-index.md for a criterion.`,
      '\nRequirement traceability failed: 1 problem(s).',
    ]);
  });

  it('fails on a register entry for an unknown ID, of an unknown kind, or repeated', async () => {
    const result = await run([], {
      [REGISTER_PATH]: register(
        '| JOU-99 | waiver | | A reason. | A reference. |',
        '| JOU-04 | exemption | | A reason. | A reference. |',
        '| JOU-05 | waiver | | A reason. | A reference. |',
        '| JOU-05 | waiver | | A reason. | A reference. |',
      ),
    });

    expect(result.code).toBe(1);
    expect(result.errors.slice(0, -1)).toStrictEqual([
      `${REGISTER_PATH}:6: JOU-04 has the unknown kind "exemption": an entry is a waiver or a limit.`,
      `${REGISTER_PATH}:8: JOU-05 has two entries; the first is at ${REGISTER_PATH}:7.`,
      `${REGISTER_PATH}:5: JOU-99 is not a requirement or an acceptance criterion of the specs: the register lists only those.`,
    ]);
  });

  it('refuses a waiver beside a test', async () => {
    const result = await run([], {
      [TEST]: testOf('[JOU-04] refuses a 31st active player'),
      [REGISTER_PATH]: register('| JOU-04 | waiver | | A reason. | A reference. |'),
    });

    expect(result.code).toBe(1);
    expect(result.errors[0]).toBe(
      `${REGISTER_PATH}:5: JOU-04 has a waiver and a test (${TEST}:1): a waived ID has no test, so drop the waiver, or make it a limit.`,
    );
  });

  it('accepts a limit beside a test, for an ID that the pull request claims', async () => {
    const result = await run(
      ['--require-claimed'],
      {
        [TEST]: testOf('[JOU-05] explains the refusal'),
        [REGISTER_PATH]: register(
          '| JOU-05 | limit | Its wording | Written by an outside AI. | Guide, step 6 |',
        ),
      },
      body('| JOU-05 | The test of the refusal |'),
    );

    expect(result.code).toBe(0);
    expect(result.info).toContain('  JOU-05, Its wording: Guide, step 6');
    expect(result.info).toContain(`  JOU-05: covered by ${TEST}:1`);
  });

  it('fails when the pull request claims an ID that no test names and no waiver covers', async () => {
    const result = await run(
      ['--require-claimed'],
      { [TEST]: testOf('[JOU-04] refuses a 31st active player') },
      body('| JOU-04, CA-JOU-01 | The cap test |\r\n| H-13 | Cited only |'),
    );

    expect(result.code).toBe(1);
    expect(result.errors.slice(0, -1)).toStrictEqual([
      `${PLAYERS}:10: CA-JOU-01 is required, but no test names it and the register does not waive it.`,
    ]);
  });

  it('passes a pull request that claims no ID', async () => {
    const result = await run(['--require-claimed', '--author=contributor'], {}, body('None.'));

    expect(result.code).toBe(0);
    expect(result.errors).toStrictEqual([]);
  });

  it('fails a description without the "Requirements covered" heading, unless the dependency-update bot opened the pull request', async () => {
    // GitHub shows no heading inside a comment, here over three lines as the template writes
    // them, a reworded heading is another one, and the bot's name in the text exempts
    // nothing: only the author does.
    const description = [
      '## Summary',
      '',
      'Bumps a dependency, as dependabot[bot] does.',
      '',
      '<!--',
      '## Requirements covered',
      '-->',
      '',
      '## Requirements covered (Lot 1)',
      '',
      '- JOU-05',
      '',
    ].join('\r\n');
    const contributor = await run(['--require-claimed', '--author=contributor'], {}, description);
    const unnamed = await run(['--require-claimed'], {}, description);
    const bot = await run(['--require-claimed', '--author=dependabot[bot]'], {}, description);

    expect(contributor.errors).toStrictEqual([
      'Pull request: The description has no "Requirements covered" heading outside comments, so it claims nothing: add `## Requirements covered`, then list below it the requirements and criteria that the pull request covers, or write "None" for tooling only.',
      '\nRequirement traceability failed: 1 problem(s).',
    ]);
    expect(unnamed.errors).toStrictEqual(contributor.errors);
    expect([contributor.code, unnamed.code, bot.code]).toStrictEqual([1, 1, 0]);
    expect(bot.errors).toStrictEqual([]);
  });

  it('fails on a claim in underscores that no test names, as Prettier writes emphasis', async () => {
    const result = await run(
      ['--require-claimed'],
      { [TEST]: testOf('[JOU-04] refuses a 31st active player') },
      body('| _JOU-04_, _JOU-05_ | The cap test |'),
    );

    expect(result.code).toBe(1);
    expect(result.errors.slice(0, -1)).toStrictEqual([
      `${PLAYERS}:6: JOU-05 is required, but no test names it and the register does not waive it.`,
    ]);
  });

  it('requires only the real ID of a section that also names UTF-8, SHA-256, AES-256 and HMAC-SHA-256', async () => {
    const result = await run(
      ['--require-claimed'],
      { [TEST]: testOf('[JOU-04] refuses a 31st active player') },
      body(
        '| JOU-04 | Decodes UTF-8 input, checks its SHA-256 digest, encrypts with AES-256 and signs with HMAC-SHA-256 |',
      ),
    );

    expect(result.code).toBe(0);
    expect(result.errors).toStrictEqual([]);
    expect(
      result.info.slice(
        result.info.indexOf('Required by name:'),
        result.info.indexOf(`Full report: ${REPORT_PATH}`),
      ),
    ).toStrictEqual(['Required by name:', `  JOU-04: covered by ${TEST}:1`]);
  });

  it('fails on a claimed typo of a known prefix, such as JOU-4, JOU-999, CA-JOU-99 or CA-JUO-02', async () => {
    const result = await run(
      ['--require-claimed'],
      {},
      body('| JOU-4, JOU-999, CA-JOU-99, CA-JUO-02 | The cap test, on UTF-8 input |'),
    );

    expect(result.code).toBe(1);
    expect(result.errors.slice(0, -1)).toStrictEqual([
      'Required IDs: JOU-4 is required, but the specs define no such ID.',
      'Required IDs: JOU-999 is required, but the specs define no such ID.',
      'Required IDs: CA-JOU-99 is required, but the specs define no such ID.',
      'Required IDs: CA-JUO-02 is required, but the specs define no such ID.',
    ]);
  });

  it('fails on a bracketed ID after the start of a title, where it cites nothing', async () => {
    const result = await run([], { [TEST]: testOf('refuses a 31st player [JOU-4]') });

    expect(result.code).toBe(1);
    expect(result.errors.slice(0, -1)).toStrictEqual([
      `${TEST}:1: JOU-4 cites nothing there: IDs go in the square brackets that a title starts with, one per pair, as in it('[JOU-04] [CA-JOU-02] refuses a 31st active player', …).`,
    ]);
  });

  it('passes a title that names UTF-8 and SHA-256 after its brackets, bracketed or not', async () => {
    const result = await run([], {
      [TEST]: testOf('[JOU-04] [H-13] stores UTF-8 names with their [SHA-256] digest'),
    });

    expect(result.code).toBe(0);
    expect(result.errors).toStrictEqual([]);
    expect(result.written.get(REPORT_PATH)).toContain(
      `| JOU-04 | 01-joueurs-suivis.md | covered | ${TEST}:1 [JOU-04] [H-13] stores UTF-8 names with their [SHA-256] digest |`,
    );
  });

  it('requires the IDs that --require lists, separated by commas or spaces', async () => {
    const result = await run(['--require', 'JOU-04, CA-JOU-02', '--require', 'JOU-05'], {
      [TEST]: testOf('[JOU-04] [CA-JOU-02] refuses a 31st active player'),
    });

    expect(result.code).toBe(1);
    expect(result.errors.slice(0, -1)).toStrictEqual([
      `${PLAYERS}:6: JOU-05 is required, but no test names it and the register does not waive it.`,
    ]);
  });

  it('requires every requirement and criterion with --strict', async () => {
    const tests = { [TEST]: testOf('[JOU-04] [JOU-05] [CA-JOU-01] refuses a 31st active player') };
    const waived = register('| CA-JOU-02 | waiver | | A reason. | A reference. |');
    const open = await run(['--strict'], tests);
    const complete = await run(['--strict'], { ...tests, [REGISTER_PATH]: waived });

    expect(open.errors.slice(0, -1)).toStrictEqual([
      `${PLAYERS}:11: CA-JOU-02 is required, but no test names it and the register does not waive it.`,
    ]);
    expect(complete.code).toBe(0);
  });

  it('fails when the criteria index differs from the specs, and rewrites it with --write-index', async () => {
    const stale = await run([], {
      [INDEX_PATH]: INDEX.replace('Étant donné 30', 'Étant donné 31'),
    });
    const rewritten = await run(['--write-index'], { [INDEX_PATH]: '' });

    expect(stale.errors[0]).toBe(
      `${INDEX_PATH}: The acceptance criteria index does not match the specs: run \`bun run trace --write-index\`, then commit the file.`,
    );
    expect(rewritten.code).toBe(0);
    expect(rewritten.written.get(INDEX_PATH)).toBe(INDEX);
  });

  it('fails without the waiver register', async () => {
    const result = await run([], { [REGISTER_PATH]: undefined });

    expect(result.code).toBe(1);
    expect(result.errors[0]).toBe(`${REGISTER_PATH}: The waiver register is missing.`);
  });

  it('refuses an unknown option with exit code 2 and the usage', async () => {
    const result = await run(['--relaxed']);

    expect(result.code).toBe(2);
    expect(result.errors[0]).toMatch(/--relaxed[\s\S]*Usage: bun scripts\/trace-requirements\.ts/u);
  });
});

describe('claimedIds', () => {
  it('reads every ID of a known prefix in the "Requirements covered" section, outside comments', () => {
    const description = [
      '## Requirements covered',
      '',
      '<!-- Cite them as the specs write them (JOU-04, CA-TRV-12). -->',
      '',
      '| Requirement | Verified by |',
      '| --- | --- |',
      '| JOU-05, `CA-JOU-01` | [JOU-05] [CA-JOU-01] explains the refusal |',
      '| H-13 | The Game Score test |',
      '',
      '## Notes for the reviewer',
      '',
      'TRV-64 is untouched.',
    ].join('\r\n');

    expect(claimedIds(description, SPEC_IDS)).toStrictEqual(['JOU-05', 'CA-JOU-01', 'H-13']);
  });

  it('reads the comments in one scan, as GitHub does, so the text around a comment never joins into a new one', () => {
    // Each line holds one comment, `<!-- x -->`: GitHub shows the rest, `<!-- JOU-04 -->`
    // and `<!-<!-- -->- JOU-05 -->`, as text.
    const description = body(
      ['<!-<!-- x -->- JOU-04 -->', '<!-<!-<!-- x -->- -->- JOU-05 -->', '- H-13'].join('\r\n'),
    );

    expect(claimedIds(description, SPEC_IDS)).toStrictEqual(['JOU-04', 'JOU-05', 'H-13']);
  });

  it('hides the rest of the body after an unclosed comment that starts a line, and reads one inside a line as text, as GitHub does', () => {
    expect(claimsOf(['- JOU-04', '<!-- unclosed', '- JOU-05'])).toStrictEqual(['JOU-04']);
    expect(
      claimsOf(['- JOU-04', '   <!-- unclosed, after three spaces', '- JOU-05']),
    ).toStrictEqual(['JOU-04']);
    expect(claimsOf(['- JOU-04 <!-- unclosed, inside a line', '- JOU-05'])).toStrictEqual([
      'JOU-04',
      'JOU-05',
    ]);
    expect(
      claimsOf(['JOU-04', '', '    <!-- unclosed, in an indented code block', '', 'JOU-05']),
    ).toStrictEqual(['JOU-04', 'JOU-05']);
    expect(
      claimsOf([
        '- JOU-04 <!-- unclosed, inside a line',
        '<!-- then at the start of one',
        '- JOU-05',
      ]),
    ).toStrictEqual(['JOU-04']);
  });

  it('hides the whole body after an unclosed comment that opens it, and nothing after <!--> or <!--->, as GitHub does', () => {
    // GitHub shows nothing of the first body, not even its heading, while `<!-->` and
    // `<!--->` are whole comments.
    expect(claimedIds(`<!-- unclosed\r\n${body('- JOU-04')}`, SPEC_IDS)).toBeUndefined();
    expect(claimsOf(['<!--> JOU-04', '<!---> JOU-05'])).toStrictEqual(['JOU-04', 'JOU-05']);
  });

  it(
    'reads a crafted body of 64 KB in well under a second',
    { timeout: WELL_UNDER_A_SECOND },
    () => {
      // A third nests comments in the text around them, which a removal repeated until
      // nothing changes undoes one level per pass. A third opens comments inside a line that
      // never close, after each of which a search for its end reads to the end of the body.
      // A third chains capitals with hyphens and no number, the rest of which a search for an
      // ID reads again from each capital.
      const third = BODY_LIMIT / 3;
      const levels = Math.ceil(third / (NESTED_OPEN.length + NESTED_CLOSE.length));
      const nested = `${NESTED_OPEN.repeat(levels)}<!-- x -->${NESTED_CLOSE.repeat(levels)}`;
      const unclosed = `- JOU-04 ${UNCLOSED.repeat(Math.ceil(third / UNCLOSED.length))}`;
      const chain = CHAIN_LINK.repeat(Math.ceil(third / CHAIN_LINK.length));
      const description = body([nested, unclosed, chain].join('\r\n'));

      expect(description.length).toBeGreaterThan(BODY_LIMIT);
      expect(claimedIds(description, SPEC_IDS)).toStrictEqual(['JOU-04']);
    },
  );

  it('finds no section without its heading, and no ID in a section that says None', () => {
    const tooling = '## Summary\n\nTooling only, JOU-04 untouched.\n';

    expect(claimedIds(tooling, SPEC_IDS)).toBeUndefined();
    expect(claimedIds(body('None.'), SPEC_IDS)).toStrictEqual([]);
  });

  it('reads an ID that emphasis or punctuation touches, and none that a letter or digit touches', () => {
    // The claims hold each ID once, so each token that a letter or digit touches holds an
    // ID that no other token gives: read by mistake, it would show.
    const description = body(
      '_JOU-04_, *JOU-05*, (H-13); not xJOU-06, JOU-07x, 9JOU-08, JOU-09é or éH-14',
    );

    expect(claimedIds(description, SPEC_IDS)).toStrictEqual(['JOU-04', 'JOU-05', 'H-13']);
  });

  it('keeps a subsection inside the section', () => {
    expect(
      claimedIds(body('### Lot 1\r\n\r\n- JOU-04\r\n\r\n### Lot 2\r\n\r\n- JOU-05'), SPEC_IDS),
    ).toStrictEqual(['JOU-04', 'JOU-05']);
  });

  it('claims the real ID only, beside UTF-8, SHA-256, AES-256 and HMAC-SHA-256', () => {
    const description = body(
      '| JOU-04 | [JOU-04] decodes UTF-8 input, checks its SHA-256 digest, encrypts with AES-256 and signs with HMAC-SHA-256 |',
    );

    expect(claimedIds(description, SPEC_IDS)).toStrictEqual(['JOU-04']);
  });

  it('claims a token only when the specs or the rulings define an ID of its prefix, typos included', () => {
    const description = body('JOU-4, CA-JOU-99, H-99, COL-01 and CL-JOU-01, on UTF-8 input');
    // The same specs, with a requirement of prefix COL and a ruling.
    const more = readSpecIds([
      ...SPEC_FILES,
      { path: 'docs/03-collecte-des-actualites.md', text: '- **COL-01** [Lot 1] — Une source.\n' },
      {
        path: 'docs/engineering/clarifications/01-tracked-players.md',
        text: '### CL-JOU-01 — The cap\n',
      },
    ]);

    expect(claimedIds(description, SPEC_IDS)).toStrictEqual(['JOU-4', 'CA-JOU-99', 'H-99']);
    expect(claimedIds(description, more)).toStrictEqual([
      'JOU-4',
      'CA-JOU-99',
      'H-99',
      'COL-01',
      'CL-JOU-01',
    ]);
  });
});

describe('runTrace on the repository', () => {
  it(
    'passes the typo guard on the test titles of the repository, STA-11 and H-13 included',
    { timeout: REPOSITORY_TIMEOUT_MS },
    async () => {
      const lines: string[] = [];
      const io: TraceIo = {
        ...systemIo(),
        write: () => undefined,
        info: (line) => {
          lines.push(line);
        },
        error: (line) => {
          lines.push(line);
        },
      };
      const cited = io.paths
        .filter((file) => isTestFile(file))
        .flatMap((file) => findTitleTags(file, io.read(file)).cited.map((tag) => tag.id));

      const code = await runTrace([], io);

      expect(cited).toStrictEqual(expect.arrayContaining(['STA-11', 'H-13']));
      expect(lines).toContain('Requirement traceability passed.');
      expect(code).toBe(0);
    },
  );
});
