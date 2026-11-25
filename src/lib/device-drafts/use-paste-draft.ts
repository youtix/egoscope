'use client';

import { useEffect, useEffectEvent, useState } from 'react';

import { now } from '@/lib/time';

import { dropExpiredCopies } from './copies';
import { draftKey } from './draft-target';
import { deleteCopy, putCopy, readContact, readCopy } from './store';
import { contactServer, sendCopy, takeServerCopy } from './sync';

import type { DraftServer } from './contract';
import type { DraftTarget, ImportDraftStatus } from './draft-target';
import type { DeviceCopy } from './store';
import type { SendOutcome } from './sync';
import type { EpochMs } from '@/lib/time';

/** What the owner's discard did: both copies went, or it waits for the server (IHM-58). */
export type DiscardOutcome = 'discarded' | 'server_unavailable';

/**
 * The draft of a paste screen (IHM-42): its text, last change and status, whether the
 * text reached the server, whether a contact discarded drafts typed offline (CL-DSN-22),
 * the server's refusal of a text too large (CL-IMP-27), and the owner's actions on it.
 */
export type PasteDraft = Readonly<{
  ready: boolean;
  text: string;
  updatedAt: EpochMs | null;
  status: ImportDraftStatus | null;
  sent: boolean;
  unsentDiscarded: boolean;
  refusal: string | null;
  /** Keeps a change at once on the device, then sends it when the network allows. */
  change: (text: string) => void;
  /** Discards the draft on the server, then on the device; it needs the server (IHM-58). */
  discard: () => Promise<DiscardOutcome>;
  /** Forgets the device copy once the import or the proposals are saved, the server copy going with the save. */
  saved: () => Promise<void>;
}>;

type Loaded = Readonly<{
  copy: DeviceCopy | undefined;
  unsentDiscarded: boolean;
  refusal: string | null;
}>;

type DraftState = Loaded & Readonly<{ ready: boolean }>;

const LOADING: DraftState = {
  ready: false,
  copy: undefined,
  unsentDiscarded: false,
  refusal: null,
};

/** Says whether the browser has a network, the only time the device calls the server (IHM-58). */
function isOnline(): boolean {
  return navigator.onLine;
}

/**
 * Brings onto this device the server copy of a draft typed on another one, when this
 * device holds none; the contact has already replaced a copy the device holds by a later
 * server copy (IHM-42, H-IHM-08, CL-DSN-17).
 */
async function adoptServerCopy(target: DraftTarget, server: DraftServer): Promise<void> {
  if ((await readCopy(draftKey(target))) === undefined) {
    await takeServerCopy(target, server);
  }
}

/** Contacts the server when the network allows, and says what it did to the copy of `target` (CL-DSN-22). */
async function contactFor(target: DraftTarget, server: DraftServer): Promise<Omit<Loaded, 'copy'>> {
  const nothing = { unsentDiscarded: false, refusal: null };
  if (!isOnline()) {
    return nothing;
  }
  try {
    const report = await contactServer(server);
    await adoptServerCopy(target, server);
    return {
      unsentDiscarded: report.unsentDiscarded,
      refusal: report.refusals.get(draftKey(target)) ?? null,
    };
  } catch {
    // The server is out of reach or the session expired: the device keeps its copies.
    return nothing;
  }
}

/**
 * Deletes the expired copies of every screen, online or not, then contacts the server when
 * the network allows, and reads the device copy (IHM-42, CL-IHM-11, CL-DSN-22).
 */
async function loadDraft(target: DraftTarget, server: DraftServer): Promise<Loaded> {
  await dropExpiredCopies();
  const report = await contactFor(target, server);
  return { copy: await readCopy(draftKey(target)), ...report };
}

/** Keeps a typed copy on the device, then sends it when the network allows; `null` when it was not sent. */
async function keepTyped(copy: DeviceCopy, server: DraftServer): Promise<SendOutcome | null> {
  const contact = await readContact();
  const typed = { ...copy, withdrawnEventCount: contact?.withdrawnEventCount ?? null };
  await putCopy(typed);
  if (!isOnline()) {
    return null;
  }
  try {
    return await sendCopy(typed, server);
  } catch {
    // Out of reach: the copy stays unsent until the next contact.
    return null;
  }
}

/** Discards both copies, the server's first, which needs the network (IHM-42, IHM-58). */
async function discardBoth(target: DraftTarget, server: DraftServer): Promise<DiscardOutcome> {
  if (!isOnline()) {
    return 'server_unavailable';
  }
  try {
    await server.discard(target);
  } catch {
    return 'server_unavailable';
  }
  await deleteCopy(draftKey(target));
  return 'discarded';
}

/** The copy the device holds after a send of `copy` (IHM-42, CL-DSN-17, CL-DSN-22). */
function copyAfter(copy: DeviceCopy, outcome: SendOutcome): DeviceCopy | undefined {
  if (outcome.kind === 'superseded') {
    return outcome.copy;
  }
  if (outcome.kind === 'sent') {
    return { ...copy, updatedAt: outcome.updatedAt, sent: true };
  }
  const isGone = outcome.kind === 'discarded_unsent' || outcome.kind === 'gone';
  return isGone ? undefined : { ...copy, sent: false };
}

/** The state after a send of the copy typed at `updatedAt`, unless a later change replaced it. */
function afterSend(previous: DraftState, updatedAt: EpochMs, outcome: SendOutcome): DraftState {
  if (previous.copy?.updatedAt !== updatedAt) {
    return previous;
  }
  return {
    ...previous,
    copy: copyAfter(previous.copy, outcome),
    unsentDiscarded: previous.unsentDiscarded || outcome.kind === 'discarded_unsent',
    refusal: outcome.kind === 'refused' ? outcome.message : null,
  };
}

/** A copy the owner has just typed, not sent yet (IHM-42). */
function typedCopy(target: DraftTarget, text: string): DeviceCopy {
  return {
    key: draftKey(target),
    target,
    text,
    updatedAt: now(),
    sent: false,
    withdrawnEventCount: null,
    status: 'kept',
  };
}

/** What the screen shows of a draft's state. */
function shown(state: DraftState): Omit<PasteDraft, 'change' | 'discard' | 'saved'> {
  const { copy } = state;
  return {
    ready: state.ready,
    text: copy?.text ?? '',
    updatedAt: copy?.updatedAt ?? null,
    status: copy?.status ?? null,
    sent: copy?.sent ?? false,
    unsentDiscarded: state.unsentDiscarded,
    refusal: state.refusal,
  };
}

/**
 * Keeps the text pasted or typed on an import or exploration screen as a draft (IHM-42,
 * DSN-32): every change at once on the device, which a reload, an app update, an expired
 * session and a network loss leave in place, and on the server attached to its target as
 * soon as the connection allows, through the route's `server` actions. At each contact,
 * and when the network returns, the device judges its copies by CL-DSN-22; it sends
 * nothing but drafts, and never an action later (IHM-58, CL-IHM-14).
 */
export function usePasteDraft(target: DraftTarget, server: DraftServer): PasteDraft {
  const key = draftKey(target);
  const [state, setState] = useState<DraftState>(LOADING);

  const refresh = useEffectEvent(async () => {
    const loaded = await loadDraft(target, server);
    setState((previous) => ({
      ...loaded,
      ready: true,
      unsentDiscarded: previous.unsentDiscarded || loaded.unsentDiscarded,
    }));
  });

  useEffect(() => {
    const reconnect = () => {
      void refresh();
    };
    reconnect();
    globalThis.addEventListener('online', reconnect);
    return () => {
      globalThis.removeEventListener('online', reconnect);
    };
  }, [key]);

  const change = (text: string) => {
    const typed = typedCopy(target, text);
    setState((previous) => ({ ...previous, copy: typed }));
    const keep = async () => {
      const outcome = await keepTyped(typed, server);
      if (outcome !== null) {
        setState((previous) => afterSend(previous, typed.updatedAt, outcome));
      }
    };
    void keep();
  };

  const forget = () => {
    setState((previous) => ({ ...previous, copy: undefined }));
  };

  return {
    ...shown(state),
    change,
    discard: async () => {
      const outcome = await discardBoth(target, server);
      if (outcome === 'discarded') {
        forget();
      }
      return outcome;
    },
    saved: async () => {
      await deleteCopy(key);
      forget();
    },
  };
}
