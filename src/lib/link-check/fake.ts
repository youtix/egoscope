// The scriptable fake of the link check (module map §5): each address answers as
// scripted — a status, a redirect, a timeout or a host name that does not resolve —
// and the probe follows the same rules as the HTTP adapter. An address never
// scripted answers 200, so that the hermetic end-to-end mode finds every link.
import { probeThrough } from './follow';

import type { HopAnswer } from './follow';
import type { LinkCheck } from './port';

/** How an address answers the fake. */
export type ScriptedAnswer =
  Readonly<{ status: number }> | Readonly<{ redirectTo: string }> | 'timeout' | 'unresolved';

/** The fake link check and its controls. */
export type FakeLinkCheck = LinkCheck &
  Readonly<{
    /** Scripts how `url` answers from now on. */
    answer: (url: string, scripted: ScriptedAnswer) => void;
    /** Forgets every scripted answer. */
    reset: () => void;
  }>;

const OK = 200;
const FOUND = 302;

function hopAnswer(scripted: ScriptedAnswer): HopAnswer {
  if (scripted === 'timeout') {
    return { kind: 'failed' };
  }
  if (scripted === 'unresolved') {
    return { kind: 'unresolved' };
  }
  return 'redirectTo' in scripted
    ? { kind: 'answered', status: FOUND, location: scripted.redirectTo }
    : { kind: 'answered', status: scripted.status, location: null };
}

/** A fresh fake link check, with no answer scripted (module map §5, IMP-17). */
export function createFakeLinkCheck(): FakeLinkCheck {
  const answers = new Map<string, ScriptedAnswer>();
  return {
    probe: async (ctx, request) =>
      probeThrough(
        (address) => hopAnswer(answers.get(address.href) ?? { status: OK }),
        ctx,
        request,
      ),
    answer: (url, scripted) => {
      answers.set(new URL(url).href, scripted);
    },
    reset: () => {
      answers.clear();
    },
  };
}
