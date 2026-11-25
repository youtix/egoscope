import { guardScreen, paths } from '@/lib/navigation';
import { PageHeader } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import type { ReactNode } from 'react';

/**
 * The placeholder of a screen of module map section 3.3, until its task replaces it:
 * /help.
 */
export default async function HelpPage(): Promise<ReactNode> {
  await guardScreen(paths.help());
  return <PageHeader title={sentence('interface.help')} />;
}
