import { describe, expect, it } from 'vitest';

import { messagesOf } from './types';

import type { ClassificationRequest } from './types';

const STATIC_PART = {
  instructions: 'Report the facts of each article.',
  typeSheets: 'Sheet: public dispute.',
  doNotRepropose: 'Do not repropose: bench outburst.',
};
const SCHEMA = { name: 'classification', schema: { type: 'object' } };

const requestOf = (ids: readonly string[]): ClassificationRequest => ({
  staticPart: STATIC_PART,
  articles: ids.map((id) => ({ id, text: `Title and excerpt of ${id}.` })),
  schema: SCHEMA,
});

describe('messagesOf', () => {
  it('[DET-12] [DET-14] [DSN-05] sends the static part first, the same for every batch, then only the articles, each with its identifier', () => {
    const first = messagesOf(requestOf(['a-1', 'a-2']));
    const second = messagesOf(requestOf(['a-3']));

    expect(first).toStrictEqual([
      {
        role: 'system',
        content:
          'Report the facts of each article.\n\nSheet: public dispute.\n\nDo not repropose: bench outburst.',
      },
      {
        role: 'user',
        content:
          '{"articles":[{"id":"a-1","text":"Title and excerpt of a-1."},{"id":"a-2","text":"Title and excerpt of a-2."}]}',
      },
    ]);
    expect(second[0]).toStrictEqual(first[0]);
  });
});
