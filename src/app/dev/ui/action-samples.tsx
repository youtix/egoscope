import {
  Badge,
  Banner,
  Button,
  CopyButton,
  LinkButton,
  LongText,
  Notice,
  ShareButton,
  StatusPill,
  TextLink,
} from '@/lib/ui';

import type { ReactNode } from 'react';

// An outside address, as the research tool's is (IHM-44).
const OUTSIDE = new URL('https://example.com/research');

// A long text with long lines and kept spacing, as a prompt or a pasted result has.
const SAMPLE_TEXT = [
  'You are a careful research assistant. Read the brief below, then answer in the format it gives.',
  '',
  '  {"format": "1.0", "items": [{"date": "2026-11-18", "summary": "A sample line that is long enough to wrap on a phone held upright."}]}',
  '',
  'Keep every source, and say what you could not check.',
  'A_single_token_without_any_space_that_would_push_the_column_sideways_if_it_did_not_break_anywhere',
].join('\n');

/** Every kind of action, in each of its states. */
export function ButtonSamples(): ReactNode {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <Button label="Main action" variant="primary" />
        <Button label="Other action" />
        <Button label="Erase" variant="danger" />
        <Button label="Later" variant="quiet" />
      </div>
      <Button label="Save" variant="primary" disabledReason="Saving needs a connection." />
      <div className="flex flex-wrap gap-3">
        <LinkButton href="/" label="Open Home" variant="primary" />
        <LinkButton href={OUTSIDE} label="Open the outside tool" />
      </div>
      <p>
        A link inside a sentence: <TextLink href="/" label="back to Home" />.
      </p>
    </div>
  );
}

/** A long text, folded and not, with the buttons that copy and share it. */
export function TextSamples(): ReactNode {
  return (
    <div className="flex flex-col gap-4">
      <LongText
        label="Folded text"
        text={SAMPLE_TEXT}
        id="sample-text"
        fold={{ showAllLabel: 'Show all', showLessLabel: 'Show less' }}
      />
      <div className="flex flex-wrap gap-3">
        <CopyButton
          text={SAMPLE_TEXT}
          label="Copy the text"
          copiedMessage="Text copied"
          fallbackMessage="Copy refused: the text is selected, copy it with a long press."
          selectTargetId="sample-text"
        />
        <ShareButton
          text={SAMPLE_TEXT}
          label="Share"
          copiedMessage="Text copied, to paste where you want"
          fallbackMessage="Copy refused: the text is selected, copy it with a long press."
          selectTargetId="sample-text"
        />
      </div>
      <LongText label="Unfolded text" text={SAMPLE_TEXT} />
    </div>
  );
}

/** Banners, notices, status pills and badges, in every tone. */
export function NoticeSamples(): ReactNode {
  return (
    <div className="flex flex-col gap-4">
      <Banner
        message="Sample in progress: started 12 min ago."
        actions={
          <>
            <LinkButton href="/" label="Open it" variant="primary" />
            <Button label="Later" variant="quiet" />
          </>
        }
      />
      <Banner tone="warning" message="Offline: the data shown is the last loaded." />
      <Notice tone="info" message="The sample is on its way." />
      <Notice tone="success" message="The sample is saved." />
      <Notice tone="warning" message="Three lines of the sample were left out." />
      <Notice tone="danger" message="The sample was refused." />
      <p className="flex flex-wrap gap-2">
        <StatusPill label="Neutral state" />
        <StatusPill label="Informative state" tone="info" />
        <StatusPill label="Finished state" tone="success" />
        <StatusPill label="State to watch" tone="warning" />
        <StatusPill label="Failed state" tone="danger" />
      </p>
      <p className="flex flex-wrap items-center gap-3">
        <span>
          Inbox <Badge label="3" spokenLabel="3 to do" />
        </span>
        <Badge label="New" />
      </p>
    </div>
  );
}
