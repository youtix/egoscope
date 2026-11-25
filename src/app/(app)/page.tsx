import { guardScreen, paths } from '@/lib/navigation';
import { PageHeader } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import type { ReactNode } from 'react';

/**
 * The placeholder of a screen of module map section 3.3, until its task replaces it:
 * /.
 */
export default async function HomePage(): Promise<ReactNode> {
  await guardScreen(paths.home());
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={sentence('interface.home')}
        // --- Slot: the statement of the zone in use, "Times in Paris time" (CL-IHM-04),
        // a description that this page's area writes
      />
      {/* --- Slot: in-progress-banner.tsx, which the backtest-import area adds --- */}

      {/* --- Slot: system-banners.tsx, which the interface area adds --- */}

      {/* --- Slot: todo-list.tsx, which the interface area adds --- */}

      {/* --- Slot: open-alerts.tsx (Lot 2), which the alerts-tracking-telegram area adds --- */}

      {/* --- Slot: last-updates.tsx, which the interface area adds --- */}

      {/* --- Slot: first-launch.tsx, which the interface area adds --- */}
    </div>
  );
}
