import { guardScreen, paths } from '@/lib/navigation';
import { PageHeader } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import type { ReactNode } from 'react';

/**
 * The placeholder of a screen of module map section 3.3, until its task replaces it:
 * /types/[typeId]/edit.
 */
export default async function EditTypeSheetPage({
  params,
}: Readonly<PageProps<'/types/[typeId]/edit'>>): Promise<ReactNode> {
  const { typeId } = await params;
  await guardScreen(paths.editTypeSheet(typeId));
  return <PageHeader title={sentence('interface.editTypeSheet')} />;
}
