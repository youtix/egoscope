import { guardScreen, paths } from '@/lib/navigation';
import { PageHeader } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import type { ReactNode } from 'react';

/**
 * The placeholder of a screen of module map section 3.3, until its task replaces it:
 * /players/[playerId]/delete.
 */
export default async function DeletePlayerDataPage({
  params,
}: Readonly<PageProps<'/players/[playerId]/delete'>>): Promise<ReactNode> {
  const { playerId } = await params;
  await guardScreen(paths.deletePlayerData(playerId));
  return <PageHeader title={sentence('interface.deletePlayerData')} />;
}
