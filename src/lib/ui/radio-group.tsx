'use client';

import { useId } from 'react';

import { FieldError } from './field-error';
import { describedBy, useControlId, useFieldError } from './form-context';

import type { SelectOption } from './select';
import type { ReactNode } from 'react';

export type RadioGroupProps = Readonly<{
  /** The name under which the chosen value is sent, and under which the form gives the group's error. */
  name: string;
  /** The question that the choices answer. */
  legend: string;
  hint?: string;
  /** The words that mark a required choice beside the legend; when given, a choice is required. */
  requiredMark?: string;
  options: readonly SelectOption[];
  /** The value chosen at first, such as the one stored. */
  defaultValue?: string;
}>;

/**
 * One choice among a few, all shown at once: a group named by its legend and
 * described by its hint and its error, whose choices a tap on their words also
 * picks, on targets a thumb hits comfortably (IHM-61, IHM-62). The arrow keys move
 * between the choices, as the browser does for every group of radio buttons.
 */
export function RadioGroup({
  name,
  legend,
  hint,
  requiredMark,
  options,
  defaultValue,
}: RadioGroupProps): ReactNode {
  // The first choice carries the group's identifier, which the error summary links to.
  const id = useControlId(name, useId());
  const error = useFieldError(name);
  const legendId = `${id}-legend`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div
      role="radiogroup"
      aria-labelledby={legendId}
      aria-describedby={describedBy(hint !== undefined && hintId, error !== undefined && errorId)}
      aria-invalid={error !== undefined || undefined}
      aria-required={requiredMark !== undefined || undefined}
      className="flex flex-col gap-1.5"
    >
      <p id={legendId} className="leading-snug font-medium">
        {legend}
        {requiredMark !== undefined && (
          // The group says that it is required to screen readers; the mark is for the eye.
          <span aria-hidden="true" className="font-normal text-ink-muted">
            {` ${requiredMark}`}
          </span>
        )}
      </p>
      {hint !== undefined && (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {error !== undefined && <FieldError id={errorId} message={error} />}
      {options.map((option, index) => (
        <label key={option.value} className="flex min-h-touch cursor-pointer items-center gap-3">
          <input
            id={index === 0 ? id : `${id}-${String(index)}`}
            type="radio"
            name={name}
            value={option.value}
            defaultChecked={option.value === defaultValue}
            className="size-6 shrink-0 cursor-pointer accent-accent"
          />
          <span className="leading-snug">{option.label}</span>
        </label>
      ))}
    </div>
  );
}
