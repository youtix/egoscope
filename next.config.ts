import type { NextConfig } from 'next';

// The body limit of a Server Action, in bytes. Next.js refuses a larger body (1 MB by
// default), so the limit follows the largest research result that the registry lets the
// owner paste: the upper bound of `imports.maxPastedTextMegabytes`, 4 MB of UTF-8 at
// 1,000,000 bytes each (src/lib/params/registry/imports.ts, CL-IMP-27), plus 1 MB of room
// for what the transport adds to the text: the boundaries and part headers of a form's
// multipart body, which Next.js's guide puts at 10 to 20 KB, and the escapes of the line
// breaks and quotes of a draft that a Server Action receives as a JSON argument.
const PASTED_TEXT_UPPER_BOUND_BYTES = 4_000_000;
const TRANSPORT_ROOM_BYTES = 1_000_000;
const SERVER_ACTION_BODY_LIMIT_BYTES = PASTED_TEXT_UPPER_BOUND_BYTES + TRANSPORT_ROOM_BYTES;

const nextConfig: NextConfig = {
  // Version-matched Next.js guidance for agents lives in CLAUDE.md, so `next dev`
  // must not write its own AGENTS.md into the working tree.
  agentRules: false,
  // Routes are prerendered except where they read request-time or uncached data.
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    serverActions: { bodySizeLimit: SERVER_ACTION_BODY_LIMIT_BYTES },
  },
  // Links and router calls are type-checked against the routes that exist.
  typedRoutes: true,
  poweredByHeader: false,
  // PGlite loads its WebAssembly and data files next to its own module at run
  // time, which bundling would break; Next.js already keeps `pg` external.
  serverExternalPackages: ['@electric-sql/pglite'],
  turbopack: {
    // Each git worktree is its own project, even when nested in another checkout.
    root: import.meta.dirname,
    rules: {
      '*.css': { loaders: ['@tailwindcss/turbopack'], as: '*.css' },
    },
  },
};

export default nextConfig;
