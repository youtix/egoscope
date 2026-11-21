import type { ReactNode } from 'react';

export type BadgeProps = Readonly<{
  /** What the badge shows, such as a count that the wording module wrote. */
  label: string;
  /**
   * What screen readers say instead, when the label alone would be unclear beside
   * what it marks: "3 to do" for the count on the Home entry (IHM-16).
   */
  spokenLabel?: string;
}>;

/**
 * A short mark beside a label, such as the number of items to do on the Home
 * entry (IHM-16): a filled shape with the text in full, never cut (IHM-60), whose
 * meaning screen readers say in words (IHM-61).
 */
export function Badge({ label, spokenLabel }: BadgeProps): ReactNode {
  return (
    <span className="inline-flex min-w-[1.75em] items-center justify-center rounded-full bg-accent px-2 py-0.5 text-sm font-semibold text-on-accent tabular-nums">
      {spokenLabel === undefined ? (
        label
      ) : (
        <>
          <span aria-hidden="true">{label}</span>
          <span className="sr-only">{spokenLabel}</span>
        </>
      )}
    </span>
  );
}
