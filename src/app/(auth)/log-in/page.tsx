import { Suspense } from 'react';

import { Skeleton } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import { LogInScreen } from './log-in-screen';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: sentence('interface.logIn') };

/**
 * /log-in, which answers without a session (CL-TRV-13): nothing of it shows before the
 * device's session is checked, so that a device whose session the owner ended erases its
 * data first (IHM-08).
 */
export default function LogInPage({ searchParams }: Readonly<PageProps<'/log-in'>>): ReactNode {
  return (
    <Suspense fallback={<Skeleton label={sentence('interface.checkingSession')} />}>
      <LogInScreen query={searchParams} />
    </Suspense>
  );
}
