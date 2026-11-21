import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { checkPastedTextSize } from './pasted-text-size';

/** The refusal of a text over its bound, with this message. */
const tooLarge = (message: string): ReturnType<typeof checkPastedTextSize> => ({
  ok: false,
  error: { kind: 'text_too_large', message },
});

/** A text of `bytes` bytes in UTF-8: one-byte characters, then `last`, of `lastBytes` bytes. */
const textOf = (bytes: number, last: string, lastBytes: number): string =>
  `${'a'.repeat(bytes - lastBytes)}${last}`;

describe('checkPastedTextSize', () => {
  it.each([
    ['the last one-byte character, U+007F', 1, '\u{7F}'],
    ['the first two-byte character, U+0080', 2, '\u{80}'],
    ['the last two-byte character, U+07FF', 2, '\u{7FF}'],
    ['the first three-byte character, U+0800', 3, '\u{800}'],
    ['the last character of the first plane, U+FFFF', 3, '\u{FFFF}'],
    ['a lone surrogate, written as U+FFFD', 3, '\u{D800}'],
    ['the first character outside the first plane, U+10000', 4, '\u{10000}'],
    ['an emoji outside the first plane', 4, '😀'],
  ])(
    '[TAX-17] [CL-IMP-27] gives %s a UTF-8 length of %i: a text of the size bound passes, one byte more is refused',
    (_, lastBytes, last) => {
      const atLimit = textOf(500_000, last, lastBytes);

      expect(checkPastedTextSize(atLimit, 0.5)).toStrictEqual({ ok: true });
      expect(checkPastedTextSize(` ${atLimit}`, 0.5)).toStrictEqual(
        tooLarge('The pasted text is 0.51 MB, over the 0.5 MB limit.'),
      );
    },
  );

  it.each([
    [2_345_678, 2, 'The pasted text is 2.35 MB, over the 2 MB limit.'],
    [2_345_678, 1.5, 'The pasted text is 2.35 MB, over the 1.5 MB limit.'],
    [3_000_000, 2.5, 'The pasted text is 3 MB, over the 2.5 MB limit.'],
  ])(
    '[TAX-17] [CL-IMP-27] gives the size of %i bytes in MB to the hundredth above, and the limit of %s MB as set',
    (bytes, limit, message) => {
      expect(checkPastedTextSize(textOf(bytes, 'a', 1), limit)).toStrictEqual(tooLarge(message));
    },
  );

  it('[TAX-17] [CL-IMP-27] refuses exactly the texts whose UTF-8 encoding is longer than the bound', () => {
    // A bound of 20 bytes.
    const bound = 20 / 1_000_000;

    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 30 }), (text) => {
        const isOver = new TextEncoder().encode(text).length > 20;

        expect(checkPastedTextSize(text, bound).ok).toBe(!isOver);
      }),
    );
  });
});
