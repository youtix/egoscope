import { guardScreen, paths } from '@/lib/navigation';
import { PageHeader } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import type { ReactNode } from 'react';

/**
 * The placeholder of a screen of module map section 3.3, until its task replaces it:
 * /types/[typeId]/validate.
 */
export default async function ValidationPage({
  params,
}: Readonly<PageProps<'/types/[typeId]/validate'>>): Promise<ReactNode> {
  const { typeId } = await params;
  await guardScreen(paths.validateType(typeId));
  return <PageHeader title={sentence('interface.validation')} />;
}
