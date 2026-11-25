import { describe, expect, it } from 'vitest';

import { describeDevice } from './device';

// The User-Agent strings of two browsers, as they send them.
const PHONE =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0';

describe('the description of the device that logs in', () => {
  it.each([
    [PHONE, 'Chrome on Android'],
    [DESKTOP, 'Firefox on Linux'],
  ])('[IHM-06] [H-IHM-06] names the browser and the system of %s', (userAgent, shown) => {
    expect(describeDevice(userAgent)).toBe(shown);
  });

  it.each([
    ['a device that sends no User-Agent', null],
    ['a script that names no browser', 'curl/8.5.0'],
  ])('[IHM-06] describes %s as an unknown device', (_case, userAgent) => {
    expect(describeDevice(userAgent)).toBe('Unknown device');
  });
});
