import { defineConfig } from 'drizzle-kit';

// drizzle-kit generates the SQL migrations of drizzle/ from the schema
// (`bun run db:generate`); it never connects to a database. The deploy step
// applies them (scripts/migrate.ts), and the drift check proves they match the
// schema (scripts/check-migrations.ts).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/lib/db/schema/index.ts',
  out: './drizzle',
});
