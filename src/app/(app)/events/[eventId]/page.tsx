import { guardScreen, paths } from '@/lib/navigation';
import { PageHeader } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import type { ReactNode } from 'react';

/**
 * The placeholder of a screen of module map section 3.3, until its task replaces it:
 * /events/[eventId].
 */
export default async function EventPage({
  params,
}: Readonly<PageProps<'/events/[eventId]'>>): Promise<ReactNode> {
  const { eventId } = await params;
  await guardScreen(paths.event(Number(eventId)));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={sentence('interface.eventPage')}
        // --- Slot: the statement of the zone in use, "Times in Paris time" (CL-IHM-04),
        // a description that this page's area writes
      />
      {/* --- Slot: event-block.tsx, which the sensitive-crosscutting area adds --- */}

      {/* --- Slot: historical-block.tsx, which the backtest-import area adds --- */}

      {/* --- Slot: detected-block.tsx (Lot 2), which the collection-detection area adds --- */}
    </div>
  );
}
