import { guardScreen, paths } from '@/lib/navigation';
import { PageHeader } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import type { ReactNode } from 'react';

/**
 * The placeholder of a screen of module map section 3.3, until its task replaces it:
 * /journal, or /journal?entry=<id>, one entry, which a login keeps (IHM-10).
 */
export default async function ActivityJournalPage({
  searchParams,
}: Readonly<PageProps<'/journal'>>): Promise<ReactNode> {
  const { entry } = await searchParams;
  await guardScreen(typeof entry === 'string' ? paths.journal(Number(entry)) : paths.journal());
  return <PageHeader title={sentence('interface.activityJournal')} />;
}
