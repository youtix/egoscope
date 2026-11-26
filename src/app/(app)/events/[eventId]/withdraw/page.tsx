import { guardScreen, paths } from '@/lib/navigation';
import { PageHeader } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import type { ReactNode } from 'react';

/**
 * The placeholder of a screen of module map section 3.3, until its task replaces it:
 * /events/[eventId]/withdraw.
 */
export default async function WithdrawEventPage({
  params,
}: Readonly<PageProps<'/events/[eventId]/withdraw'>>): Promise<ReactNode> {
  const { eventId } = await params;
  await guardScreen(paths.withdrawEvent(Number(eventId)));
  return <PageHeader title={sentence('interface.withdrawEvent')} />;
}
