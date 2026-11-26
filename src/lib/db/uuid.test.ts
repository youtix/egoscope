import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isUuid } from './uuid';

const LOWERCASE = '6f1d2c3b-4a59-4e8f-9b7a-0c1d2e3f4a5b';

describe('isUuid', () => {
  it.each([
    ['a lowercase uuid', LOWERCASE, true],
    ['an uppercase uuid', LOWERCASE.toUpperCase(), true],
    ['a uuid whose version digit is not 4', '6f1d2c3b-4a59-1e8f-9b7a-0c1d2e3f4a5b', true],
    ['the nil uuid', '00000000-0000-0000-0000-000000000000', true],
    ['the empty string', '', false],
    ['a uuid with a trailing newline', `${LOWERCASE}\n`, false],
    ['a uuid with a trailing space', `${LOWERCASE} `, false],
    ['a uuid with a leading space', ` ${LOWERCASE}`, false],
    ['a uuid without hyphens', LOWERCASE.replaceAll('-', ''), false],
    ['a uuid in braces', `{${LOWERCASE}}`, false],
    ['a uuid with a non-hex letter', '6f1d2c3b-4a59-4e8f-9b7a-0c1d2e3f4a5g', false],
    ['a uuid a character too short', LOWERCASE.slice(0, -1), false],
    ['a uuid a character too long', `${LOWERCASE}0`, false],
    ['a uuid whose first group is a digit short', '6f1d2c3-4a59-4e8f-9b7a-0c1d2e3f4a5b', false],
    ['a uuid whose first group is a digit long', '6f1d2c3b0-4a59-4e8f-9b7a-0c1d2e3f4a5b', false],
    ['a uuid whose second group is a digit short', '6f1d2c3b-4a5-4e8f-9b7a-0c1d2e3f4a5b', false],
    ['a uuid whose second group is a digit long', '6f1d2c3b-4a590-4e8f-9b7a-0c1d2e3f4a5b', false],
    ['a uuid whose third group is a digit short', '6f1d2c3b-4a59-4e8-9b7a-0c1d2e3f4a5b', false],
    ['a uuid whose third group is a digit long', '6f1d2c3b-4a59-4e8f0-9b7a-0c1d2e3f4a5b', false],
    ['a uuid whose fourth group is a digit short', '6f1d2c3b-4a59-4e8f-9b7-0c1d2e3f4a5b', false],
    ['a uuid whose fourth group is a digit long', '6f1d2c3b-4a59-4e8f-9b7a0-0c1d2e3f4a5b', false],
    ['a text that names no player', 'not-a-player', false],
  ])('[CL-JOU-09] answers %s: %s', (_what, text, expected) => {
    expect(isUuid(text)).toBe(expected);
  });

  it('[CL-JOU-09] accepts every uuid and refuses it once any character is appended', () => {
    fc.assert(
      fc.property(fc.uuid(), fc.string({ minLength: 1, maxLength: 1 }), (uuid, extra) => {
        expect(isUuid(uuid)).toBe(true);
        expect(isUuid(`${uuid}${extra}`)).toBe(false);
        expect(isUuid(`${extra}${uuid}`)).toBe(false);
      }),
    );
  });
});
