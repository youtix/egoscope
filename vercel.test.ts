import { describe, expect, it } from 'vitest';

import vercel from './vercel.json';

describe('vercel.json', () => {
  it('runs every function in fra1, Frankfurt, next to the database', () => {
    expect(vercel.regions).toStrictEqual(['fra1']);
  });
});
