// Proves what no-ambient-time refuses of Temporal, of the performance timer and of
// server modules, beside the harmless forms that it lets through: only src/lib/time
// imports temporal-polyfill, Temporal reads no clock and parses no text, a
// Temporal.Instant prints no local time, a generic type is judged by its constraint,
// only the lock wrapper reads the start of the performance timer, and no server module
// reads the device's zone. A probe outside src/lib/time that imports temporal-polyfill
// also gets the import's refusal, so the probes of the other checks name the message
// they expect, and those of a global Temporal import nothing.
// Deliberate violations are linted in the probe project of lint-probes.ts.
import { afterAll, describe, expect, it } from 'vitest';

import { createProbes } from './lint-probes';

const { lint, ruleIds, remove } = createProbes();
const RULE = 'egoscope/no-ambient-time';
const TEMPORAL = "import { Temporal } from 'temporal-polyfill';\n\n";
const PROBE = 'src/lib/probe/probe.ts';

/** The refusals of no-ambient-time on `code`, linted as `file`, by their message IDs. */
async function refusals(file: string, code: string): Promise<readonly (string | undefined)[]> {
  const messages = await lint(file, code);
  return messages.filter((message) => message.ruleId === RULE).map(({ messageId }) => messageId);
}

describe('no-ambient-time: Temporal, the timer and server modules', { timeout: 120_000 }, () => {
  afterAll(remove);

  describe('only src/lib/time imports temporal-polyfill', () => {
    it.each([
      [
        'Temporal.PlainDate.compare of two strings',
        `${TEMPORAL}export const order = (left: string, right: string): number => Temporal.PlainDate.compare(left, right);\n`,
      ],
      [
        'toPlainDateTime given a string',
        `${TEMPORAL}export const at = (on: Temporal.PlainDate, time: string): Temporal.PlainDateTime => on.toPlainDateTime(time);\n`,
      ],
      [
        'Temporal.PlainYearMonth.from',
        `${TEMPORAL}export const month = (text: string): number => Temporal.PlainYearMonth.from(text).month;\n`,
      ],
      [
        'Temporal.PlainMonthDay.from',
        `${TEMPORAL}export const day = (text: string): number => Temporal.PlainMonthDay.from(text).day;\n`,
      ],
      [
        'Temporal.Duration.from',
        `${TEMPORAL}export const hours = (text: string): number => Temporal.Duration.from(text).hours;\n`,
      ],
      [
        'a parse through a renamed import',
        "import { Temporal as Time } from 'temporal-polyfill';\n\nexport const day = (text: string): number => Time.PlainDate.from(text).day;\n",
      ],
      [
        'a parse through a destructured class',
        `${TEMPORAL}const { PlainDate } = Temporal;\n\nexport const day = (text: string): number => PlainDate.from(text).day;\n`,
      ],
    ])('rejects %s, which no check of a call sees, by its import', async (_kind, code) => {
      expect(await refusals(PROBE, code)).toStrictEqual(['temporal']);
    });

    it.each([
      [
        'a type-only import',
        "import type { Temporal } from 'temporal-polyfill';\n\nexport type Day = Temporal.PlainDate;\n",
      ],
      ['a re-export', "export { Temporal } from 'temporal-polyfill';\n"],
      ['a re-export of everything', "export * as time from 'temporal-polyfill';\n"],
      [
        'an import()',
        "export const load = async (): Promise<unknown> => import('temporal-polyfill');\n",
      ],
      ['an import type', "export type Day = import('temporal-polyfill').Temporal.PlainDate;\n"],
      ['an import of the global entry point', "import 'temporal-polyfill/global';\n"],
      [
        'an import = require()',
        "import polyfill = require('temporal-polyfill');\n\nexport const time: unknown = polyfill;\n",
      ],
    ])('rejects %s of temporal-polyfill', async (_kind, code) => {
      expect(await refusals(PROBE, code)).toStrictEqual(['temporal']);
    });

    it('says that only @/lib/time imports temporal-polyfill, and what to do instead', async () => {
      const messages = await lint(PROBE, "import 'temporal-polyfill/global';\n");

      expect(
        messages.filter((message) => message.ruleId === RULE).map(({ message }) => message),
      ).toStrictEqual([
        '`temporal-polyfill` is imported only by `@/lib/time`, which reads, parses and converts dates and times for every other module: call its functions, or add the one you need there (CLAUDE.md, "Time").',
      ]);
    });

    it.each([
      'src/app/probe/helper.ts',
      'src/lib/probe/probe.test.ts',
      'scripts/probe.ts',
      'e2e/fixtures.ts',
      'e2e/smoke.spec.ts',
    ])('rejects temporal-polyfill in %s too', async (file) => {
      const code = `${TEMPORAL}export const iso = (): string => Temporal.Instant.fromEpochMilliseconds(0).toString();\n`;

      expect(await refusals(file, code)).toStrictEqual(['temporal']);
    });

    it('rejects a require() of temporal-polyfill in a script', async () => {
      const code = "export const polyfill: unknown = require('temporal-polyfill');\n";

      expect(await refusals('scripts/probe.ts', code)).toStrictEqual(['temporal']);
    });

    it('lets src/lib/time import temporal-polyfill, and other modules write its name in a string', async () => {
      const code = `${TEMPORAL}export const iso = (): string => Temporal.Instant.fromEpochMilliseconds(0).toString();\n`;
      const named = "export const packages: readonly string[] = ['temporal-polyfill'];\n";

      expect(await ruleIds('src/lib/time/probe.ts', code)).not.toContain(RULE);
      expect(await refusals(PROBE, named)).toStrictEqual([]);
    });
  });

  describe('Temporal reads no clock and parses no text outside src/lib/time', () => {
    const PARSES = [
      [
        'a date',
        'export const day = (text: string): number => Temporal.PlainDate.from(text).day;\n',
      ],
      [
        'a date written in the code',
        "export const day = (): number => Temporal.PlainDate.from('2026-11-10').day;\n",
      ],
      [
        'a time of day',
        'export const hour = (text: string): number => Temporal.PlainTime.from(text).hour;\n',
      ],
      [
        'a date and time',
        'export const hour = (text: string): number => Temporal.PlainDateTime.from(text).hour;\n',
      ],
      [
        'a calendar date that the time module branded',
        "import type { IsoDate } from '@/lib/time';\n\nexport const day = (on: IsoDate): number => Temporal.PlainDate.from(on).day;\n",
      ],
      [
        'an instant that may be a string',
        'export const at = (input: string | Temporal.Instant): number => Temporal.Instant.from(input).epochMilliseconds;\n',
      ],
      [
        'an instant of a generic type that may be a string',
        'export const at = <T extends string | Temporal.Instant>(input: T): number => Temporal.Instant.from(input).epochMilliseconds;\n',
      ],
      [
        'a zoned date-time that may be a string',
        'export const at = (input: string | Temporal.ZonedDateTime): number => Temporal.ZonedDateTime.from(input).epochMilliseconds;\n',
      ],
    ];

    it.each(PARSES)('rejects %s in src/lib', async (_kind, code) => {
      expect(await refusals(PROBE, `${TEMPORAL}${code}`)).toStrictEqual(['temporal', 'parse']);
    });

    it.each(PARSES)('lets src/lib/time parse %s', async (_kind, code) => {
      expect(await ruleIds('src/lib/time/probe.ts', `${TEMPORAL}${code}`)).not.toContain(RULE);
    });

    it.each([
      [
        'a parse',
        'export const day = (text: string): number => Temporal.PlainDate.from(text).day;\n',
        'parse',
      ],
      [
        'a read of the clock',
        'export const now = (): number => Temporal.Now.instant().epochMilliseconds;\n',
        'clock',
      ],
    ])(
      'rejects %s by a global Temporal, which a runtime may have, with no import',
      async (_kind, code, message) => {
        expect(await refusals(PROBE, code)).toStrictEqual([message]);
      },
    );

    it('allows Temporal values made from fields or from other Temporal values', async () => {
      const code = [
        'export const day = (): Temporal.PlainDate => Temporal.PlainDate.from({ year: 2026, month: 11, day: 10 });',
        'export const time = (): Temporal.PlainTime => Temporal.PlainTime.from({ hour: 16, minute: 30 });',
        'export const date = (zoned: Temporal.ZonedDateTime): Temporal.PlainDate => Temporal.PlainDate.from(zoned);',
        'export const wallClock = (day: Temporal.PlainDate): Temporal.PlainDateTime => Temporal.PlainDateTime.from(day);',
        'export const at = (zoned: Temporal.ZonedDateTime): Temporal.Instant => Temporal.Instant.from(zoned);',
        'export const copy = (zoned: Temporal.ZonedDateTime): Temporal.ZonedDateTime => Temporal.ZonedDateTime.from(zoned);',
        'export const fromNumber = (milliseconds: number): string => Temporal.Instant.fromEpochMilliseconds(milliseconds).toString();',
        '',
      ].join('\n');

      expect(await refusals(PROBE, `${TEMPORAL}${code}`)).toStrictEqual(['temporal']);
    });
  });

  describe('a Temporal.Instant or a Date reads no local time outside src/lib/time', () => {
    const FORMATS = [
      [
        'an instant',
        "export const text = (at: Temporal.Instant): string => at.toLocaleString('en-US');\n",
      ],
      [
        'an instant given a zone',
        "export const text = (at: Temporal.Instant): string => at.toLocaleString('en-US', { timeZone: 'UTC' });\n",
      ],
      [
        'a value that may be an instant',
        "export const text = (at: Temporal.Instant | Temporal.ZonedDateTime): string => at.toLocaleString('en-US');\n",
      ],
      [
        'an instant of a generic type',
        "export const text = <T extends Temporal.Instant>(at: T): string => at.toLocaleString('en-US');\n",
      ],
      [
        'the instant of a zoned date-time',
        "export const text = (zoned: Temporal.ZonedDateTime): string => zoned.toInstant().toLocaleString('en-US');\n",
      ],
    ];

    it.each(FORMATS)('rejects the locale format of %s in src/lib', async (_kind, code) => {
      expect(await refusals(PROBE, `${TEMPORAL}${code}`)).toStrictEqual(['temporal', 'zone']);
    });

    it.each(FORMATS)('lets src/lib/time give the locale format of %s', async (_kind, code) => {
      expect(await ruleIds('src/lib/time/probe.ts', `${TEMPORAL}${code}`)).not.toContain(RULE);
    });

    it('allows the locale formats of Temporal values that carry their own zone or none', async () => {
      const code = [
        "export const zoned = (at: Temporal.ZonedDateTime): string => at.toLocaleString('en-US');",
        "export const day = (on: Temporal.PlainDate): string => on.toLocaleString('en-US');",
        'export const iso = (at: Temporal.Instant): string => at.toString();',
        '',
      ].join('\n');

      expect(await refusals(PROBE, `${TEMPORAL}${code}`)).toStrictEqual(['temporal']);
    });

    it('rejects the local time of a Date of a generic type, in src/lib and in the pure core', async () => {
      const code = 'export const hour = <T extends Date>(at: T): number => at.getHours();\n';

      expect(await refusals(PROBE, code)).toStrictEqual(['zone']);
      expect(await ruleIds('src/lib/stats-engine/probe.ts', code)).toContain(
        'egoscope/no-local-time',
      );
    });
  });

  describe('only the lock wrapper reads the start of the performance timer', () => {
    const TIME_ORIGIN = 'export const startedAt = (): number => performance.timeOrigin;\n';
    const DESTRUCTURED =
      'export const startedAt = (): number => {\n  const { timeOrigin } = performance;\n  return timeOrigin;\n};\n';

    it.each([
      PROBE,
      'src/app/probe/helper.ts',
      'scripts/probe.ts',
      'e2e/fixtures.ts',
      'e2e/smoke.spec.ts',
    ])('rejects performance.timeOrigin in %s', async (file) => {
      expect(await refusals(file, TIME_ORIGIN)).toStrictEqual(['clock']);
    });

    it.each([
      [
        'through globalThis',
        'export const startedAt = (): number => globalThis.performance.timeOrigin;\n',
      ],
      [
        'under another name',
        "import { performance as timer } from 'node:perf_hooks';\n\nexport const startedAt = (): number => timer.timeOrigin;\n",
      ],
      ['destructured', DESTRUCTURED],
      [
        'destructured in a parameter',
        'export const startedAt = ({ timeOrigin }: Performance): number => timeOrigin;\n',
      ],
    ])('rejects performance.timeOrigin %s', async (_kind, code) => {
      expect(await refusals('scripts/probe.ts', code)).toStrictEqual(['clock']);
    });

    it('lets a module read a timeOrigin of its own, which no performance timer holds', async () => {
      const code = [
        'type Lease = Readonly<{ timeOrigin: number }>;',
        'export const origin = (lease: Lease): number => lease.timeOrigin;',
        'export const start = ({ timeOrigin }: Lease): number => timeOrigin;',
        '',
      ].join('\n');

      expect(await refusals('scripts/probe.ts', code)).toStrictEqual([]);
    });

    it.each(['scripts/with-lock.ts', 'scripts/signal-relay.ts'])(
      'lets %s, a file of the lock wrapper, read performance.timeOrigin, destructured or not',
      async (file) => {
        expect(await refusals(file, TIME_ORIGIN)).toStrictEqual([]);
        expect(await refusals(file, DESTRUCTURED)).toStrictEqual([]);
      },
    );

    it.each(['scripts/with-lock.ts', 'scripts/signal-relay.ts'])(
      'rejects the clock in %s, a file of the lock wrapper',
      async (file) => {
        const code = 'export const now = (): number => Date.now();\n';

        expect(await refusals(file, code)).toStrictEqual(['clock']);
      },
    );

    it.each([PROBE, 'scripts/probe.ts', 'e2e/fixtures.ts'])(
      'lets %s time a duration with performance.now()',
      async (file) => {
        const code =
          'export const elapsed = (start: number): number => performance.now() - start;\n';

        expect(await refusals(file, code)).toStrictEqual([]);
      },
    );
  });

  describe("no server module reads the device's zone", () => {
    const NAMED = "import { deviceTimeZone } from '@/lib/time';";
    const NAMESPACE = "import * as time from '@/lib/time';";

    it.each([
      ['a named import', NAMED, 'deviceTimeZone()'],
      ['a namespace import', NAMESPACE, 'time.deviceTimeZone()'],
    ])(
      "rejects deviceTimeZone in a module that starts with 'use server', through %s",
      async (_kind, line, call) => {
        const code = `'use server';\n\n${line}\n\nexport async function zone(): Promise<string> {\n  return ${call};\n}\n`;

        expect(await ruleIds('src/app/probe/helper.ts', code)).toContain(RULE);
      },
    );

    it.each([
      ['a named import', NAMED, 'deviceTimeZone()'],
      ['a namespace import', NAMESPACE, 'time.deviceTimeZone()'],
    ])('rejects deviceTimeZone in a route handler, through %s', async (_kind, line, call) => {
      const code = `${line}\n\nexport function GET(): Response {\n  return Response.json({ zone: ${call} });\n}\n`;

      expect(await ruleIds('src/app/probe/route.ts', code)).toContain(RULE);
    });

    it("lets a module read the device's zone when 'use server' is not the directive at its top", async () => {
      const code = `${NAMED}\n\n'use server';\n\nexport const zone = (): string => deviceTimeZone();\n`;

      expect(await ruleIds('src/app/probe/helper.ts', code)).not.toContain(RULE);
    });
  });
});
