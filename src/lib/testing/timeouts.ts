/**
 * The time limit of a suite that builds databases with `createTestDatabase()`, and of
 * the hook that builds each one (TRV-76): a minute, since Vitest's ten-second default
 * for hooks can run out on a loaded machine (pull request #342). Its tests keep
 * Vitest's own default.
 */
export const DATABASE_TEST_TIMEOUT_MS = 60_000;
