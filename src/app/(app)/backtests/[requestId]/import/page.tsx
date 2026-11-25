import { guardScreen, paths } from '@/lib/navigation';
import { PageHeader } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import type { ReactNode } from 'react';

/**
 * The placeholder of a screen of module map section 3.3, until its task replaces it:
 * /backtests/[requestId]/import.
 */
export default async function ImportPage({
  params,
}: Readonly<PageProps<'/backtests/[requestId]/import'>>): Promise<ReactNode> {
  const { requestId } = await params;
  await guardScreen(paths.importResult(Number(requestId)));
  return <PageHeader title={sentence('interface.importScreen')} />;
}
