import { notFound } from 'next/navigation';

import { Gallery } from './gallery';
import { isGalleryShown } from './gallery-access';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// Where the gallery opens, it waits for the request, so its static shell is empty.
// eslint-disable-next-line unicorn/consistent-boolean-name -- Next.js reads this export by its name.
export const instant = false;

/** The title of the gallery, which a closed gallery does not give away. */
export async function generateMetadata(): Promise<Metadata> {
  return (await isGalleryShown()) ? { title: 'Component gallery' } : {};
}

/** The component gallery, /dev/ui: open under `next dev` and in the hermetic mode only. */
export default async function ComponentGalleryPage(): Promise<ReactNode> {
  if (!(await isGalleryShown())) {
    notFound();
  }
  return <Gallery />;
}
