// Every table of the database, one schema file per module that owns tables
// (src/lib/db/schema/<owning-module>.ts). drizzle-kit generates the migrations
// from this file, and src/lib/db/index.ts re-exports each table by name.
export { installation, sequenceCounters } from './db';
