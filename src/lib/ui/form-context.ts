'use client';

import { createContext, use } from 'react';

/** The error of each field that a submission refused, by field name, in the order of the fields. */
export type FieldErrors = Readonly<Record<string, string>>;

/** What a form tells the fields inside it. */
type FormState = Readonly<{
  /**
   * The identifier of the form element, which also prefixes those of its controls,
   * so that its error summary links to them and a confirmation submits it.
   */
  formId: string;
  errors: FieldErrors;
}>;

/** The form around a field, when there is one. */
export const FormContext = createContext<FormState | undefined>(undefined);

/** What a field tells the one control it labels. */
export type FieldControl = Readonly<{
  id: string;
  name: string;
  required: boolean;
  invalid: boolean;
  /** The identifiers of the hint and the error that describe the control, when it has any. */
  describedBy: string | undefined;
}>;

/** The field around a control. */
export const FieldContext = createContext<FieldControl | undefined>(undefined);

/** The identifier of the control named `name` in the form whose identifier is `formId`. */
export function controlId(formId: string, name: string): string {
  return `${formId}-${name}`;
}

/**
 * The identifier of the control named `name`: in a form, one that its error
 * summary can link to; elsewhere, `ownId`, unique on the page.
 */
export function useControlId(name: string, ownId: string): string {
  const form = use(FormContext);
  return form === undefined ? ownId : controlId(form.formId, name);
}

/** The error that the form around a field holds for the field named `name`, if any. */
export function useFieldError(name: string): string | undefined {
  return use(FormContext)?.errors[name];
}

/** The identifiers of the texts that describe a control, those it has, or nothing. */
export function describedBy(...ids: readonly (string | false)[]): string | undefined {
  const present = ids.filter((id) => id !== false);
  return present.length === 0 ? undefined : present.join(' ');
}

/** The attributes that tie a control to its field: its name, its label, its description and its state. */
export type ControlAttributes = Readonly<{
  id: string;
  name: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  'aria-required': true | undefined;
}>;

/**
 * The attributes that the field around a control gives it. A control outside a
 * field has no label, which is a bug: every control is labeled (IHM-62).
 */
export function useFieldControl(component: string): ControlAttributes {
  const control = use(FieldContext);
  if (control === undefined) {
    throw new Error(`${component} renders only inside a FormField, which labels it.`);
  }
  return {
    id: control.id,
    name: control.name,
    'aria-describedby': control.describedBy,
    'aria-invalid': control.invalid || undefined,
    'aria-required': control.required || undefined,
  };
}
