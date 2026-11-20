// The placeholders of the glossary's labels and fixed sentences, such as {date} in
// "Imported on {date}", and their filling (glossary section 7). A value arrives already
// written for people, a number through the formatters of numbers.ts and a date through
// those of @/lib/time, so that no label ever formats one by itself (IHM-13). A noun that
// a count governs is written {k|case|cases}, its form for one and its plural: one
// template then reads "1 valid case" and "4 valid cases", and "0 valid cases" too
// (SEN-31, CL-SEN-15, CL-TEL-16).

/**
 * The names of the placeholders of a template: `'date'` of `'Imported on {date}'`, and
 * the count `'k'` that the noun `{k|case|cases}` agrees with.
 */
type Placeholders<T extends string> = T extends `${string}{${infer Inside}}${infer Rest}`
  ? (Inside extends `${infer Count}|${string}` ? Count : Inside) | Placeholders<Rest>
  : never;

/**
 * What a template needs besides its key: nothing when it has no placeholder,
 * otherwise one written value per placeholder.
 */
export type FillArgs<T extends string> = [Placeholders<T>] extends [never]
  ? []
  : [values: Readonly<Record<Placeholders<T>, string>>];

// A placeholder as the glossary writes them, {date}, {k}, {player}, or a noun that
// agrees with a count, {k|case|cases}: the count's name, then the noun's two forms.
const PLACEHOLDER = /\{(?<name>[A-Za-z]+)(?:\|(?<forms>[^{}|]+\|[^{}|]+))?\}/gu;
// The written count whose noun takes its form for one; every other count, 0 included,
// takes the plural.
const ONE = '1';
const FORMS_BAR = '|';

/** The form of a noun that agrees with `count`, from `forms`: "case" for "1" of "case|cases". */
function agreeing(count: string, forms: string): string {
  const bar = forms.indexOf(FORMS_BAR);
  return count === ONE ? forms.slice(0, bar) : forms.slice(bar + 1);
}

/**
 * The template with each placeholder replaced by its value, and each noun that a count
 * governs in the form that agrees with it (VUE-08, SEN-31, glossary section 7). A
 * placeholder without a value is a bug, which the types of `FillArgs` rule out.
 */
export function fill(
  template: string,
  [values]: readonly [Readonly<Record<string, string>>?],
): string {
  return template.replaceAll(
    PLACEHOLDER,
    (placeholder, name: string, forms: string | undefined) => {
      const value = values?.[name];
      if (value === undefined) {
        throw new Error(`"${template}" needs a value for ${placeholder}.`);
      }
      return forms === undefined ? value : agreeing(value, forms);
    },
  );
}
