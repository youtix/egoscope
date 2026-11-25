import { guardScreen, moreMenuEntries, paths } from '@/lib/navigation';
import { PageHeader } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import { MoreMenu } from './more-menu';

import type { ReactNode } from 'react';

/** More: the menu of the screens that the navigation bar does not hold (IHM-16). */
export default async function MorePage(): Promise<ReactNode> {
  await guardScreen(paths.more());
  return (
    <>
      <PageHeader title={sentence('interface.more')} />
      <MoreMenu entries={moreMenuEntries()} />
    </>
  );
}
