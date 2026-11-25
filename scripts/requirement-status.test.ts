import { describe, expect, it } from 'vitest';

import {
  DEVIATIONS_PATH,
  readDeviations,
  requirementStatus,
  STATUS_PATH,
  writeRequirementStatus,
} from './requirement-status';
import { REGISTER_PATH } from './waiver-register';

const SPEC_PATH = 'docs/01-joueurs-suivis.md';
const TEST_PATH = 'src/lib/players/add.test.ts';

// JOU-01 and its criterion are tested; JOU-02 is, but not its criterion, which JOU-03
// cites too; JOU-04 is waived; only the criterion of JOU-05 is tested; JOU-06 has
// nothing; JOU-07 is tested, with a limit, and so is its criterion, written in bold.
// CA-JOU-04 names JOU-01 only inside its text, which cites nothing.
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
  '',
].join('\n');

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

const FILES: readonly (readonly [path: string, text: string])[] = [
  [SPEC_PATH, SPEC],
  [TEST_PATH, TESTS],
  [REGISTER_PATH, WAIVERS],
  [DEVIATIONS_PATH, DEVIATIONS],
  ['README.md', '# Egoscope\n'],
];
const TEXTS: ReadonlyMap<string, string> = new Map(FILES);

const io = {
  paths: FILES.map(([file]) => file),
  read: (file: string): string => {
    const text = TEXTS.get(file);
    if (text === undefined) {
      throw new Error(`The fixture has no ${file}.`);
    }
    return text;
  },
};

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

describe('readDeviations', () => {
  it('[TRV-79] reads the rows of the register tables, their escaped pipes restored, and nothing else', () => {
    expect(readDeviations(DEVIATIONS)).toStrictEqual([
      { id: 'JOU-06', kind: 'overridden', record: '0010' },
      { id: 'CA-JOU-02', kind: 'extended', record: '0015, 0016' },
      { id: 'Q-JOU-01', kind: 'settled', record: '0009' },
    ]);
  });
});

describe('writeRequirementStatus', () => {
  it('[TRV-79] writes the page to docs/guide/requirement-status.md and says so', async () => {
    const written = new Map<string, string>();
    const lines: string[] = [];

    await writeRequirementStatus({
      ...io,
      write: (file, text) => {
        written.set(file, text);
      },
      info: (line) => {
        lines.push(line);
      },
    });

    expect(Array.from(written, ([file]) => file)).toStrictEqual([STATUS_PATH]);
    expect(written.get(STATUS_PATH)).toBe(await requirementStatus(io));
    expect(lines).toStrictEqual(['Wrote docs/guide/requirement-status.md.']);
  });
});
