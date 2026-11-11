import './globals.css';

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: { default: 'Egoscope', template: '%s · Egoscope' },
  description:
    'A personal tool that tests whether NBA players perform differently after a public event touching their ego.',
  // TRV-58: the application asks search engines not to index it.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
};

/** Root layout: the entry point of the user interface, shared by every page. */
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-white text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
        {children}
      </body>
    </html>
  );
}
