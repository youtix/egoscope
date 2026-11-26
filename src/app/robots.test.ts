import { describe, expect, it } from 'vitest';

import robots from './robots';

describe('robots.txt', () => {
  it('[TRV-58] [CL-TRV-13] disallows every address to every search engine', () => {
    expect(robots()).toStrictEqual({ rules: { userAgent: '*', disallow: '/' } });
  });
});
