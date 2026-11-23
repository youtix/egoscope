import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { invalidCommand, readCommand } from './commands';

const COMMAND = z.strictObject({ fault: z.strictObject({ times: z.int() }) });

/** What `COMMAND` finds wrong in `input`. */
function errorOf(input: unknown): z.ZodError {
  const parsed = COMMAND.safeParse(input);
  if (parsed.success) {
    throw new Error('Expected the command to be refused.');
  }
  return parsed.error;
}

/** A request to a hermetic control whose body is `body`. */
const request = (body: string) =>
  new Request('http://localhost/api/test/fakes', { method: 'POST', body });

describe('the commands of the hermetic controls', () => {
  it.each([
    ['an object', '{ "control": "link-check.reset" }', { control: 'link-check.reset' }],
    ['another JSON value', '"link-check.reset"', 'link-check.reset'],
    ['a body cut short', '{ "control": ', null],
    ['an empty body', '', null],
  ])('reads %s as the command', async (_case, body, command) => {
    await expect(readCommand(request(body))).resolves.toStrictEqual(command);
  });

  it('says where in the command each issue is, then what it is', () => {
    const error = errorOf({ fault: { times: 1.5 }, extra: true });

    expect(invalidCommand(error)).toStrictEqual({
      kind: 'invalid_command',
      issues: [
        'command.fault.times: Invalid input: expected int, received number',
        'command: Unrecognized key: "extra"',
      ],
    });
  });
});
