import { paths } from '@/lib/navigation';
import { LinkButton, PageHeader } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import type { ReactNode } from 'react';

/**
 * The page of an address that matches no route, a typo or an outdated link, outside the
 * shell and its navigation bar, with the way back to Home (IHM-16, CL-IHM-19).
 */
export default function NotFound(): ReactNode {
  return (
    <main className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 px-4 py-6 sm:px-6">
      <PageHeader
        title={sentence('interface.addressLeadsNowhere')}
        actions={<LinkButton href={paths.home()} label={sentence('interface.goToHome')} />}
      />
    </main>
  );
}
