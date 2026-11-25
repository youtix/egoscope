import { guardScreen, paths } from '@/lib/navigation';
import { PageHeader } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import type { ReactNode } from 'react';

/**
 * The placeholder of a screen of module map section 3.3, until its task replaces it:
 * /players/[playerId]/edit.
 */
export default async function EditIdentityPage({
  params,
}: Readonly<PageProps<'/players/[playerId]/edit'>>): Promise<ReactNode> {
  const { playerId } = await params;
  await guardScreen(paths.editPlayer(playerId));
  return <PageHeader title={sentence('interface.editIdentity')} />;
}
