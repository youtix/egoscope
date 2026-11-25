import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { destination, returnPath } from './return-path';

// The address of the app as a browser holds it, against which a return path must stay.
const APP = 'https://egoscope.example';
// A screen of the app, with its query.
const CASES = '/players/12?tab=cases';
// Any value of next: a text, the address of a site, or a path.
const NEXT_VALUES = fc.oneof(fc.string(), fc.webUrl(), fc.webPath());

describe('the screen to return to after the login', () => {
  it.each([
    ['/players/12?tab=cases', '/players/12?tab=cases'],
    ['/', '/'],
    ['/import?request=7', '/import?request=7'],
    ['/log-inside', '/log-inside'],
  ])('[IHM-11] returns to %s, a path of the app', (next, shown) => {
    expect(returnPath(next)).toBe(shown);
  });

  it.each([
    ['the address of another site', 'https://other.example/players'],
    ['an address without a scheme', '//other.example/players'],
    ['a backslash that browsers read as a slash', '/\\other.example/players'],
    ['a relative path', 'players'],
    ['a path that climbs out of itself', '/players/../log-in'],
    ['a fragment', '/players#cases'],
    ['a space that a browser would encode', '/players list'],
    ['the login page', '/log-in'],
    ['a step of the login page', '/log-in/erase?next=%2F'],
    ['an empty value', ''],
    ['no value', undefined],
    ['a repeated parameter', ['/players', '/rankings']],
  ])('[IHM-10] [IHM-11] returns Home for %s', (_case, next) => {
    expect(returnPath(next)).toBe('/');
  });

  it('[IHM-10] [IHM-11] never leaves the app, whatever the value of next', () => {
    fc.assert(
      fc.property(NEXT_VALUES, (next) => {
        const path = returnPath(next);

        expect(new URL(path, APP).origin).toBe(APP);
        expect(path === '/' || path === next).toBe(true);
        expect(returnPath(path)).toBe(path);
      }),
    );
  });

  it('[TRV-57] [IHM-06] [IHM-11] goes first to "Choose your password" while the account uses its initial password', () => {
    expect(destination('initial', returnPath(CASES))).toBe(
      '/choose-password?next=%2Fplayers%2F12%3Ftab%3Dcases',
    );
  });

  it('[IHM-11] goes straight to the screen asked for once the password is chosen', () => {
    expect(destination('chosen', returnPath(CASES))).toBe(CASES);
  });
});
