import { ToneIcon } from './icons';

import type { ReactNode } from 'react';

type FieldErrorProps = Readonly<{ id: string; message: string }>;

/**
 * The error of a field, above its control and named in the control's description,
 * written in words with an icon, never shown by a red border alone (IHM-61).
 */
export function FieldError({ id, message }: FieldErrorProps): ReactNode {
  return (
    <p id={id} className="flex items-start gap-1.5 font-medium text-danger">
      <ToneIcon tone="danger" />
      <span>{message}</span>
    </p>
  );
}
