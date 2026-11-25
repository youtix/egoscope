import Link from 'next/link';

import { sentence } from '@/lib/wording';

import type { Route } from 'next';
import type { ReactNode } from 'react';

export type MethodNoticeProps<T extends string> = Readonly<{
  /** The page of Method and limits: the screen passes the path that the navigation module gives. */
  href: Route<T>;
}>;

/**
 * The short notice of the profile and validation screens, "A measure of the past, an
 * unproven hypothesis, no betting recommendation", with its link to Method and
 * limits, to which `href` points (IHM-50, IHM-69). Its link is underlined, set apart by more than its color
 * (IHM-61).
 */
export function MethodNotice<T extends string>({ href }: MethodNoticeProps<T>): ReactNode {
  return (
    <p className="flex flex-wrap gap-x-3 text-sm text-ink-muted">
      <span>{sentence('interface.shortNotice')}</span>
      <Link
        href={href}
        className="font-medium text-accent underline underline-offset-4 hover:decoration-2"
      >
        {sentence('interface.methodAndLimits')}
      </Link>
    </p>
  );
}
