import { sentence } from '@/lib/wording';

import type { MetadataRoute } from 'next';

// Home, where the installed app opens, and the whole app, which it holds (IHM-02).
const HOME = '/';

/**
 * The web app manifest, at /manifest.webmanifest, which makes the app installable on the
 * phone's home screen: named Egoscope, with its icon, opening full screen without the
 * browser's bar, on Home (TRV-21, IHM-02, CA-TRV-06). Its colors are left to the page,
 * which follows the phone's light or dark theme.
 */
export default function manifest(): MetadataRoute.Manifest {
  const name = sentence('crossCutting.appName');
  return {
    id: HOME,
    name,
    // eslint-disable-next-line @typescript-eslint/naming-convention -- a member of the web app manifest, which names it so
    short_name: name,
    // eslint-disable-next-line @typescript-eslint/naming-convention -- a member of the web app manifest, which names it so
    start_url: HOME,
    scope: HOME,
    display: 'standalone',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
