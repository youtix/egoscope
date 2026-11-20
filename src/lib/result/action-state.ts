import { isChangedElsewhere } from './changed-elsewhere';

import type { ChangedElsewhere } from './changed-elsewhere';
import type { Result } from './result';

/** The messages of a form's fields, by field name: what to fix in each. */
export type FieldErrors = Readonly<Partial<Record<string, readonly string[]>>>;

/**
 * What a Server Action returns to its form (module map, section 1.5): nothing yet, a
 * success, a failure with the messages of its fields, or the "changed elsewhere" notice
 * with the object's current version, while the form keeps the owner's input (CL-IHM-18).
 * Each answer carries one plain-language message.
 */
export type ActionState<C = never> =
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'succeeded'; message: string }>
  | Readonly<{ status: 'failed'; message: string; fieldErrors: FieldErrors }>
  | Readonly<{ status: 'changed_elsewhere'; message: string; current: C }>;

/** What a failure other than "changed elsewhere" says to the owner, and the fields it concerns. */
export type FailureMessage = Readonly<{ message: string; fieldErrors?: FieldErrors }>;

/** The plain-language messages of an action's answers, taken from `@/lib/wording`. */
export type ActionMessages<E> = Readonly<{
  succeeded: string;
  /** The notice of a save sent with a stale version (CL-IHM-18). */
  changedElsewhere: string;
  failed: (error: E) => FailureMessage;
}>;

/** No field to fix. */
const NO_FIELD_ERRORS: FieldErrors = {};

/**
 * The answer a form shows for the result of an action: its success message, the
 * "changed elsewhere" notice with the current version of the object for a stale save
 * (CL-IHM-18), or the message and field errors of any other failure.
 */
export function toActionState<T, E, C = never>(
  result: Result<T, E | ChangedElsewhere<C>>,
  messages: ActionMessages<E>,
): ActionState<C> {
  if (result.ok) {
    return { status: 'succeeded', message: messages.succeeded };
  }
  const { error } = result;
  if (isChangedElsewhere<C>(error)) {
    return {
      status: 'changed_elsewhere',
      message: messages.changedElsewhere,
      current: error.current,
    };
  }
  const failure = messages.failed(error);
  return {
    status: 'failed',
    message: failure.message,
    fieldErrors: failure.fieldErrors ?? NO_FIELD_ERRORS,
  };
}
