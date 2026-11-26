import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import manifest from './manifest';

const PUBLIC_FOLDER = path.join(import.meta.dirname, '../../public');
const PNG_SIGNATURE = '89504e470d0a1a0a';
// Where a PNG file's header gives its width and its height, as two 32-bit integers.
const WIDTH_OFFSET = 16;
const HEIGHT_OFFSET = 20;

const byName = (left: string, right: string): number => left.localeCompare(right, 'en');

/** The size of a PNG file of public/, as the manifest writes it: "192x192". */
function pngSize(src: string): string {
  const file = readFileSync(path.join(PUBLIC_FOLDER, src));
  expect(file.subarray(0, PNG_SIGNATURE.length / 2).toString('hex')).toBe(PNG_SIGNATURE);
  return `${String(file.readUInt32BE(WIDTH_OFFSET))}x${String(file.readUInt32BE(HEIGHT_OFFSET))}`;
}

describe('the web app manifest', () => {
  it('[TRV-21] [IHM-02] [CA-TRV-06] names the app Egoscope, which opens full screen on Home', () => {
    const { id, name, short_name: shortName, start_url: startUrl, scope, display } = manifest();

    expect({ id, name, shortName, startUrl, scope, display }).toStrictEqual({
      id: '/',
      name: 'Egoscope',
      shortName: 'Egoscope',
      startUrl: '/',
      scope: '/',
      display: 'standalone',
    });
  });

  it('[TRV-21] [IHM-02] [CA-TRV-06] gives the icons that a phone installs, a 192 and a 512 pixel one and a maskable one', () => {
    expect(manifest().icons).toStrictEqual([
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ]);
  });

  it('[TRV-21] finds each icon as a PNG file of its size in public/icons, and no other file there', () => {
    const icons = manifest().icons ?? [];

    expect(icons.map((icon) => [icon.src, pngSize(icon.src)])).toStrictEqual(
      icons.map((icon) => [icon.src, icon.sizes]),
    );
    expect(readdirSync(path.join(PUBLIC_FOLDER, 'icons')).toSorted(byName)).toStrictEqual(
      icons.map((icon) => path.basename(icon.src)).toSorted(byName),
    );
  });
});
