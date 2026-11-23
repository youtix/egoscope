// A device's contact with the server about its drafts (IHM-42, CL-DSN-22, CL-IHM-14):
// sending a copy saves input and is no action, so it happens as soon as the network
// allows; nothing else typed offline is ever sent later (IHM-58).
import { now } from '@/lib/time';

import { copyFate } from './device-rules';
import { deleteCopy, listCopies, putContact, putCopy, readContact, readCopy } from './device-store';

import type { DraftServer } from './contract';
import type { CopyFate } from './device-rules';
import type { DeviceCopy } from './device-store';

/** What a send did: the copy reached the server, was refused with a message, or went (CL-DSN-22). */
export type SendOutcome =
  | Readonly<{ kind: 'sent' }>
  | Readonly<{ kind: 'refused'; message: string }>
  | Readonly<{ kind: 'discarded_unsent' }>
  | Readonly<{ kind: 'gone' }>;

/** What a contact did: whether it discarded unsent copies, and the refusal of each copy refused (CL-DSN-22). */
export type ContactReport = Readonly<{
  unsentDiscarded: boolean;
  refusals: ReadonlyMap<string, string>;
}>;

/** Records the counter the server answered, keeping the retention the device last received. */
async function recordCount(withdrawnEventCount: number): Promise<void> {
  const contact = await readContact();
  await putContact({ withdrawnEventCount, retentionDays: contact?.retentionDays ?? null });
}

/**
 * Sends `copy` to the server and marks it sent when the device still holds that text
 * (IHM-42); an import copy typed before the counter grew is discarded, and a copy whose
 * request or proposal is gone is deleted (CL-DSN-22, CL-DSN-17).
 */
export async function sendCopy(copy: DeviceCopy, server: DraftServer): Promise<SendOutcome> {
  const saved = await server.save({
    target: copy.target,
    text: copy.text,
    updatedAt: copy.updatedAt,
    knownWithdrawnEventCount: copy.withdrawnEventCount,
  });
  if (saved.ok) {
    await recordCount(saved.value.withdrawnEventCount);
    const current = await readCopy(copy.key);
    if (current?.updatedAt === copy.updatedAt && current.text === copy.text) {
      await putCopy({
        ...current,
        sent: true,
        withdrawnEventCount: saved.value.withdrawnEventCount,
      });
    }
    return { kind: 'sent' };
  }
  if (saved.error.kind === 'text_too_large') {
    return { kind: 'refused', message: saved.error.message };
  }
  await deleteCopy(copy.key);
  if (saved.error.kind === 'events_withdrawn') {
    await recordCount(saved.error.withdrawnEventCount);
    return { kind: 'discarded_unsent' };
  }
  return { kind: 'gone' };
}

/** Does to `copy` what its fate says, and returns what a send or a discard did (CL-DSN-22). */
async function applyFate(
  copy: DeviceCopy,
  fate: CopyFate,
  server: DraftServer,
): Promise<SendOutcome | null> {
  if (fate === 'keep') {
    return null;
  }
  if (fate === 'mark_imported') {
    await putCopy({ ...copy, status: 'request_already_imported' });
    return null;
  }
  if (fate === 'send') {
    return sendCopy(copy, server);
  }
  await deleteCopy(copy.key);
  return fate === 'discard_unsent' ? { kind: 'discarded_unsent' } : { kind: 'gone' };
}

/**
 * The device's contact (CL-DSN-22, CL-IHM-11): sends the server the targets of the copies
 * it had sent, records the counter and the retention it answers, then keeps, marks,
 * drops, discards or sends each copy by `copyFate`.
 */
export async function contactServer(server: DraftServer): Promise<ContactReport> {
  const copies = await listCopies();
  const check = await server.check(copies.filter((copy) => copy.sent).map((copy) => copy.target));
  await putContact({
    withdrawnEventCount: check.withdrawnEventCount,
    retentionDays: check.retentionDays,
  });
  const at = now();
  let isUnsentDiscarded = false;
  const refusals = new Map<string, string>();
  for (const copy of copies) {
    const outcome = await applyFate(copy, copyFate(copy, check, at), server);
    isUnsentDiscarded ||= outcome?.kind === 'discarded_unsent';
    if (outcome?.kind === 'refused') {
      refusals.set(copy.key, outcome.message);
    }
  }
  return { unsentDiscarded: isUnsentDiscarded, refusals };
}
