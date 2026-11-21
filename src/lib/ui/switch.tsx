'use client';

import { useId } from 'react';

import { useControlId } from './form-context';

import type { ReactNode } from 'react';

export type SwitchProps = Readonly<{
  /** The name under which the switch sends "on" when it is on. */
  name: string;
  label: string;
  /** A sentence under the label that says what the switch turns on. */
  hint?: string;
  defaultChecked?: boolean;
}>;

/**
 * A switch that turns a setting on or off, which screen readers announce as a
 * switch with its state: on and off differ by the place of the knob, not only by
 * its color (IHM-61). A tap on its label also turns it.
 */
export function Switch({ name, label, hint, defaultChecked }: SwitchProps): ReactNode {
  const id = useControlId(name, useId());
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className="flex min-h-touch cursor-pointer items-center justify-between gap-4"
      >
        <span className="leading-snug">{label}</span>
        <span className="relative inline-flex h-8 w-14 shrink-0">
          <input
            id={id}
            name={name}
            type="checkbox"
            role="switch"
            defaultChecked={defaultChecked}
            aria-describedby={hint === undefined ? undefined : hintId}
            className="peer size-full cursor-pointer appearance-none rounded-full border-2 border-line-strong bg-surface-muted checked:border-accent checked:bg-accent"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1 left-1 size-6 rounded-full bg-ink-muted transition-transform peer-checked:translate-x-6 peer-checked:bg-on-accent"
          />
        </span>
      </label>
      {hint !== undefined && (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
