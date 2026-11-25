// A device's contact with the server about its drafts (IHM-42, CL-DSN-22, CL-IHM-14):
// sending a copy saves input and is no action, so it happens as soon as the network
// allows; nothing else typed offline is ever sent later (IHM-58).
import { now } from '@/lib/time';

import { draftKey } from './draft-target';
import { copyFate } from './rules';
import { deleteCopy, listCopies, putContact, putCopy, readContact, readCopy } from './store';

import type { DraftServer, SavedCopy } from './contract';
import type { DraftTarget } from './draft-target';
import type { CopyFate } from './rules';
import type { DeviceCopy } from './store';
import type { EpochMs } from '@/lib/time';

/**
 * What a send did: the copy reached the server, which stored it as changed at `updatedAt`;
 * the server kept a later change, and
 * `copy` is what the device then holds (CL-DSN-17); the copy was refused with a message,
 * stays on the device alone, or went (CL-DSN-22).
 */
export type SendOutcome =
  | Readonly<{ kind: 'sent'; updatedAt: EpochMs }>
  | Readonly<{ kind: 'superseded'; copy: DeviceCopy | undefined }>
  | Readonly<{ kind: 'refused'; message: string }>
  | Readonly<{ kind: 'kept_unsent' }>
  | Readonly<{ kind: 'discarded_unsent' }>
  | Readonly<{ kind: 'gone' }>;

/** What a contact did: whether it discarded unsent copies, and the refusal of each copy refused (CL-DSN-22). */
type ContactReport = Readonly<{
  unsentDiscarded: boolean;
  refusals: ReadonlyMap<string, string>;
}>;

/** Records the counter the server answered, keeping the retention the device last received. */
async function recordCount(withdrawnEventCount: number): Promise<void> {
  const contact = await readContact();
  await putContact({ withdrawnEventCount, retentionDays: contact?.retentionDays ?? null });
}

/** The copy the device holds for `copy`'s target when no change was typed since `copy` was read. */
async function stillHeld(copy: DeviceCopy): Promise<DeviceCopy | undefined> {
  const current = await readCopy(copy.key);
  return current?.updatedAt === copy.updatedAt && current.text === copy.text ? current : undefined;
}

/**
 * Records the counter that the server answered to the send of `copy`, and marks the copy
 * sent when the device still holds that text, changed at the instant the server stored, so
 * that a device clock running ahead of the server's never puts it after a later change of
 * another device (IHM-42, CL-DSN-17, CL-DSN-22).
 */
async function markSent(copy: DeviceCopy, saved: SavedCopy): Promise<void> {
  await recordCount(saved.withdrawnEventCount);
  const current = await stillHeld(copy);
  if (current !== undefined) {
    await putCopy({
      ...current,
      updatedAt: saved.updatedAt,
      sent: true,
      withdrawnEventCount: saved.withdrawnEventCount,
    });
  }
}

/**
 * Loads the server copy of `target`'s draft and keeps it on this device, as sent, when the
 * device holds no copy or an earlier change, since a draft keeps its last change from
 * whichever device (IHM-42, H-IHM-08, CL-DSN-17); returns the copy the device then holds.
 */
export async function takeServerCopy(
  target: DraftTarget,
  server: DraftServer,
): Promise<DeviceCopy | undefined> {
  const stored = await server.load(target);
  const key = draftKey(target);
  const current = await readCopy(key);
  if (stored === null || (current !== undefined && current.updatedAt >= stored.updatedAt)) {
    return current;
  }
  const contact = await readContact();
  const taken: DeviceCopy = {
    key,
    target,
    text: stored.text,
    updatedAt: stored.updatedAt,
    sent: true,
    withdrawnEventCount: contact?.withdrawnEventCount ?? null,
    status: 'kept',
  };
  await putCopy(taken);
  return taken;
}

/**
 * Marks `copy` sent when the server wrote it, or takes the later change that the server
 * kept instead (IHM-42, CL-DSN-17), recording the counter it answered (CL-DSN-22).
 */
async function afterAccepted(
  copy: DeviceCopy,
  accepted: SavedCopy,
  server: DraftServer,
): Promise<SendOutcome> {
  if (accepted.wasWritten) {
    await markSent(copy, accepted);
    return { kind: 'sent', updatedAt: accepted.updatedAt };
  }
  await recordCount(accepted.withdrawnEventCount);
  return { kind: 'superseded', copy: await takeServerCopy(copy.target, server) };
}

/**
 * Sends `copy` to the server and marks it sent when the server wrote it and the device
 * still holds that text, or takes the later change the server kept instead (IHM-42,
 * CL-DSN-17); a text that the database cannot hold stays on the device alone (DSN-32); an
 * import copy typed before the counter grew is discarded, and a copy whose request or
 * proposal is gone is deleted (CL-DSN-22, CL-DSN-17).
 */
export async function sendCopy(copy: DeviceCopy, server: DraftServer): Promise<SendOutcome> {
  const saved = await server.save({
    target: copy.target,
    text: copy.text,
    updatedAt: copy.updatedAt,
    knownWithdrawnEventCount: copy.withdrawnEventCount,
  });
  if (saved.ok) {
    return afterAccepted(copy, saved.value, server);
  }
  if (saved.error.kind === 'text_too_large') {
    return { kind: 'refused', message: saved.error.message };
  }
  if (saved.error.kind === 'unstorable_text') {
    return { kind: 'kept_unsent' };
  }
  await deleteCopy(copy.key);
  if (saved.error.kind === 'events_withdrawn') {
    await recordCount(saved.error.withdrawnEventCount);
    return { kind: 'discarded_unsent' };
  }
  return { kind: 'gone' };
}

/**
 * Marks `copy` "Request already imported" or drops it, as its fate says, unless the owner
 * changed it during the contact's round trip: the fate judged the copy read before it, and
 * the later change stays (IHM-42, CL-DSN-22, CL-IHM-11).
 */
async function settleGone(
  copy: DeviceCopy,
  fate: 'mark_imported' | 'drop',
): Promise<SendOutcome | null> {
  const current = await stillHeld(copy);
  if (current === undefined) {
    return null;
  }
  if (fate === 'mark_imported') {
    await putCopy({ ...current, status: 'request_already_imported' });
    return null;
  }
  await deleteCopy(copy.key);
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
  if (fate === 'take_server') {
    await takeServerCopy(copy.target, server);
    return null;
  }
  if (fate === 'send') {
    return sendCopy(copy, server);
  }
  if (fate === 'discard_unsent') {
    await deleteCopy(copy.key);
    return { kind: 'discarded_unsent' };
  }
  return settleGone(copy, fate);
}

/**
 * The device's contact (IHM-42, CL-DSN-17, CL-DSN-22, CL-IHM-11): sends the server the
 * targets of the copies it had sent, records the counter and the retention it answers,
 * then keeps, replaces by a later server copy, marks, drops, discards or sends each copy
 * by `copyFate`.
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
