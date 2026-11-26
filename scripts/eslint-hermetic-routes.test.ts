// Proves what the hermetic-test-routes rule of eslint-hermetic-routes.ts refuses in a
// route under src/app/api/test/, beside what it lets through: every route there today,
// ping's first, and the guard written as an `if`; and that it reads no other route.
// Deliberate violations are linted in the probe project of lint-probes.ts.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { createProbes } from './lint-probes';

const { lint, remove } = createProbes();
const RULE = 'egoscope/hermetic-test-routes';
const PROBE = 'src/app/api/test/probe/route.ts';
const TEST_ROUTES = path.join(import.meta.dirname, '..', 'src/app/api/test');

const IMPORTS = [
  "import { connection } from 'next/server';",
  '',
  "import { isHermetic } from '@/lib/env';",
  '',
];
const WAIT = '  await connection();';
const TERNARY = '  return isHermetic() ? Response.json({}) : new Response(null, { status: 404 });';
const IF_NOT = [
  '  if (!isHermetic()) {',
  '    return new Response(null, { status: 404 });',
  '  }',
  '  return Response.json({});',
].join('\n');

/** A handler named `name` whose body holds `statements`. */
const handler = (name: string, ...statements: readonly string[]): string =>
  [`export async function ${name}(): Promise<Response> {`, ...statements, '}', ''].join('\n');

/** A route file that imports the two guards, then holds `code`. */
const route = (...code: readonly string[]): string => [...IMPORTS, ...code].join('\n');

/** The refusals of the rule on `code`, linted as `file`: each message ID, with its line. */
async function refusals(file: string, code: string): Promise<readonly string[]> {
  const messages = await lint(file, code);
  return messages
    .filter((message) => message.ruleId === RULE)
    .map(({ messageId = '', line }) => `${messageId} at ${String(line)}`);
}

describe(
  'hermetic-test-routes: a route under /api/test/ starts as ping does',
  { timeout: 120_000 },
  () => {
    afterAll(remove);

    it.each(readdirSync(TEST_ROUTES).toSorted((left, right) => left.localeCompare(right, 'en')))(
      'lets the route of /api/test/%s through, as it is written',
      async (name) => {
        const code = readFileSync(path.join(TEST_ROUTES, name, 'route.ts'), 'utf8');

        await expect(refusals(PROBE, code)).resolves.toStrictEqual([]);
      },
    );

    it('lets the guard be written as an if that returns', async () => {
      const code = route(handler('POST', WAIT, IF_NOT));

      await expect(refusals(PROBE, code)).resolves.toStrictEqual([]);
    });

    it.each([
      ['a handler that never waits for the request', route(handler('GET', TERNARY))],
      [
        'a guard before the wait',
        route(
          handler(
            'GET',
            '  if (!isHermetic()) {',
            '    return new Response(null);',
            '  }',
            WAIT,
            '  return Response.json({});',
          ),
        ),
      ],
      [
        'a wait after another statement',
        route(
          handler(
            'GET',
            '  const body = { hermetic: true };',
            WAIT,
            '  return isHermetic() ? Response.json(body) : new Response(null);',
          ),
        ),
      ],
      ['a wait without a guard', route(handler('GET', WAIT, '  return Response.json({});'))],
      [
        'a guard that answers in the hermetic mode only after more work',
        route(
          handler(
            'GET',
            WAIT,
            '  if (!isHermetic()) {',
            '    const empty = null;',
            '    return new Response(empty);',
            '  }',
            '  return Response.json({});',
          ),
        ),
      ],
      [
        'an isHermetic imported from elsewhere',
        [
          "import { connection } from 'next/server';",
          '',
          "import { isHermetic } from './hermetic';",
          '',
          handler('GET', WAIT, TERNARY),
        ].join('\n'),
      ],
      [
        'a connection imported from elsewhere',
        [
          "import { connection } from './connection';",
          '',
          "import { isHermetic } from '@/lib/env';",
          '',
          handler('GET', WAIT, TERNARY),
        ].join('\n'),
      ],
    ])('refuses %s', async (_kind, code) => {
      await expect(refusals(PROBE, code)).resolves.toStrictEqual(['start at 5']);
    });

    it('refuses a handler held in a constant, even one that starts as ping does', async () => {
      const code = route(
        'export const GET = async (): Promise<Response> => {',
        WAIT,
        TERNARY,
        '};',
        '',
      );

      await expect(refusals(PROBE, code)).resolves.toStrictEqual(['export at 5']);
    });

    it('refuses the second handler of a file when it has no guard, beside a first that has one', async () => {
      const code = route(
        handler('GET', WAIT, TERNARY),
        handler('POST', '  return Response.json({});'),
      );

      await expect(refusals(PROBE, code)).resolves.toStrictEqual(['start at 10']);
    });

    it('reads no route outside /api/test/, such as that of /api/health', async () => {
      const code = handler('GET', '  return Response.json({ status: "ok" });');

      await expect(refusals('src/app/probe/route.ts', code)).resolves.toStrictEqual([]);
    });
  },
);
