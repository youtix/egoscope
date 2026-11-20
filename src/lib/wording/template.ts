// The placeholders of the glossary's labels and fixed sentences, such as {date} in
// "Imported on {date}", and their filling (glossary section 7). A value arrives already
// written for people, a number through the formatters of numbers.ts and a date through
// those of @/lib/time, so that no label ever formats one by itself (IHM-13).

/** The names of the placeholders of a template: `'date'` of `'Imported on {date}'`. */
type Placeholders<T extends string> = T extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never;

/**
 * What a template needs besides its key: nothing when it has no placeholder,
 * otherwise one written value per placeholder.
 */
export type FillArgs<T extends string> = [Placeholders<T>] extends [never]
  ? []
  : [values: Readonly<Record<Placeholders<T>, string>>];

// A placeholder as the glossary writes them: {date}, {k}, {player}.
const PLACEHOLDER = /\{(?<name>[A-Za-z]+)\}/gu;

/**
 * The template with each placeholder replaced by its value (glossary section 7). A
 * placeholder without a value is a bug, which the types of `FillArgs` rule out.
 */
export function fill(
  template: string,
  [values]: readonly [Readonly<Record<string, string>>?],
): string {
  return template.replaceAll(PLACEHOLDER, (placeholder, name: string) => {
    const value = values?.[name];
    if (value === undefined) {
      throw new Error(`"${template}" needs a value for ${placeholder}.`);
    }
    return value;
  });
}
