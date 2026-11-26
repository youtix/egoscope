import { notFound } from 'next/navigation';

import { guardScreen, isLotActive, paths } from '@/lib/navigation';
import { PageHeader } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import type { ReactNode } from 'react';

/**
 * The placeholder of a screen of module map section 3.3, until its task replaces it:
 * /alerts/[sheetId]. A Lot 2 screen, not found while the lot is 1 (IHM-16).
 */
export default async function AlertSheetPage({
  params,
}: Readonly<PageProps<'/alerts/[sheetId]'>>): Promise<ReactNode> {
  if (!isLotActive(2)) {
    notFound();
  }
  const { sheetId } = await params;
  await guardScreen(paths.alertSheet(Number(sheetId)));
  return <PageHeader title={sentence('interface.alertSheet')} />;
}
