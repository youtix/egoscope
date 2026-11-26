import { render, screen } from '@testing-library/react';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { TextReceived } from './text-received';

// UTF-16 units, half of them surrogates, so that texts hold pairs and lone halves.
const UTF16_UNIT = fc.oneof(
  fc.integer({ min: 0xd8_00, max: 0xdf_ff }),
  fc.integer({ min: 0, max: 0xff_ff }),
);
// Texts shorter and longer than the 120 characters of the end shown.
const UTF16_TEXT = fc
  .array(UTF16_UNIT, { maxLength: 400, size: 'max' })
  .map((units) => String.fromCodePoint(...units));
const SHOWN_END = 120;
const LONE_SURROGATE = /\p{Cs}/u;
const PAIR = /[\u{10000}-\u{10FFFF}]/u;
// Any code point, a lone surrogate included.
const CODE_POINT = /./gsu;

/** The end of the text, as it shows it, if it shows one. */
function shownEnd(): string | null | undefined {
  return screen.queryByText((_content, element) => element?.tagName === 'PRE')?.textContent;
}

describe('the characters received of the paste area', () => {
  it.each([
    { name: 'no text', text: '', received: '0 characters received', end: undefined },
    { name: 'one emoji', text: '😀', received: '1 character received', end: '😀' },
    {
      name: 'a letter, an emoji and a letter',
      text: 'a😀b',
      received: '3 characters received',
      end: 'a😀b',
    },
    { name: 'three emoji', text: '😀😀😀', received: '3 characters received', end: '😀😀😀' },
    {
      name: 'a lone surrogate',
      text: '\u{D83D}',
      received: '1 character received',
      end: '\u{D83D}',
    },
    {
      name: 'a lone surrogate, then a pair',
      text: '\u{D83D}😀',
      received: '2 characters received',
      end: '\u{D83D}😀',
    },
    {
      name: 'a pair, then a lone surrogate',
      text: '😀\u{DE00}',
      received: '2 characters received',
      end: '😀\u{DE00}',
    },
    {
      name: '100 letters',
      text: 'a'.repeat(100),
      received: '100 characters received',
      end: 'a'.repeat(100),
    },
    {
      name: '1,000 letters',
      text: 'a'.repeat(1000),
      received: '1,000 characters received',
      end: 'a'.repeat(SHOWN_END),
    },
  ])(
    '[IMP-02] [CL-IMP-27] counts the characters of $name as code points, and shows the last 120 at most',
    ({ text, received, end }) => {
      render(<TextReceived text={text} />);

      expect(screen.getByText(received)).toBeVisible();
      expect(shownEnd()).toBe(end);
    },
  );

  it('[IMP-02] [CL-IMP-27] shows an end of exactly 120 emoji of a text of 200, never half of a pair', () => {
    render(<TextReceived text={`a${'😀'.repeat(200)}`} />);

    expect(screen.getByText('201 characters received')).toBeVisible();
    expect(screen.getByText('End of the text')).toBeVisible();
    expect(shownEnd()).toBe('😀'.repeat(SHOWN_END));
  });

  it('[IMP-02] [CL-IMP-27] counts any text, lone surrogates included, as its code points, and ends it with its last 120', () => {
    const { rerender } = render(<TextReceived text="" />);
    const reached = { longer: 0, lone: 0, pairs: 0 };

    fc.assert(
      fc.property(UTF16_TEXT, (text) => {
        rerender(<TextReceived text={text} />);
        // The code points of the text, as Array.from(text) gives them.
        const points = text.match(CODE_POINT) ?? [];
        reached.longer += Number(points.length > SHOWN_END);
        reached.lone += Number(LONE_SURROGATE.test(text));
        reached.pairs += Number(PAIR.test(text));

        expect(screen.getByText(/characters? received$/u)).toHaveTextContent(
          new RegExp(`^${String(points.length)} characters? received$`, 'u'),
        );
        expect(shownEnd() ?? '').toBe(points.slice(-SHOWN_END).join(''));
      }),
    );
    // The property reached texts longer than the end shown, lone surrogates and pairs.
    expect(Object.values(reached).every((count) => count > 0)).toBe(true);
  });
});
