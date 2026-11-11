import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Version-matched Next.js guidance for agents lives in CLAUDE.md, so `next dev`
  // must not write its own AGENTS.md into the working tree.
  agentRules: false,
  // Routes are prerendered except where they read request-time or uncached data.
  cacheComponents: true,
  partialPrefetching: true,
  // Links and router calls are type-checked against the routes that exist.
  typedRoutes: true,
  poweredByHeader: false,
  turbopack: {
    // Each git worktree is its own project, even when nested in another checkout.
    root: import.meta.dirname,
    rules: {
      '*.css': { loaders: ['@tailwindcss/turbopack'], as: '*.css' },
    },
  },
};

export default nextConfig;
