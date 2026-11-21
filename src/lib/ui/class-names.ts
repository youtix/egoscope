/** A class name, or nothing where a condition left it out. */
type ClassPart = string | false | undefined;

/**
 * Joins the class names that a component's state selects, skipping those that a
 * condition left out: `cx('base', isOpen && 'open')`. Supports the components of
 * IHM-60 to IHM-63.
 */
export function cx(...parts: readonly ClassPart[]): string {
  return parts.filter((part) => typeof part === 'string' && part !== '').join(' ');
}
