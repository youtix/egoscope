import { describe, expect, it } from 'vitest';

import { paths } from '@/lib/navigation';
import { toEpochMs } from '@/lib/time';

import { newTypeProposal } from './proposals';

import type { NewTypeProposalData } from './data';

const PARIS = 'Europe/Paris';
const linesOf = (text: string): readonly string[] => text.split('\n');

const PROPOSAL: NewTypeProposalData = {
  kind: 'new_type_proposal',
  name: 'Benching',
  definition: 'Public loss of a starting spot.',
  articleCount: 3,
  // Tuesday 17 November 2026, 07:00 in Paris.
  proposedAt: toEpochMs(Date.UTC(2026, 10, 17, 6)),
  typeUrl: `https://egoscope.example${paths.typeSheet('benching')}`,
};

describe('the message of a new type proposal', () => {
  it('[TEL-14] writes the proposed name and definition, when and from how many articles, and the link to decide', () => {
    expect(linesOf(newTypeProposal(PROPOSAL, PARIS))).toStrictEqual([
      '<b>Egoscope · New type proposed</b>',
      'Proposed name: Benching',
      'Definition: Public loss of a starting spot.',
      'Proposed by the detection of Tuesday 17 November 2026, 07:00 Paris time, from 3 articles.',
      'A proposed type is used only once you validate it.',
      '<a href="https://egoscope.example/types/benching">Validate or reject</a>',
    ]);
  });

  it('[TEL-14] [CL-TEL-10] writes "text not kept" for a text the detection did not keep, and one article in the singular', () => {
    const notKept = newTypeProposal(
      { ...PROPOSAL, name: null, definition: null, articleCount: 1 },
      PARIS,
    );

    expect(linesOf(notKept).slice(1, 4)).toStrictEqual([
      'Proposed name: text not kept',
      'Definition: text not kept',
      'Proposed by the detection of Tuesday 17 November 2026, 07:00 Paris time, from 1 article.',
    ]);
  });
});
