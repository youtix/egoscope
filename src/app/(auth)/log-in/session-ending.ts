import { sentence } from '@/lib/wording';

import type { SessionEndReason } from '@/lib/auth';

// The ways a session ends, the glossary's SessionEndReason set.
const END_REASONS = [
  'expired',
  'logged_out',
  'password_changed',
  'reset',
  'restored',
] as const satisfies readonly SessionEndReason[];

/** Whether `ended` names one of the ways a session ends. */
function isEndReason(ended: unknown): ended is SessionEndReason {
  return END_REASONS.some((reason) => reason === ended);
}

/**
 * How the device's session ended, as the address of the login page says it once the
 * device has been told: one of the reasons of SessionEndReason, or null (IHM-08).
 */
export function endReasonOf(ended: unknown): SessionEndReason | null {
  return isEndReason(ended) ? ended : null;
}

/** What the login page tells a device about how its session ended: "Data restored" (CL-TRV-05). */
export function endedLabel(reason: SessionEndReason): string {
  switch (reason) {
    case 'expired': {
      return sentence('interface.endedExpired');
    }
    case 'logged_out': {
      return sentence('interface.endedLoggedOut');
    }
    case 'password_changed': {
      return sentence('interface.endedPasswordChanged');
    }
    case 'reset': {
      return sentence('interface.endedReset');
    }
    case 'restored': {
      return sentence('interface.endedRestored');
    }
  }
}
