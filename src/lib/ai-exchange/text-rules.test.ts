import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { checkText, textLength } from './text-rules';

// The quotation marks of the rule (DSN-21): ", «, », “, ”, „ and ‟.
const QUOTATION_MARKS = ['"', '«', '»', '“', '”', '„', '‟'];
const QUOTATION_MARK = /["«»“”„‟]/gu;
// A maximum no generated text reaches, for the checks of quotation marks alone.
const NO_MAXIMUM = 100_000;

// Any text without a quotation mark of the rule, astral characters included.
const anyTextWithoutMark = fc
  .string({ unit: 'binary', maxLength: 40 })
  .map((text) => text.replaceAll(QUOTATION_MARK, ''));
// Texts of a known length: code points that are neither spaces nor quotation marks, of
// one or two UTF-16 code units.
const anyCharacters = fc.array(fc.constantFrom('a', 'é', '日', "'", '\u{1F3C0}'), {
  maxLength: 30,
});

describe('textLength', () => {
  it('[DSN-20] counts code points, so that a letter with an accent or an emoji counts once', () => {
    expect(textLength('Café \u{1F3C0}')).toBe(6);
  });

  it('[DSN-20] leaves out the spaces before and after the text', () => {
    expect(textLength(' \t A word.\n ')).toBe(7);
    expect(textLength(' \n ')).toBe(0);
  });
});

describe('checkText', () => {
  it('[DSN-20] [DSN-24] refuses a text longer than the maximum it is given, with both lengths', () => {
    expect(checkText('x'.repeat(250), 200)).toStrictEqual([
      { kind: 'too_long', length: 250, maxLength: 200 },
    ]);
    expect(checkText(` ${'x'.repeat(200)} `, 200)).toStrictEqual([]);
  });

  it('[DSN-20] measures any text in code points after trimming, against any maximum', () => {
    fc.assert(
      fc.property(anyCharacters, fc.nat(30), (characters, extra) => {
        const text = `  ${characters.join('')}\n`;

        expect(checkText(text, characters.length + extra)).toStrictEqual([]);
      }),
    );
  });

  it('[DSN-20] refuses any text one code point or more above the maximum', () => {
    const tooLong = anyCharacters
      .filter((characters) => characters.length > 0)
      .chain((characters) => fc.tuple(fc.constant(characters), fc.nat(characters.length - 1)));

    fc.assert(
      fc.property(tooLong, ([characters, maxLength]) => {
        const text = characters.join('');

        expect(checkText(text, maxLength)).toStrictEqual([
          { kind: 'too_long', length: characters.length, maxLength },
        ]);
      }),
    );
  });

  it.each(QUOTATION_MARKS)('[DSN-21] [DSN-24] refuses the quotation mark %s, naming it', (mark) => {
    const text = `The coach called it ${mark}a joke${mark} on air.`;

    expect(checkText(text, 200)).toStrictEqual([{ kind: 'quotation_mark', character: mark }]);
  });

  it('[DSN-21] [DSN-25] names the first quotation mark of any text, wherever it stands', () => {
    fc.assert(
      fc.property(
        anyTextWithoutMark,
        fc.constantFrom(...QUOTATION_MARKS),
        fc.string({ unit: 'binary', maxLength: 40 }),
        (before, mark, after) => {
          expect(checkText(`${before}${mark}${after}`, NO_MAXIMUM)).toStrictEqual([
            { kind: 'quotation_mark', character: mark },
          ]);
        },
      ),
    );
  });

  it("[DSN-21] lets the apostrophes ' and ’ pass anywhere in any text", () => {
    const apostrophe = fc.constantFrom("'", '’');
    const parts = fc.array(fc.oneof(anyTextWithoutMark, apostrophe), { maxLength: 10 });

    fc.assert(
      fc.property(parts, (texts) => {
        expect(checkText(texts.join(''), NO_MAXIMUM)).toStrictEqual([]);
      }),
    );
  });

  it.each(['‘', '‚', '‛', '‹', '›'])(
    '[DSN-21] lets the single quotation mark %s pass, which no check can tell from an apostrophe',
    (mark) => {
      expect(checkText(`the ${mark}rookie${mark} label`, 200)).toStrictEqual([]);
    },
  );

  it('[DSN-20] [DSN-21] reports both breaches of a text, its length first', () => {
    expect(checkText('“Too long”', 5)).toStrictEqual([
      { kind: 'too_long', length: 10, maxLength: 5 },
      { kind: 'quotation_mark', character: '“' },
    ]);
  });
});
