'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { formatDate, toZoned } from '@/lib/time';
import { Banner } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import { useOnlineStatus } from './online-status';
import { copyDate } from './screen-copies';

import type { EpochMs } from '@/lib/time';
import type { ReactNode } from 'react';

export type OfflineBannerProps = Readonly<{
  /** The `display.timeZone` setting, in which the date of the copy is written. */
  timeZone: string;
}>;

/** What the banner says of the screen shown: the date of its copy, or that it has none. */
function offlineMessage(copiedAt: EpochMs | null, timeZone: string): string {
  if (copiedAt === null) {
    return sentence('interface.offlineWithoutCopy');
  }
  const { on, time } = toZoned(copiedAt, timeZone);
  return sentence('interface.offlineCopyFrom', { date: formatDate(on), time });
}

/**
 * The banner of a device without connection (IHM-57): "Offline — data from Thu 26 Nov
 * 2026 at 14:03" over a screen whose copy the device keeps, the date of that copy in the
 * owner's zone, or that the screen is not available offline. Online, it shows nothing.
 */
export function OfflineBanner({ timeZone }: OfflineBannerProps): ReactNode {
  const mode = useOnlineStatus();
  const pathname = usePathname();
  const [copy, setCopy] = useState<Readonly<{ pathname: string; copiedAt: EpochMs | null }>>();

  useEffect(() => {
    // Whether the screen whose copy is read is still the one shown.
    let isShown = true;
    const read = async () => {
      const copiedAt = await copyDate(location.href);
      if (isShown) {
        setCopy({ pathname, copiedAt });
      }
    };
    if (mode === 'offline') {
      void read();
    }
    return () => {
      isShown = false;
    };
  }, [mode, pathname]);

  return mode === 'online' || copy?.pathname !== pathname ? null : (
    <Banner tone="warning" message={offlineMessage(copy.copiedAt, timeZone)} />
  );
}
