import { guardScreen, paths } from '@/lib/navigation';
import { PageHeader } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import { EventsBlock } from './events-block';

import type { ReactNode } from 'react';

/**
 * The placeholder of a screen of module map section 3.3, until its task replaces it:
 * /players/[playerId].
 */
export default async function PlayerPage({
  params,
}: Readonly<PageProps<'/players/[playerId]'>>): Promise<ReactNode> {
  const { playerId } = await params;
  await guardScreen(paths.player(playerId));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={sentence('interface.playerPage')}
        // --- Slot: the statement of the zone in use, "Times in Paris time" (CL-IHM-04),
        // a description that this page's area writes
      />
      {/* --- Slot: identity-block.tsx, which the players-taxonomy area adds --- */}

      {/* --- Slot: games-block.tsx, which the statistics-sensitivity area adds --- */}

      {/* --- Slot: backtest-block.tsx, which the backtest-import area adds --- */}

      {/* --- Slot: profiles-block.tsx, which the statistics-sensitivity area adds --- */}

      <EventsBlock playerId={playerId} />

      {/* --- Slot: detected-block.tsx (Lot 2), which the collection-detection area adds --- */}

      {/* --- Slot: alerts-block.tsx (Lot 2), which the alerts-tracking-telegram area adds --- */}

      {/* --- Slot: tracking-block.tsx (Lot 2), which the alerts-tracking-telegram area adds --- */}
    </div>
  );
}
