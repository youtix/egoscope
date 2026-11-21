import { useId } from 'react';

import { PageHeader } from '@/lib/ui';

import { ButtonSamples, NoticeSamples, TextSamples } from './action-samples';
import { BlockSamples, ListSamples } from './content-samples';
import { DialogSamples, PasteSample } from './dialog-samples';
import { ChangedElsewhereSample, FieldsSample } from './form-samples';

import type { ReactNode } from 'react';

type SectionProps = Readonly<{ title: string; children: ReactNode }>;

/** One part of the gallery, titled, so that a screen reader can jump between them. */
function Section({ title, children }: SectionProps): ReactNode {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <h2 id={titleId} className="text-xl font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * The gallery of the design system: every component of `@/lib/ui` in each of its
 * states, for people to look at and for the end-to-end accessibility check in both
 * themes (IHM-60 to IHM-63). Its texts are samples, never the app's.
 */
export function Gallery(): ReactNode {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-8">
      <PageHeader
        title="Component gallery"
        description="Every component of the design system, in each of its states."
      />
      <Section title="Actions">
        <ButtonSamples />
      </Section>
      <Section title="Long texts, copy and share">
        <TextSamples />
      </Section>
      <Section title="Fields">
        <FieldsSample />
      </Section>
      <Section title="Changed elsewhere">
        <ChangedElsewhereSample />
      </Section>
      <Section title="Paste area">
        <PasteSample />
      </Section>
      <Section title="Dialogs">
        <DialogSamples />
      </Section>
      <Section title="Notices">
        <NoticeSamples />
      </Section>
      <Section title="Blocks">
        <BlockSamples />
      </Section>
      <Section title="Lists">
        <ListSamples />
      </Section>
    </main>
  );
}
