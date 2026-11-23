'use client';

import { useActionState, useState } from 'react';

import { ConfirmDialog, Dialog, Form, FormField, Notice, PasteArea } from '@/lib/ui';

import type { ReactNode } from 'react';

// The largest file that the sample paste area reads, in bytes: 64 KiB.
const MAX_FILE_BYTES = 65_536;

// The second question of the confirmation asked twice.
const SECOND_QUESTION = {
  title: 'Erase for good?',
  description: 'Nothing can bring the sample back.',
  confirmLabel: 'Erase for good',
};

type ConfirmationProps = Readonly<{ twice: boolean }>;

/**
 * A form guarded by a confirmation, asked once or twice, which says when the
 * sample action ran.
 */
function ConfirmationSample({ twice }: ConfirmationProps): ReactNode {
  const [done, dispatch] = useActionState(
    (): string | undefined => (twice ? 'The sample is erased.' : 'The sample is archived.'),
    undefined,
  );
  return (
    <Form action={dispatch} errorSummaryTitle="The sample action did not run">
      <ConfirmDialog
        triggerLabel={twice ? 'Erase the sample' : 'Archive the sample'}
        variant={twice ? 'danger' : 'primary'}
        title={twice ? 'Erase the sample?' : 'Archive the sample?'}
        description={
          twice ? 'Its notes and its history disappear.' : 'It moves to the archived samples.'
        }
        confirmLabel={twice ? 'Continue' : 'Archive'}
        cancelLabel="Keep it"
        {...(twice ? { secondStep: SECOND_QUESTION } : {})}
      >
        {twice && (
          <ul className="list-disc pl-5">
            <li>Its notes</li>
            <li>Its history</li>
          </ul>
        )}
      </ConfirmDialog>
      <Notice tone="success" message={done} />
    </Form>
  );
}

/** A dialog, and the confirmations asked once and twice. */
export function DialogSamples(): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <Dialog
        triggerLabel="Open the dialog"
        title="A sample dialog"
        description="It holds the focus until it closes."
        closeLabel="Close"
      >
        <p>Escape closes it too, and the focus returns to the button that opened it.</p>
      </Dialog>
      <ConfirmationSample twice={false} />
      <ConfirmationSample twice />
    </div>
  );
}

/** The paste area, its text kept by the sample screen as a draft would be. */
export function PasteSample(): ReactNode {
  const [text, setText] = useState('');
  return (
    <FormField name="pasted" label="Pasted text" hint="Paste a JSON text, or pick a text file.">
      <PasteArea
        value={text}
        onValueChange={setText}
        pasteLabel="Paste"
        pasteRefusedMessage="Paste refused: hold a finger on the area, then choose Paste."
        fileLabel="Choose a text file"
        maxFileBytes={MAX_FILE_BYTES}
        fileTooLargeMessage="This file is larger than 64 KiB."
        fileUnreadableMessage="This file cannot be read as text."
      />
    </FormField>
  );
}
