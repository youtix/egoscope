/**
 * The route shells: the Next.js files of the App Router that render a route, with
 * the named exports that Next.js reads from each kind. Coverage leaves them out
 * (vitest.config.ts) and lint keeps them thin (eslint.config.ts). Both read this
 * one list, so that no kind of file can drop out of coverage without also falling
 * under the shell rules. Route handlers (route.ts) are not shells: they are covered.
 */
export type ShellKind = Readonly<{
  /** The file names of this kind, without extension. */
  names: readonly string[];
  /** The pattern that matches them anywhere under src/app. */
  glob: string;
  /** The named exports that Next.js reads from them, besides the default export. */
  exports: readonly string[];
}>;

const KINDS = [
  {
    names: ['page', 'layout'],
    exports: [
      'metadata',
      'generateMetadata',
      'viewport',
      'generateViewport',
      'generateStaticParams',
      'dynamicParams',
      'runtime',
      'preferredRegion',
      'maxDuration',
      'ensureStatic',
      'prefetch',
      'instant',
    ],
  },
  { names: ['not-found', 'global-not-found'], exports: ['metadata', 'generateMetadata'] },
  {
    names: ['template', 'loading', 'error', 'global-error', 'forbidden', 'unauthorized', 'default'],
    exports: [],
  },
] as const;

// Braces with a single name match nothing, so one name goes without them.
const globOf = (names: readonly string[]): string => {
  const stem = names.length > 1 ? `{${names.join(',')}}` : names.join('');
  return `src/app/**/${stem}.{ts,tsx}`;
};

/** Every kind of route shell. */
export const SHELL_KINDS: readonly ShellKind[] = KINDS.map((kind) => ({
  ...kind,
  glob: globOf(kind.names),
}));

/** The file patterns of every kind of route shell. */
export const ROUTE_SHELLS: readonly string[] = SHELL_KINDS.map((kind) => kind.glob);
