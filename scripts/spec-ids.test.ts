import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import snapshot from '@data/fixtures/trace/spec-id-counts.json';

import { isSpecSource, readSpecIds } from './spec-ids';

import type { MarkdownFile, SpecIds } from './spec-ids';

const ROOT = path.join(import.meta.dirname, '..');
const CRITERIA = "## Critères d'acceptation";

/** A spec file of the given path whose lines are `lines`. */
const spec = (file: string, lines: readonly string[]): MarkdownFile => ({
  path: file,
  text: [...lines, ''].join('\n'),
});

/** The players spec file (prefix JOU) with these requirements and criteria sections. */
const players = (requirements: readonly string[], criteria: readonly string[]): MarkdownFile =>
  spec('docs/01-joueurs-suivis.md', [
    '# 01 — Joueurs suivis',
    '',
    '## Règles de gestion',
    '',
    ...requirements,
    '',
    CRITERIA,
    '',
    ...criteria,
  ]);

const problemsOf = (ids: SpecIds): readonly string[] =>
  ids.problems.map(({ where, problem }) => `${where}: ${problem}`);

/** The counts of `ids`, in the shape of the committed snapshot. */
function countsOf(ids: SpecIds): Readonly<Record<string, unknown>> {
  const lots = Map.groupBy(ids.requirements, (requirement) => String(requirement.lot));
  const requirements = Map.groupBy(
    ids.requirements,
    (requirement) => requirement.id.split('-', 1)[0] ?? '',
  );
  const criteria = Map.groupBy(ids.criteria, (criterion) => criterion.id.split('-', 2)[1] ?? '');
  return {
    lots: Object.fromEntries([...lots].map(([lot, each]) => [lot, each.length])),
    prefixes: Object.fromEntries(
      [...requirements].map(([prefix, each]) => [
        prefix,
        {
          file: path.posix.basename(each[0]?.file ?? '').slice(0, 2),
          requirements: each.length,
          criteria: criteria.get(prefix)?.length ?? 0,
        },
      ]),
    ),
  };
}

describe('readSpecIds on the specifications', () => {
  const files = readdirSync(path.join(ROOT, 'docs'))
    .map((name) => `docs/${name}`)
    .filter((file) => isSpecSource(file))
    .map((file) => ({ path: file, text: readFileSync(path.join(ROOT, file), 'utf8') }));
  const ids = readSpecIds(files);

  it('finds the 627 requirements, 384 of Lot 1 and 243 of Lot 2, and the 346 acceptance criteria', () => {
    expect(ids.requirements).toHaveLength(627);
    expect(ids.requirements.filter((requirement) => requirement.lot === 1)).toHaveLength(384);
    expect(ids.requirements.filter((requirement) => requirement.lot === 2)).toHaveLength(243);
    expect(ids.criteria).toHaveLength(346);
    expect(problemsOf(ids)).toStrictEqual([]);
  });

  it('finds the counts per prefix and per lot that the committed snapshot records', () => {
    expect(countsOf(ids)).toStrictEqual(snapshot);
  });

  it('numbers the criteria that a spec file lists without IDs by their position', () => {
    const first = ids.criteria.find((criterion) => criterion.id === 'CA-STA-01');
    const last = ids.criteria.find((criterion) => criterion.id === 'CA-TRV-41');

    expect(first?.text).toMatch(/^Étant donné une feuille où le joueur a joué 34 minutes/u);
    expect(last?.text).toMatch(/^\(TRV-26\) — Étant donné une collecte suivie de la détection/u);
  });

  it('knows the hypotheses, questions and decisions of the journal and of the spec files', () => {
    const cited = ['H-13', 'H-STA-03', 'Q-04', 'Q-STA-01', 'D-07', 'D-07 bis', 'H-14', 'Q-STA-02'];

    expect(cited.filter((id) => ids.citable.has(id))).toStrictEqual([
      'H-13',
      'H-STA-03',
      'Q-04',
      'Q-STA-01',
      'D-07',
      'D-07 bis',
    ]);
  });
});

describe('readSpecIds on requirements', () => {
  it('reads a definition with the ID in bold, with the ID and its lot in bold, or with no bold', () => {
    const ids = readSpecIds([
      players(
        [
          '- **JOU-01** [Lot 1] — Bold ID.',
          '- **JOU-02 [Lot 2] — Bold ID, lot and title.** Text.',
          '- JOU-03 [Lot 1] — Plain ID.',
          '  - JOU-04 [Lot 2] — A nested item defines too.',
        ],
        ['1. A criterion.'],
      ),
    ]);

    expect(ids.requirements).toStrictEqual([
      {
        id: 'JOU-01',
        file: 'docs/01-joueurs-suivis.md',
        where: 'docs/01-joueurs-suivis.md:5',
        lot: 1,
      },
      {
        id: 'JOU-02',
        file: 'docs/01-joueurs-suivis.md',
        where: 'docs/01-joueurs-suivis.md:6',
        lot: 2,
      },
      {
        id: 'JOU-03',
        file: 'docs/01-joueurs-suivis.md',
        where: 'docs/01-joueurs-suivis.md:7',
        lot: 1,
      },
      {
        id: 'JOU-04',
        file: 'docs/01-joueurs-suivis.md',
        where: 'docs/01-joueurs-suivis.md:8',
        lot: 2,
      },
    ]);
    expect(problemsOf(ids)).toStrictEqual([]);
  });

  it('takes a cross-reference, an item in the criteria or a code block for no definition', () => {
    const ids = readSpecIds([
      players(
        [
          '- **JOU-01** [Lot 1] — The one definition, which cites JOU-02 [Lot 1].',
          'JOU-03 [Lot 1] is a paragraph, not a list item.',
          '- JOU-04 — a summary of a requirement, without its lot.',
          '- JOU-05 — see [Lot 1] in another place.',
          '```text',
          '- JOU-06 [Lot 1] — inside a code block.',
          '```',
        ],
        ['1. JOU-07 [Lot 1] — an item of the criteria.'],
      ),
    ]);

    expect(ids.requirements.map((requirement) => requirement.id)).toStrictEqual(['JOU-01']);
    expect(problemsOf(ids)).toStrictEqual([]);
  });

  it('refuses a suffixed ID, an ID of another prefix, and an ID defined twice', () => {
    const ids = readSpecIds([
      players(
        [
          '- **JOU-01 bis** [Lot 1] — Suffixed.',
          '- JOU-02a [Lot 1] — Suffixed too.',
          '- **TAX-01** [Lot 1] — Belongs to 02.',
          '- **JOU-03** [Lot 1] — First.',
          '- **JOU-03** [Lot 2] — Again.',
        ],
        ['1. A criterion.'],
      ),
    ]);

    expect(problemsOf(ids)).toStrictEqual([
      'docs/01-joueurs-suivis.md:5: "JOU-01 bis" is a suffixed requirement ID: an ID is its prefix and a number, which a test title can cite.',
      'docs/01-joueurs-suivis.md:6: "JOU-02a" is a suffixed requirement ID: an ID is its prefix and a number, which a test title can cite.',
      'docs/01-joueurs-suivis.md:7: TAX-01 is defined in a spec file of JOU IDs only.',
      'docs/01-joueurs-suivis.md:9: JOU-03 is defined twice; the first definition is at docs/01-joueurs-suivis.md:8.',
    ]);
    expect(ids.requirements.map((requirement) => requirement.id)).toStrictEqual([
      'JOU-03',
      'JOU-03',
    ]);
  });
});

describe('readSpecIds on acceptance criteria', () => {
  it('numbers the top-level items of the criteria section, numbered or not, from 01', () => {
    const ids = readSpecIds([
      players(
        ['- **JOU-01** [Lot 1] — A requirement.'],
        [
          '1. (JOU-01) First.',
          '   - A nested item, which is no criterion.',
          '2. **JOU-01** — **Second**, in bold.',
          '',
          '### A subheading inside the section',
          '',
          '- Third, a bullet.',
          '',
          '## Dépendances',
          '',
          '- Not a criterion: the next level-2 section has begun.',
        ],
      ),
    ]);

    expect(ids.criteria.map(({ id, where, text }) => [id, where, text])).toStrictEqual([
      ['CA-JOU-01', 'docs/01-joueurs-suivis.md:9', '(JOU-01) First.'],
      ['CA-JOU-02', 'docs/01-joueurs-suivis.md:11', '**JOU-01** — **Second**, in bold.'],
      ['CA-JOU-03', 'docs/01-joueurs-suivis.md:15', 'Third, a bullet.'],
    ]);
    expect(problemsOf(ids)).toStrictEqual([]);
  });

  it('refuses a numbered list that does not count 1, 2, 3 in order', () => {
    const ids = readSpecIds([players([], ['1. First.', '3. Second, numbered 3.', '3. Third.'])]);

    expect(problemsOf(ids)).toStrictEqual([
      'docs/01-joueurs-suivis.md:9: Criterion 2 is numbered 3: a numbered list must count 1, 2, 3… in order, since its position gives a criterion its ID.',
    ]);
  });

  it('reads the IDs that the criteria of a section carry', () => {
    const ids = readSpecIds([
      spec('docs/03-collecte-des-actualites.md', [
        CRITERIA,
        '',
        '- **CA-COL-02** (COL-02) — First, whatever its number.',
        '- CA-COL-01 (COL-04) — Plain.',
      ]),
    ]);

    expect(ids.criteria.map(({ id, text }) => [id, text])).toStrictEqual([
      ['CA-COL-02', '(COL-02) — First, whatever its number.'],
      ['CA-COL-01', '(COL-04) — Plain.'],
    ]);
    expect(problemsOf(ids)).toStrictEqual([]);
  });

  it('refuses a criterion without its ID, a malformed ID, another prefix and an ID used twice', () => {
    const ids = readSpecIds([
      spec('docs/03-collecte-des-actualites.md', [
        CRITERIA,
        '',
        '- **CA-COL-01** — Fine.',
        '- No ID.',
        '- **CA-COL-02 bis** — Suffixed.',
        '- **CA-JOU-01** — Belongs to 01.',
        '- **CA-COL-01** — Again.',
      ]),
    ]);

    expect(problemsOf(ids)).toStrictEqual([
      'docs/03-collecte-des-actualites.md:4: This criterion has no ID, while the others of its section do.',
      'docs/03-collecte-des-actualites.md:5: "CA-COL-02 bis" is not a criterion ID: write CA-COL-nn.',
      'docs/03-collecte-des-actualites.md:6: CA-JOU-01 is defined in a spec file of CA-COL IDs only.',
      'docs/03-collecte-des-actualites.md:7: CA-COL-01 is defined twice; the first definition is at docs/03-collecte-des-actualites.md:3.',
    ]);
  });

  it.each([
    ['no criteria section', ['## Règles de gestion'], 0],
    ['two criteria sections', [CRITERIA, '', '- One.', '', CRITERIA, '', '- Two.'], 2],
  ])('refuses a spec file with %s', (_case, lines, sections) => {
    const ids = readSpecIds([spec('docs/01-joueurs-suivis.md', lines)]);

    expect(problemsOf(ids)).toStrictEqual([
      `docs/01-joueurs-suivis.md: A spec file has one level-2 section « Critères d'acceptation »; this one has ${String(sections)}.`,
    ]);
  });
});

describe('readSpecIds on hypotheses, questions, decisions and rulings', () => {
  it('knows the IDs that their owner file defines, and none that another file only cites', () => {
    const ids = readSpecIds([
      spec('docs/90-journal-des-decisions.md', [
        '- **D-xx — Décision** : the legend, which defines nothing.',
        '- **D-07 — Référence.** Text.',
        '- **D-07 bis — Gratuité totale.** Text.',
        '- **H-13 — Formule.** Text, citing H-14.',
        '- **Q-04 — Seuils.** Text.',
      ]),
      players(
        [
          '- **H-JOU-01 — Plafond (à confirmer).** Its own hypothesis.',
          '- Q-JOU-01 — Its own question.',
          '- H-TAX-01 — A hypothesis of 02, only cited here.',
          '- **H-02** — A journal hypothesis, only cited here.',
        ],
        ['1. A criterion.'],
      ),
      spec('docs/engineering/clarifications/07-game-statistics.md', [
        '# Clarifications — 07 Game statistics',
        '',
        '### CL-STA-01 — Acceptance-criterion IDs',
        '',
        '- **Ruling:** as CL-STA-02 says, which defines nothing.',
      ]),
    ]);

    expect(ids.citable).toStrictEqual(
      new Set(['D-07', 'D-07 bis', 'H-13', 'Q-04', 'H-JOU-01', 'Q-JOU-01', 'CL-STA-01']),
    );
    expect(problemsOf(ids)).toStrictEqual([]);
  });

  it('reads only the specs, the journal and the clarifications', () => {
    expect(
      [
        'docs/07-statistiques-de-match.md',
        'docs/90-journal-des-decisions.md',
        'docs/engineering/clarifications/07-game-statistics.md',
        'docs/README.md',
        'docs/engineering/glossary.md',
        'src/lib/stats-engine/game-score.ts',
      ].filter((file) => isSpecSource(file)),
    ).toStrictEqual([
      'docs/07-statistiques-de-match.md',
      'docs/90-journal-des-decisions.md',
      'docs/engineering/clarifications/07-game-statistics.md',
    ]);
  });
});
