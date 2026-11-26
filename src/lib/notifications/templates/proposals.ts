// The message of a new type that the detection proposes (TEL-14, CL-TEL-10).

import { formatCount, sentence } from '@/lib/wording';

import { clock, firstLine, link, message, plain } from './text';

import type { NewTypeProposalData } from './data';

/**
 * A proposed type: its name and definition, or "text not kept", when and from how many
 * articles it was proposed, and the link to validate or reject it (TEL-14, CL-TEL-10).
 */
export function newTypeProposal(data: NewTypeProposalData, zone: string): string {
  const notKept = sentence('notifications.textNotKept');
  const name = data.name ?? notKept;
  const definition = data.definition ?? notKept;
  const proposedBy = sentence('notifications.proposedBy', {
    at: clock(data.proposedAt, zone),
    n: formatCount(data.articleCount),
  });
  return message([
    firstLine(sentence('notifications.newTypeTitle')),
    plain(sentence('notifications.proposedName', { name })),
    plain(sentence('notifications.proposedDefinition', { definition })),
    plain(proposedBy),
    plain(sentence('notifications.usedOnceValidated')),
    link(data.typeUrl, sentence('notifications.validateOrReject')),
  ]);
}
