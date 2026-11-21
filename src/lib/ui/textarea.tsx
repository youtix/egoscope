'use client';

import { CONTROL_CLASSES } from './control-styles';
import { useFieldControl } from './form-context';

import type { ReactNode } from 'react';

// Enough lines for a comment or a reason, before the owner resizes the field.
const DEFAULT_ROWS = 4;

export type TextareaProps = Readonly<{
  /** The value the field starts with, such as the one stored. */
  defaultValue?: string;
  /** The number of lines the field shows before it scrolls. */
  rows?: number;
}>;

/**
 * A text field of several lines, which wraps its text (IHM-63), labeled and
 * described by the FormField around it (IHM-62).
 */
export function Textarea({ defaultValue, rows = DEFAULT_ROWS }: TextareaProps): ReactNode {
  const control = useFieldControl('Textarea');
  return (
    <textarea
      {...control}
      defaultValue={defaultValue}
      rows={rows}
      className={`${CONTROL_CLASSES} resize-y`}
    />
  );
}
