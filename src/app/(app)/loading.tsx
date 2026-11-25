import { Skeleton } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import type { ReactNode } from 'react';

/** What a screen shows while it checks the session and reads its data (IHM-60). */
export default function ScreenLoading(): ReactNode {
  return <Skeleton label={sentence('interface.loadingScreen')} />;
}
