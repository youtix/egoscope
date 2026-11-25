import { Suspense } from 'react';

import { Skeleton } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import { ChoosePasswordScreen } from './choose-password-screen';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: sentence('interface.choosePassword') };

/** /choose-password, which needs a session still on the initial password (module map §3.5). */
export default function ChoosePasswordPage({
  searchParams,
}: Readonly<PageProps<'/choose-password'>>): ReactNode {
  return (
    <Suspense fallback={<Skeleton label={sentence('interface.checkingSession')} />}>
      <ChoosePasswordScreen query={searchParams} />
    </Suspense>
  );
}
