import type { ReactNode } from 'react';

/** Home page, a placeholder until the application shell lands. */
export default function HomePage(): ReactNode {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Egoscope</h1>
      <p className="text-lg text-zinc-700 dark:text-zinc-300">
        A personal research tool that tests whether NBA players perform differently from their
        season norm in the first game after a public event touching their ego.
      </p>
      <p className="text-zinc-600 dark:text-zinc-400">It measures. It does not bet.</p>
    </main>
  );
}
