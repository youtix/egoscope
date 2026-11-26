import { guardScreen, paths } from '@/lib/navigation';
import { PageHeader } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import type { ReactNode } from 'react';

/**
 * The placeholder of a screen of module map section 3.3, until its task replaces it:
 * /players/[playerId]/profiles/[typeId].
 */
export default async function ProfileDetailPage({
  params,
}: Readonly<PageProps<'/players/[playerId]/profiles/[typeId]'>>): Promise<ReactNode> {
  const { playerId, typeId } = await params;
  await guardScreen(paths.profile(playerId, typeId));
  return <PageHeader title={sentence('interface.profileDetail')} />;
}
