// Expected failures are values, never thrown (module map, rule 8): a service returns a
// Result, and its caller decides what each failure means. Ports keep their own outcome
// types, with the metadata of their calls.

/** A success, with what the operation produced. */
export type Ok<T> = Readonly<{ ok: true; value: T }>;

/** An expected failure, with what went wrong. */
export type Err<E> = Readonly<{ ok: false; error: E }>;

/** What a service returns: a success with its value, or an expected failure with its error. */
export type Result<T, E> = Ok<T> | Err<E>;

/** A success that carries `value` (module map, rule 8). */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/** An expected failure that carries `error`, which the caller handles: never thrown (rule 8). */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/** Says whether `result` is a success, narrowing it to its value (rule 8). */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

/**
 * The success of `result` with its value turned by `map`, and a failure as it is: the
 * error goes on to the caller untouched (rule 8).
 */
export function mapResult<T, U, E>(result: Result<T, E>, map: (value: T) => U): Result<U, E> {
  return result.ok ? ok(map(result.value)) : result;
}
