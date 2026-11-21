import { describe, expect, it } from 'vitest';

import { cx } from './class-names';

describe('cx', () => {
  it('joins the class names in their order', () => {
    expect(cx('flex', 'gap-2')).toBe('flex gap-2');
  });

  it('skips the parts that a condition left out, and empty ones', () => {
    expect(cx('flex', false, undefined, '', 'gap-2')).toBe('flex gap-2');
  });

  it('gives an empty string when nothing is left', () => {
    expect(cx(false, undefined)).toBe('');
  });
});
