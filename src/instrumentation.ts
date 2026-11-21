import { checkFakesSwitch } from '@/lib/env';
import { logger } from '@/lib/log';

const REFUSED = 1;

/**
 * Runs once as a server instance starts, before it serves any request: a server
 * whose fakes switch is refused does not start, and says which variables refuse
 * it, never their values.
 */
export function register(): void {
  const check = checkFakesSwitch();
  if (check.ok) {
    return;
  }
  logger.error('The fakes switch is refused, so the server does not start.', {
    variables: check.error.variables,
  });
  // Next.js also builds this file for the Edge runtime, which has no process.exit,
  // and its build says so in a warning: the app runs no code on the Edge runtime.
  // eslint-disable-next-line unicorn/no-process-exit -- Next.js keeps a production server listening when `register` throws, and answers every request with an error: ending the process is the one way to refuse to start.
  process.exit(REFUSED);
}
