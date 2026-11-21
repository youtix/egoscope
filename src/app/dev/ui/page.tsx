import { notFound } from 'next/navigation';
import { connection } from 'next/server';

import { Gallery } from './gallery';
import { isGalleryOpen } from './gallery-access';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'Component gallery' };

// The gallery waits for the request, to answer not found before any byte is sent
// wherever it is closed: a prerendered page would describe the build machine.
// eslint-disable-next-line unicorn/consistent-boolean-name -- Next.js reads this export by its name.
export const instant = false;

/** The component gallery, /dev/ui: open under `next dev` and in the hermetic mode only. */
export default async function ComponentGalleryPage(): Promise<ReactNode> {
  await connection();
  if (!isGalleryOpen()) {
    notFound();
  }
  return <Gallery />;
}
