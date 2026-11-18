// The wording rules that the application checks by itself on a free text it stores,
// whoever wrote it (DSN-24, DSN-25): a maximum length (DSN-20) and no quotation mark
// (DSN-21). Only a reader can check the others, which the screens recall.

/**
 * Why a free text breaks a rule: it is longer than the maximum, both counted in code
 * points (`too_long`), or it holds a quotation mark, the first one of the text, which
 * messages name (`quotation_mark`).
 */
export type TextRuleBreach =
  | Readonly<{ kind: 'too_long'; length: number; maxLength: number }>
  | Readonly<{ kind: 'quotation_mark'; character: string }>;

/**
 * The length of a free text as the rules count it: its Unicode code points, leading
 * and trailing spaces left out (DSN-20, CL-IMP-26).
 */
export function textLength(text: string): number {
  // One code point, a line break included.
  return (text.trim().match(/./gsu) ?? []).length;
}

/**
 * Checks a free text against the maximum length it is given (DSN-20) and the
 * quotation-mark rule (DSN-21, DSN-24, DSN-25): its breaches, length first, or none.
 */
export function checkText(text: string, maxLength: number): readonly TextRuleBreach[] {
  const length = textLength(text);
  // The quotation marks of CL-DSN-03: the straight one, the guillemets and the curly
  // double quotation marks. The apostrophes ' (U+0027) and ’ (U+2019) are not among
  // them, since English and French text needs them.
  const character = /["«»“”„‟]/u.exec(text)?.[0];
  const breaches: TextRuleBreach[] = [];
  if (length > maxLength) {
    breaches.push({ kind: 'too_long', length, maxLength });
  }
  if (character !== undefined) {
    breaches.push({ kind: 'quotation_mark', character });
  }
  return breaches;
}
