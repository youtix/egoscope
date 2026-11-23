import Link from 'next/link';

import { buttonClasses } from './button-styles';

import type { ButtonVariant } from './button-styles';
import type { Route } from 'next';
import type { ReactNode } from 'react';

/** Where a link leads: a route of the app, checked against the routes that exist, or an outside address. */
export type Href<T extends string> = Route<T> | URL;

type AppLinkProps<T extends string> = Readonly<{
  href: Href<T>;
  className: string;
  children: ReactNode;
}>;

/** A link to a route of the app, prefetched by Next.js, or a plain one to an outside address. */
function AppLink<T extends string>({ href, className, children }: AppLinkProps<T>): ReactNode {
  return href instanceof URL ? (
    <a href={href.href} className={className}>
      {children}
    </a>
  ) : (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

export type LinkButtonProps<T extends string> = Readonly<{
  href: Href<T>;
  /** The visible text, which is also the name that screen readers say (IHM-62). */
  label: string;
  variant?: ButtonVariant;
}>;

/**
 * A link that looks like a button, for an action that opens another screen: named
 * by its visible label (IHM-62), on a target a thumb hits comfortably (IHM-61).
 */
export function LinkButton<T extends string>({
  href,
  label,
  variant = 'secondary',
}: LinkButtonProps<T>): ReactNode {
  return (
    <AppLink href={href} className={buttonClasses(variant)}>
      {label}
    </AppLink>
  );
}

export type TextLinkProps<T extends string> = Readonly<{
  href: Href<T>;
  /** The visible text, which is also the name that screen readers say (IHM-62). */
  label: string;
}>;

/**
 * A link inside text, to the screen of a cited object (IHM-17) or to an outside
 * source: underlined, so that it differs from the text around it by more than its
 * color (IHM-61).
 */
export function TextLink<T extends string>({ href, label }: TextLinkProps<T>): ReactNode {
  return (
    <AppLink
      href={href}
      className="font-medium text-accent underline underline-offset-4 hover:decoration-2"
    >
      {label}
    </AppLink>
  );
}
