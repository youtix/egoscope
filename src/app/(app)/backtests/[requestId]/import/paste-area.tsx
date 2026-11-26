'use client';

import { useState } from 'react';

import { checkPastedTextSize } from '@/lib/ai-exchange';
import { usePasteDraft } from '@/lib/device-drafts';
import { formatInstant } from '@/lib/time';
import { Button, ConfirmDialog, Form, FormField, Notice, PasteArea, Skeleton } from '@/lib/ui';
import { formatMegabytes, label, sentence } from '@/lib/wording';

import { TextReceived } from './text-received';

import type { DraftServer, PasteDraft } from '@/lib/device-drafts';
import type { FieldErrors } from '@/lib/ui';
import type { ReactNode } from 'react';

// The name under which the pasted text reaches the check action.
const TEXT_FIELD = 'text';
// A file is read up to this many times the limit, so that the field shows its text and the
// size message of the pasted text; a file beyond it is refused unread, with its size.
const FILE_READ_FACTOR = 10;
const BYTES_PER_MEGABYTE = 1_000_000;
const SKELETON_LINES = 4;

export type ResearchResultPasteAreaProps = Readonly<{
  /** The backtest request whose result is pasted: its draft is keyed by it (IHM-42). */
  requestId: number;
  /** The route's Server Actions for drafts, which `usePasteDraft` calls (IHM-42). */
  server: DraftServer;
  /** The `imports.maxPastedTextMegabytes` parameter (CL-IMP-27). */
  maxMegabytes: number;
  /** The `display.timeZone` setting, in which the draft's last change is written. */
  timeZone: string;
  /** The Server Action that checks the text, which it receives as the `text` field (IMP-02). */
  checkAction: (formData: FormData) => void | Promise<void>;
  /** What the last check refused, by field (CL-IHM-18). */
  errors?: FieldErrors | undefined;
  message?: string | undefined;
}>;

/** The words that tell the state of the draft, if the screen holds one (IHM-28, IHM-42). */
function draftStatus(draft: PasteDraft, timeZone: string): string | undefined {
  if (draft.status === null || draft.updatedAt === null) {
    return undefined;
  }
  return draft.status === 'kept'
    ? label('ImportDraftStatus', 'kept', {
        time: formatInstant(draft.updatedAt, timeZone, 'short'),
      })
    : label('ImportDraftStatus', 'request_already_imported');
}

/** The discard of both copies of the draft, after two confirmations, since the text cannot be recovered (IHM-28, IHM-42, IHM-58). */
function DiscardDraft({ draft }: Readonly<{ draft: PasteDraft }>): ReactNode {
  const [message, setMessage] = useState<string | undefined>(undefined);
  const discard = async (): Promise<void> => {
    const outcome = await draft.discard();
    setMessage(outcome === 'discarded' ? undefined : sentence('imports.discardNeedsNetwork'));
  };
  return (
    <Form
      action={discard}
      message={message}
      errorSummaryTitle={sentence('imports.discardFailedTitle')}
    >
      <ConfirmDialog
        variant="danger"
        triggerLabel={sentence('imports.discardDraftButton')}
        title={sentence('imports.discardDraftTitle')}
        description={sentence('imports.discardDraftDescription')}
        confirmLabel={sentence('imports.discardDraftContinue')}
        cancelLabel={sentence('imports.keepDraft')}
        secondStep={{
          title: sentence('imports.discardDraftSecondTitle'),
          description: sentence('imports.discardDraftSecondDescription'),
          confirmLabel: sentence('imports.discardDraftForGood'),
        }}
      />
    </Form>
  );
}

/**
 * The paste area of the import screen (IMP-02): the field, kept as a draft on the device at
 * each change and on the server when online (IHM-42), the button that pastes the clipboard,
 * the picker of a text file, the characters received and the end of the text, and the
 * check, which waits while the text is empty or over the size limit in UTF-8 bytes
 * (CL-IMP-27). The text goes nowhere but into its draft and the check action. Render it
 * where the screen has no Form of its own: it holds the form of the check and that of the
 * discard.
 */
export function ResearchResultPasteArea({
  requestId,
  server,
  maxMegabytes,
  timeZone,
  checkAction,
  errors,
  message,
}: ResearchResultPasteAreaProps): ReactNode {
  const draft = usePasteDraft({ kind: 'research_result', requestId }, server);
  if (!draft.ready) {
    return <Skeleton label={sentence('imports.loadingDraft')} lines={SKELETON_LINES} />;
  }
  const { text } = draft;
  const size = checkPastedTextSize(text, maxMegabytes);
  const sizeMessage = size.ok ? undefined : size.error.message;
  const checkWaits = text === '' ? sentence('imports.checkNeedsText') : sizeMessage;
  // The size message already shows under the disabled check; the server's refusal of
  // another text (CL-IMP-27 with a limit set differently there) shows on its own.
  const refusal = sizeMessage === undefined ? (draft.refusal ?? undefined) : undefined;
  const offlineDiscarded = draft.unsentDiscarded
    ? sentence('sensitiveData.offlineDraftsDiscarded')
    : undefined;
  return (
    <div className="flex flex-col gap-6">
      <Form
        action={checkAction}
        errors={errors}
        message={message}
        errorSummaryTitle={sentence('imports.checkFailedTitle')}
      >
        <FormField name={TEXT_FIELD} label={sentence('imports.pasteAreaLabel')}>
          <PasteArea
            value={text}
            onValueChange={draft.change}
            pasteLabel={sentence('imports.pasteButton')}
            pasteRefusedMessage={sentence('imports.clipboardRefused')}
            fileLabel={sentence('imports.chooseTextFile')}
            maxFileBytes={maxMegabytes * BYTES_PER_MEGABYTE * FILE_READ_FACTOR}
            fileTooLargeMessage={(sizeBytes) =>
              sentence('imports.fileTooLarge', {
                size: formatMegabytes(sizeBytes),
                limit: String(maxMegabytes),
              })
            }
            fileUnreadableMessage={sentence('imports.fileUnreadable')}
          />
        </FormField>
        <TextReceived text={text} />
        <Notice tone="danger" message={refusal} />
        <Notice tone="warning" message={offlineDiscarded} />
        <p className="text-sm text-ink-muted">{draftStatus(draft, timeZone)}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="primary"
            label={sentence('imports.checkButton')}
            {...(checkWaits === undefined ? {} : { disabledReason: checkWaits })}
          />
          {text !== '' && (
            <Button
              label={sentence('imports.clearButton')}
              onClick={() => {
                draft.change('');
              }}
            />
          )}
        </div>
      </Form>
      {draft.updatedAt !== null && <DiscardDraft draft={draft} />}
    </div>
  );
}
