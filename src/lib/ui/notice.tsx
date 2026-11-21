import { cx } from './class-names';
import { ToneIcon } from './icons';
import { TONE_CLASSES } from './tone';

import type { Tone } from './tone';
import type { ReactNode } from 'react';

export type NoticeProps = Readonly<{
  /** `danger` for a failure, which screen readers announce at once; the others wait their turn. */
  tone: Exclude<Tone, 'neutral'>;
  /** The result, written in full; nothing while there is none to tell. */
  message: string | undefined;
}>;

/**
 * The result of an action, where the action was taken: saved, refused, copied.
 * Render it before any result, with no message: screen readers announce the
 * changes of a region that was already there, so the message is heard when it
 * comes, and the empty region takes no room. The message says the result in
 * words, which its tone's color and icon only add to (IHM-61).
 */
export function Notice({ tone, message }: NoticeProps): ReactNode {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx(
        message !== undefined &&
          `flex items-start gap-2 rounded-xl border-2 p-4 ${TONE_CLASSES[tone]}`,
      )}
    >
      {message !== undefined && (
        <>
          <ToneIcon tone={tone} />
          <p className="min-w-0">{message}</p>
        </>
      )}
    </div>
  );
}
