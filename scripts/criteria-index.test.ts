import { describe, expect, it } from 'vitest';

import { criteriaIndex } from './criteria-index';

import type { Criterion } from './spec-ids';

const criterion = (id: string, file: string, text: string): Criterion => ({
  id,
  file,
  where: `${file}:1`,
  text,
});

/** The rows of the index's table, below its header. */
async function rowsOf(criteria: readonly Criterion[]): Promise<readonly string[]> {
  const index = await criteriaIndex(criteria);
  const lines = index.split('\n');
  return lines.slice(lines.findIndex((line) => line.startsWith('| ID ')) + 2, -1);
}

describe('criteriaIndex', () => {
  it('lists each criterion with its ID, a link to its spec file and its first words', async () => {
    const rows = await rowsOf([
      criterion('CA-VUE-01', 'docs/00-vue-d-ensemble.md', '(VUE-01) Étant donné un joueur suivi.'),
      criterion(
        'CA-COL-03',
        'docs/03-collecte-des-actualites.md',
        '(COL-04) — Étant donné un flux.',
      ),
    ]);

    expect(rows).toStrictEqual([
      '| CA-VUE-01 | [00-vue-d-ensemble.md](../00-vue-d-ensemble.md)                   | (VUE-01) Étant donné un joueur suivi. |',
      '| CA-COL-03 | [03-collecte-des-actualites.md](../03-collecte-des-actualites.md) | (COL-04) — Étant donné un flux.       |',
    ]);
  });

  it('keeps the first fifteen words, as plain text that the table shows as it is', async () => {
    const rows = await rowsOf([
      criterion(
        'CA-IMP-02',
        'docs/06-import-des-resultats-de-recherche.md',
        '**IMP-06** — **Étant donné** un JSON dont `version_format` vaut « 2.0 » | voir le format, quand il est analysé, alors il est refusé',
      ),
    ]);

    expect(rows).toStrictEqual([
      '| CA-IMP-02 | [06-import-des-resultats-de-recherche.md](../06-import-des-resultats-de-recherche.md) | IMP-06 — Étant donné un JSON dont version\\_format vaut « 2.0 » \\| voir le… |',
    ]);
  });

  it('opens with a title and says that the file is generated', async () => {
    const index = await criteriaIndex([]);

    expect(index.split('\n', 1)).toStrictEqual(['# Acceptance criteria index']);
    expect(index).toContain('This file is generated, so never edit it by hand');
  });
});
