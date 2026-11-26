import { paths } from '@/lib/navigation';
import { LinkButton, PageHeader } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import type { ReactNode } from 'react';

/**
 * The one screen of an identifier that matches no object, whatever the object and the
 * cause, with a link to Home (CL-IHM-19), and of a Lot 2 route while the lot is 1 (IHM-16).
 */
export default function NotFound(): ReactNode {
  return (
    <PageHeader
      title={sentence('interface.itemNoLongerExists')}
      actions={<LinkButton href={paths.home()} label={sentence('interface.goToHome')} />}
    />
  );
}
