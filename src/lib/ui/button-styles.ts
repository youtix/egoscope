import { cx } from './class-names';

/** How strongly an action stands out: the main one, another, a destructive one, or a quiet one. */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'quiet';

// A target that a thumb hits comfortably, whose label wraps instead of being cut
// and whose height grows with the text size of the phone (IHM-60, IHM-61).
const BASE =
  'inline-flex min-h-touch min-w-touch max-w-full items-center justify-center gap-2 rounded-lg border-2 px-4 py-2 text-center font-medium leading-snug';

const VARIANTS = {
  primary: 'border-transparent bg-accent text-on-accent hover:opacity-90',
  secondary: 'border-line-strong bg-surface text-ink hover:bg-surface-muted',
  danger: 'border-transparent bg-danger text-on-danger hover:opacity-90',
  quiet:
    'border-transparent bg-transparent text-accent underline underline-offset-4 hover:bg-surface-muted',
} as const satisfies Record<ButtonVariant, string>;

// Disabled and pending actions look unavailable; WCAG exempts them from contrast.
const UNAVAILABLE =
  'disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60';

/**
 * The classes of an action of `variant`, shared by buttons and by links that look
 * like buttons, so both look and size alike (IHM-61).
 */
export function buttonClasses(variant: ButtonVariant): string {
  return cx(BASE, VARIANTS[variant], UNAVAILABLE);
}
