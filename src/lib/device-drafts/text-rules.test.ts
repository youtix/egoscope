import { describe, expect, it } from 'vitest';

import { canStoreText } from './text-rules';

describe('the characters a server copy can hold', () => {
  it('[DSN-32] keeps a text without a NUL character, and refuses one that holds it anywhere', () => {
    expect(canStoreText('EVENT 1: the Redwater Foxes forward changes agents.')).toBe(true);
    expect(canStoreText('')).toBe(true);
    expect(canStoreText('\0')).toBe(false);
    expect(canStoreText('EVENT 1\0: a pasted control character.')).toBe(false);
    expect(canStoreText('Ends with it.\0')).toBe(false);
  });
});
