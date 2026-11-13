const MASK = '[secret]';

/**
 * A configuration value that is never logged, displayed or exported (TRV-64):
 * it prints and serializes as "[secret]", and only `reveal()` hands out the
 * value, to the one call that needs it, such as opening a connection.
 */
export class Secret {
  readonly #value: string;

  /** Holds `value` out of every printed or serialized form (TRV-64). */
  constructor(value: string) {
    this.#value = value;
  }

  /** The value itself, for the one call that needs it (TRV-64). */
  reveal(): string {
    return this.#value;
  }

  /** The mask, so that string templates never print the value (TRV-64). */
  toString(): string {
    return MASK;
  }

  /** The mask, so that serialized configuration never carries the value (TRV-64). */
  toJSON(): string {
    return MASK;
  }
}
