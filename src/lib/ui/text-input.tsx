'use client';

import { CONTROL_CLASSES } from './control-styles';
import { useFieldControl } from './form-context';

import type { ComponentProps, ReactNode } from 'react';

type InputAttributes = ComponentProps<'input'>;

export type TextInputProps = Readonly<{
  /** The kind of text, which picks the phone's keyboard. */
  type?: 'text' | 'search' | 'url' | 'email' | 'tel';
  /** The value the field starts with, such as the one stored. */
  defaultValue?: string;
  /** What the phone or a password manager may fill the field with. */
  autoComplete?: InputAttributes['autoComplete'];
  /** The phone keyboard for the value, such as `decimal` for a parameter. */
  inputMode?: InputAttributes['inputMode'];
  /** The word on the Enter key of the phone keyboard. */
  enterKeyHint?: InputAttributes['enterKeyHint'];
}>;

/** A one-line text field, labeled and described by the FormField around it (IHM-62). */
export function TextInput({
  type = 'text',
  defaultValue,
  autoComplete,
  inputMode,
  enterKeyHint,
}: TextInputProps): ReactNode {
  const control = useFieldControl('TextInput');
  return (
    <input
      {...control}
      type={type}
      defaultValue={defaultValue}
      autoComplete={autoComplete}
      inputMode={inputMode}
      enterKeyHint={enterKeyHint}
      className={CONTROL_CLASSES}
    />
  );
}
