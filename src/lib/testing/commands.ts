import type { ZodError } from 'zod';

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
