import { ToneIcon } from './icons';
import { TONE_CLASSES } from './tone';

import type { ReactNode } from 'react';

export type ChangedElsewhereNoticeProps = Readonly<{
  title: string;
  /** Why the save was refused: the object changed meanwhile on another device or by a scheduled task. */
  message: string;
  /** The heading of the current version. */
  currentVersionTitle: string;
  /** The current version of the object, as the screen shows it, such as a DefinitionList. */
  children: ReactNode;
}>;

/**
 * What a Form shows when its save was refused because the object changed
 * meanwhile, on another device or by a scheduled task: the message and the current
 * version, beside the owner's input, which the Form keeps so that it can be
 * applied again (CL-IHM-18). Screen readers announce it when it appears.
 */
export function ChangedElsewhereNotice({
  title,
  message,
  currentVersionTitle,
  children,
}: ChangedElsewhereNoticeProps): ReactNode {
  return (
    <div role="alert" className={`flex gap-3 rounded-xl border-2 p-4 ${TONE_CLASSES.warning}`}>
      <ToneIcon tone="warning" />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <h2 className="text-lg leading-snug font-semibold">{title}</h2>
        <p>{message}</p>
        <h3 className="font-semibold">{currentVersionTitle}</h3>
        <div className="rounded-lg bg-surface p-3 text-ink">{children}</div>
      </div>
    </div>
  );
}
