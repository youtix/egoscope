import { guardScreen, paths } from '@/lib/navigation';
import { PageHeader } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import type { ReactNode } from 'react';

/**
 * The placeholder of a screen of module map section 3.3, until its task replaces it:
 * /types/[typeId].
 */
export default async function TypeSheetPage({
  params,
}: Readonly<PageProps<'/types/[typeId]'>>): Promise<ReactNode> {
  const { typeId } = await params;
  await guardScreen(paths.typeSheet(typeId));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={sentence('interface.typeSheet')}
        // --- Slot: the statement of the zone in use, "Times in Paris time" (CL-IHM-04),
        // a description that this page's area writes
      />
      {/* --- Slot: sheet-block.tsx, which the players-taxonomy area adds --- */}

      {/* --- Slot: versions-block.tsx, which the players-taxonomy area adds --- */}

      {/* --- Slot: trend-block.tsx, which the statistics-sensitivity area adds --- */}

      {/* --- Slot: occurrences-block.tsx (Lot 2), which the players-taxonomy area adds --- */}
    </div>
  );
}
