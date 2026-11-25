import type { ReactNode } from 'react';

/**
 * The frame of the two screens open before a session, the login and "Choose your
 * password" screens: one narrow column, which never scrolls sideways (IHM-01).
 */
export default function AuthLayout({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  return (
    <main className="mx-auto flex w-full max-w-md min-w-0 flex-col gap-6 px-4 py-10 sm:px-6">
      {children}
    </main>
  );
}
