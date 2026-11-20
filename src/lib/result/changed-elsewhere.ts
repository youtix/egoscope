// The kind of the shared error that a save sent with a stale version returns.
const CHANGED_ELSEWHERE = 'changed_elsewhere';

/**
 * A save refused because the object changed since the screen showed it, on another
 * device or by a scheduled task, with its current version, which the form shows while it
 * keeps the owner's input so that it can be applied again (CL-IHM-18).
 */
export type ChangedElsewhere<C> = Readonly<{ kind: typeof CHANGED_ELSEWHERE; current: C }>;

/** The error of a save sent with a stale version, carrying the object as it now stands (CL-IHM-18). */
export function changedElsewhere<C>(current: C): ChangedElsewhere<C> {
  return { kind: CHANGED_ELSEWHERE, current };
}

/** Says whether `error` is the refusal of a stale save, whose current version the form shows (CL-IHM-18). */
export function isChangedElsewhere<C>(error: unknown): error is ChangedElsewhere<C> {
  return (
    typeof error === 'object' &&
    error !== null &&
    'kind' in error &&
    error.kind === CHANGED_ELSEWHERE &&
    'current' in error
  );
}
