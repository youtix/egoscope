import { ToneIcon } from './icons';
import { TONE_CLASSES } from './tone';

import type { ReactNode } from 'react';

export type BannerProps = Readonly<{
  /** `info` for news, `warning` for a state that limits the app, such as being offline. */
  tone?: 'info' | 'warning';
  /** What the banner says, written in full: the tone only adds a color and an icon (IHM-61). */
  message: string;
  /** The banner's actions: the button or link that it proposes, and "Later" when it can be hidden. */
  actions?: ReactNode;
}>;

/**
 * A notice about the whole page, at its top: being offline (IHM-57), a new
 * version to load (IHM-03), a backtest in progress (IHM-40). Screen readers
 * announce it when it appears; its actions wrap under its message on a phone.
 */
export function Banner({ tone = 'info', message, actions }: BannerProps): ReactNode {
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border-2 p-4 ${TONE_CLASSES[tone]}`}
    >
      <p className="flex min-w-0 flex-1 basis-60 items-start gap-2 font-medium">
        <ToneIcon tone={tone} />
        <span>{message}</span>
      </p>
      {actions !== undefined && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
