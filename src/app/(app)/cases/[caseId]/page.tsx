import { guardScreen, paths } from '@/lib/navigation';
import { PageHeader } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import { CaseBlock, caseZoneStatement } from './case-block';

import type { ReactNode } from 'react';

/**
 * The case detail, /cases/[caseId] (module map section 3.3, IHM-25): the statement of the
 * zone its times are written in (CL-IHM-04), then its blocks.
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
        description={await caseZoneStatement()}
      />
      <CaseBlock caseId={caseId} />

      {/* --- Slot: tracking-block.tsx (Lot 2), which the alerts-tracking-telegram area adds --- */}
    </div>
  );
}
