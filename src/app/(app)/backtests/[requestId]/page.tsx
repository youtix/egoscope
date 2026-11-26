import { guardScreen, paths } from '@/lib/navigation';
import { PageHeader } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import type { ReactNode } from 'react';

/**
 * The placeholder of a screen of module map section 3.3, until its task replaces it:
 * /backtests/[requestId].
 */
export default async function RequestPage({
  params,
}: Readonly<PageProps<'/backtests/[requestId]'>>): Promise<ReactNode> {
  const { requestId } = await params;
  await guardScreen(paths.request(Number(requestId)));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={sentence('interface.request')}
        // --- Slot: the statement of the zone in use, "Times in Paris time" (CL-IHM-04),
        // a description that this page's area writes
      />
      {/* --- Slot: request-block.tsx, which the backtest-import area adds --- */}

      {/* --- Slot: prompt-block.tsx, which the backtest-import area adds --- */}

      {/* --- Slot: attached-events-block.tsx (Lot 2), which the backtest-import area adds --- */}
    </div>
  );
}
