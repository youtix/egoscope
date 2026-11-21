'use client';

import { CONTROL_CLASSES } from './control-styles';
import { useFieldControl } from './form-context';
import { ChevronIcon } from './icons';

import type { ReactNode } from 'react';

/** One choice of a list: the value sent, and the words shown. */
export type SelectOption = Readonly<{ value: string; label: string }>;

export type SelectProps = Readonly<{
  options: readonly SelectOption[];
  /** The value chosen at first, such as the one stored. */
  defaultValue?: string;
}>;

/**
 * A choice in a list, the phone's own picker, labeled and described by the
 * FormField around it (IHM-62).
 */
export function Select({ options, defaultValue }: SelectProps): ReactNode {
  const control = useFieldControl('Select');
  return (
    <div className="relative">
      <select
        {...control}
        defaultValue={defaultValue}
        className={`${CONTROL_CLASSES} appearance-none pr-10`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-ink-muted">
        <ChevronIcon />
      </span>
    </div>
  );
}
