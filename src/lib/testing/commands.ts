import { z } from 'zod';

import { err, ok } from '@/lib/result';

import type { Result } from '@/lib/result';
import type { ZodError } from 'zod';

/**
 * A control of a fake: it reads its arguments from the command, then runs and gives what
 * the fake answered, `undefined` when it answers nothing, or says what is wrong in them.
 */
export type Control = (command: unknown) => Result<unknown, ZodError>;

/**
 * The control of `/api/test/fakes` that reads its arguments from a command with `args`,
 * and runs `run` with them (module map, testing; TRV-15).
 */
export function control<S extends z.ZodType>(
  args: S,
  run: (parsed: z.output<S>) => unknown,
): Control {
  return (command) => {
    const parsed = args.safeParse(command);
    return parsed.success ? ok(run(parsed.data)) : err(parsed.error);
  };
}

/** A control of `/api/test/fakes` that takes no argument (module map, testing; TRV-15). */
export const plain = (run: () => unknown): Control => control(z.object({}), run);

/** Why a hermetic control ran nothing: its command, with what is wrong in it, one line per issue. */
export type InvalidCommand = Readonly<{ kind: 'invalid_command'; issues: readonly string[] }>;

/**
 * The refusal of a command of a hermetic control (module map, testing): each issue that
 * `error` found, where in the command, then what.
 */
export function invalidCommand(error: ZodError): InvalidCommand {
  return {
    kind: 'invalid_command',
    issues: error.issues.map(
      (issue) => `${['command', ...issue.path.map(String)].join('.')}: ${issue.message}`,
    ),
  };
}

/**
 * The command that a request to a hermetic control carries (module map, testing): its
 * body read as JSON, or `null` when the body is no JSON, which the control's own checks
 * then refuse.
 */
export async function readCommand(request: Request): Promise<unknown> {
  try {
    const command: unknown = await request.json();
    return command;
  } catch {
    return null;
  }
}
