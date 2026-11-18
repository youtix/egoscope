/**
 * Starts the production build with an environment of the test's choice, for the
 * specs that check what the server does as it starts. The build is the one that
 * the run's web servers made.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** How a server ended: its exit code, and everything it printed. */
export type ServerExit = Readonly<{ code: number | null; output: string }>;

// A server that refuses to start exits within a few seconds; one that starts
// keeps running, and is stopped after this long, within the test's timeout.
const START_WINDOW_MS = 20_000;
const ROOT = path.join(import.meta.dirname, '..', '..');
const NEXT = fileURLToPath(import.meta.resolve('next/dist/bin/next'));

/**
 * Runs `next start` with `environment` over the test's own, on a port that the
 * system picks, and resolves with how the server ended. A server still running
 * at the end of the start window is stopped, and the promise rejects.
 */
export async function startUntilExit(
  environment: Readonly<Record<string, string>>,
): Promise<ServerExit> {
  const server = spawn(
    process.execPath,
    [NEXT, 'start', '--hostname', '127.0.0.1', '--port', '0'],
    {
      cwd: ROOT,
      env: { ...process.env, ...environment },
      signal: AbortSignal.timeout(START_WINDOW_MS),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const chunks: string[] = [];
  const collect = (chunk: string): void => {
    chunks.push(chunk);
  };
  server.stdout.setEncoding('utf8').on('data', collect);
  server.stderr.setEncoding('utf8').on('data', collect);
  const code = await new Promise<number | null>((resolve, reject) => {
    server.once('close', resolve);
    server.once('error', (error) => {
      const problem = 'The server could not run, or still ran at the end of its start window.';
      reject(new Error(problem, { cause: error }));
    });
  });
  return { code, output: chunks.join('') };
}
