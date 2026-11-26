import { guardScreen, paths } from '@/lib/navigation';
import { PageHeader } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import type { ReactNode } from 'react';

/**
 * The placeholder of a screen of module map section 3.3, until its task replaces it:
 * /types/explore.
 */
export default async function ExploreNewTypesPage(): Promise<ReactNode> {
  await guardScreen(paths.exploreTypes());
  return <PageHeader title={sentence('interface.exploreNewTypes')} />;
}
