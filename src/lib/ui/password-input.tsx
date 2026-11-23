'use client';

import { useState } from 'react';

import { buttonClasses } from './button-styles';
import { CONTROL_CLASSES } from './control-styles';
import { useFieldControl } from './form-context';

import type { ReactNode } from 'react';

export type PasswordInputProps = Readonly<{
  /**
   * What a password manager fills: the stored password at login, or a new one when
   * the owner chooses or changes it (IHM-06, IHM-09).
   */
  autoComplete: 'current-password' | 'new-password';
  /** The label of the toggle button that shows the password in clear, pressed while it does. */
  revealLabel: string;
}>;

/**
 * A password field that the owner can show in clear and that the phone's password
 * manager can fill (IHM-06), labeled by the FormField around it.
 */
export function PasswordInput({ autoComplete, revealLabel }: PasswordInputProps): ReactNode {
  const control = useFieldControl('PasswordInput');
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="flex flex-wrap items-stretch gap-2">
      <div className="min-w-0 flex-1 basis-48">
        <input
          {...control}
          type={revealed ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className={CONTROL_CLASSES}
        />
      </div>
      <button
        type="button"
        aria-controls={control.id}
        aria-pressed={revealed}
        className={buttonClasses('secondary')}
        onClick={() => setRevealed((shown) => !shown)}
      >
        {revealLabel}
      </button>
    </div>
  );
}
