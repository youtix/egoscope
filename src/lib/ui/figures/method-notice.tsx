import Link from 'next/link';

import { sentence } from '@/lib/wording';

import type { ReactNode } from 'react';

// Method and limits (module map, section 3). The screen does not exist yet, so a typed
// route cannot name it: a URL object is the form of next/link that the route check
// leaves to the router.
const METHOD = { pathname: '/method' } as const;

/**
 * The short notice of the profile and validation screens, "A measure of the past, an
 * unproven hypothesis, no betting recommendation", with its link to Method and
 * limits (IHM-50, IHM-69). Its link is underlined, set apart by more than its color
 * (IHM-61).
 */
export function MethodNotice(): ReactNode {
  return (
    <p className="flex flex-wrap gap-x-3 text-sm text-ink-muted">
      <span>{sentence('interface.shortNotice')}</span>
      <Link
        href={METHOD}
        className="font-medium text-accent underline underline-offset-4 hover:decoration-2"
      >
        {sentence('interface.methodAndLimits')}
      </Link>
    </p>
  );
}
