import { guardScreen, paths } from '@/lib/navigation';
import { PageHeader } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import type { ReactNode } from 'react';

/**
 * The placeholder of a screen of module map section 3.3, until its task replaces it:
 * /cases/[caseId].
 */
export default async function CaseDetailPage({
  params,
}: Readonly<PageProps<'/cases/[caseId]'>>): Promise<ReactNode> {
  const { caseId } = await params;
  await guardScreen(paths.case(Number(caseId)));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={sentence('interface.caseDetail')}
        // --- Slot: the statement of the zone in use, "Times in Paris time" (CL-IHM-04),
        // a description that this page's area writes
      />
      {/* --- Slot: case-block.tsx, which the statistics-sensitivity area adds --- */}

      {/* --- Slot: tracking-block.tsx (Lot 2), which the alerts-tracking-telegram area adds --- */}
    </div>
  );
}
