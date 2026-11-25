import { notFound } from 'next/navigation';

import { guardScreen, isLotActive, paths } from '@/lib/navigation';
import { PageHeader } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import type { ReactNode } from 'react';

/**
 * The placeholder of a screen of module map section 3.3, until its task replaces it:
 * /collection/sources/[sourceId]. A Lot 2 screen, not found while the lot is 1 (IHM-16).
 */
export default async function EditPressSourcePage({
  params,
}: Readonly<PageProps<'/collection/sources/[sourceId]'>>): Promise<ReactNode> {
  if (!isLotActive(2)) {
    notFound();
  }
  const { sourceId } = await params;
  await guardScreen(paths.pressSource(Number(sourceId)));
  return <PageHeader title={sentence('interface.editPressSource')} />;
}
