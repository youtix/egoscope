// Two signals that the event checks look for in the texts of a research result: a
// citation marker that the research AI left inside a text value (CL-IMP-07), and
// statistics or a score in a description or an unverified note (CL-IMP-03). Both only
// warn: a flagged text is kept as written, never rewritten (ADR 0013, IMP-13).
//
// Each set of patterns is one constant, and each pattern has its fixture in
// data/fixtures/ai-exchange/research-result/text-signals/. No pattern carries the `g`
// or `y` flag, so that none keeps a position from one text to the next. The constants
// carry a type rather than `as const`, inside which Stryker plants no mutant.

/**
 * The forms of a citation marker inside a text value (CL-IMP-07, IMP-04), which the
 * research AI may leave in a description, an unverified note, an outlet name, an
 * article title or a limitation.
 */
export const CITATION_MARKER_PATTERNS: Readonly<Record<string, RegExp>> = {
  // A bracketed number list: [1], [2, 5], [3–4].
  numberList: /\[\d+(?:\s*[,\p{Pd}]\s*\d+)*\]/u,
  // A footnote call: [^1], [^note].
  footnoteCall: /\[\^[^\]]+\]/u,
  // A bracketed token that starts with cite: [cite_start], [cite: 1].
  citeToken: /\[cite[^\]]*\]/u,
  // Any text between lenticular brackets: 【3†source】. A 【 inside is left out, so that
  // the innermost span matches and the check stays linear in the length of the text.
  lenticularSpan: /【[^【】]*】/u,
  // A superscript digit: ¹, ², ³, ⁰, and ⁴ to ⁹.
  superscriptDigit: /[\u{00B9}\u{00B2}\u{00B3}\u{2070}\u{2074}-\u{2079}]/u,
  // A dagger or a double dagger.
  dagger: /[†‡]/u,
  // A private-use character, U+E000 to U+F8FF.
  privateUse: /[\u{E000}-\u{F8FF}]/u,
  // A Markdown link to a web address: [text](http…). A [ in the text is left out, so that
  // the innermost brackets match and the check stays linear in the length of the text.
  markdownLink: /\[[^[\]]*\]\(http/u,
};

/**
 * The patterns of the statistics and score heuristic (CL-IMP-03, IMP-13), case
 * ignored: a number followed by a word or an abbreviation of the list, the word
 * double-double or triple-double, and a score. A space is any white space, the no-break
 * ones included, and a hyphen any Unicode hyphen or dash, the non-breaking hyphen
 * included, since research AIs write those too.
 */
export const STATISTICS_PATTERNS: Readonly<Record<string, RegExp>> = {
  // A number in digits, then an optional space or hyphen and a word of the list,
  // singular or plural: 31 points, a 3-pointer, 4 threes. Any number, decimals
  // included, ends with a digit, which is all that the pattern needs.
  numberAndWord:
    /\d[\s\p{Pd}]?(?:(?:point|rebound|assist|steal|block|turnover|minute|field\sgoal|free\sthrow|three\p{Pd}pointer|pointer)s?|threes)\b/iu,
  // The same with an abbreviation of the list: 12pts, 12 reb, 7-ast, 38 min.
  numberAndAbbreviation: /\d[\s\p{Pd}]?(?:pts?|rebs?|ast|stl|blk|tov|min)\b/iu,
  // The word double-double or triple-double, its plural included.
  doubleOrTripleDouble: /(?:double|triple)\p{Pd}double/iu,
  // Two numbers of two or three digits joined by a hyphen or a dash, no digit touching
  // either of them: 102-98 or 99–101, never the season 2023-24.
  score: /(?<!\d)\d{2,3}\p{Pd}\d{2,3}(?!\d)/u,
};

/**
 * Says whether a text value holds a possible citation marker, which gives the warning
 * "possible citation marker in {field}" (CL-IMP-07, IMP-04).
 */
export function hasPossibleCitationMarker(text: string): boolean {
  return Object.values(CITATION_MARKER_PATTERNS).some((pattern) => pattern.test(text));
}

/**
 * Says whether a description or an unverified note may contain statistics or a score,
 * which gives the warning "may contain statistics or a score" (CL-IMP-03, IMP-13).
 */
export function hasPossibleStatistics(text: string): boolean {
  return Object.values(STATISTICS_PATTERNS).some((pattern) => pattern.test(text));
}
