'use client';

import { Button } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import { useOnlineStatus } from './online-status';

import type { ReactNode } from 'react';

export type OnlineOnlySubmitProps = Readonly<{
  /** The button's text, which starts with what the action does. */
  label: string;
  /** Why the action is not available online either, such as before any type is validated. */
  disabledReason?: string;
}>;

/**
 * The submit button, the main action, of a form whose action needs the server (IHM-58,
 * CL-IHM-14): offline, it is disabled and says why, so that the form sends nothing, not
 * even with the Enter key, and keeps what was typed; nothing is sent later, the owner
 * submitting again once the network returns (H-IHM-07).
 */
export function OnlineOnlySubmit({ label, disabledReason }: OnlineOnlySubmitProps): ReactNode {
  const isOffline = useOnlineStatus() === 'offline';
  const reason = isOffline ? sentence('interface.unavailableOffline') : disabledReason;
  return (
    <Button
      type="submit"
      label={label}
      variant="primary"
      {...(reason !== undefined && { disabledReason: reason })}
    />
  );
}
