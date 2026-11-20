// The size bound of a pasted text (IMP-02, CL-IMP-27), the only bound of an exploration
// response as a whole (CL-TAX-04): the size of the text's UTF-8 encoding, in bytes,
// against a limit in MB. The size is counted code point by code point, without encoding
// the text, so that a large text costs no copy of itself.

// A megabyte is 1,000,000 bytes of UTF-8 (CL-IMP-27). A size is written in MB to the
// hundredth above, so that a text over the limit never reads as one at the limit.
const BYTES_PER_MEGABYTE = 1_000_000;
const HUNDREDTHS = 100;
// The first code points that UTF-8 writes in two bytes, in three and in four. A text
// writes a code point from U+10000 on as a pair of surrogates.
const FIRST_OF_TWO_BYTES = 0x80;
const FIRST_OF_THREE_BYTES = 0x8_00;
const FIRST_OF_FOUR_BYTES = 0x1_00_00;
const FOUR_BYTES = 4;

// A text within its bound, or one refused, with the message that gives its size.
type PastedTextSizeResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; error: Readonly<{ kind: 'text_too_large'; message: string }> }>;

/**
 * The size of a text in UTF-8, in bytes: one byte per code point, one more from U+0080 and
 * one more from U+0800, or four from U+10000, the two surrogates of the pair counted
 * together. A lone surrogate is a code point of its own, of three bytes, as the
 * replacement character U+FFFD that an encoder writes instead.
 */
function utf8Size(text: string): number {
  let size = 0;
  let index = 0;
  while (index < text.length) {
    // codePointAt gives a number at every index of the text.
    const point = Number(text.codePointAt(index));
    const isPair = point >= FIRST_OF_FOUR_BYTES;
    size += isPair
      ? FOUR_BYTES
      : 1 + Number(point >= FIRST_OF_TWO_BYTES) + Number(point >= FIRST_OF_THREE_BYTES);
    index += isPair ? 2 : 1;
  }
  return size;
}

/** A size in bytes, in MB to the hundredth above. */
function megabytes(bytes: number): string {
  return String(Math.ceil((bytes * HUNDREDTHS) / BYTES_PER_MEGABYTE) / HUNDREDTHS);
}

/**
 * Checks a pasted text against its size bound (IMP-02, CL-IMP-27): its UTF-8 encoding may
 * take `maxMegabytes` MB, 1 MB being 1,000,000 bytes. A longer text is refused, with the
 * glossary's message, which gives its size in MB to the hundredth above and the limit as
 * set (section 7.3).
 */
export function checkPastedTextSize(text: string, maxMegabytes: number): PastedTextSizeResult {
  const size = utf8Size(text);
  if (size <= maxMegabytes * BYTES_PER_MEGABYTE) {
    return { ok: true };
  }
  const limit = String(maxMegabytes);
  const message = `The pasted text is ${megabytes(size)} MB, over the ${limit} MB limit.`;
  return { ok: false, error: { kind: 'text_too_large', message } };
}
