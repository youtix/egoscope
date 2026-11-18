// Proves what no-ambient-time refuses of Temporal and of server modules, beside the
// harmless forms that it lets through: Temporal parses no text, a Temporal.Instant
// prints no local time, and no server module reads the device's zone. Deliberate
// violations are linted in the probe project of lint-probes.ts.
import { afterAll, describe, expect, it } from 'vitest';

import { createProbes } from './lint-probes';

const { ruleIds, remove } = createProbes();
const RULE = 'egoscope/no-ambient-time';
const TEMPORAL = "import { Temporal } from 'temporal-polyfill';\n\n";

describe('no-ambient-time: Temporal and server modules', { timeout: 120_000 }, () => {
  afterAll(remove);

  describe('Temporal parses no text outside src/lib/time', () => {
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
        'a zoned date-time that may be a string',
        'export const at = (input: string | Temporal.ZonedDateTime): number => Temporal.ZonedDateTime.from(input).epochMilliseconds;\n',
      ],
    ];

    it.each(PARSES)('rejects %s in src/lib', async (_kind, code) => {
      expect(await ruleIds('src/lib/probe/probe.ts', `${TEMPORAL}${code}`)).toContain(RULE);
    });

    it.each(PARSES)('lets src/lib/time parse %s', async (_kind, code) => {
      expect(await ruleIds('src/lib/time/probe.ts', `${TEMPORAL}${code}`)).not.toContain(RULE);
    });

    it('allows Temporal values made from fields or from other Temporal values', async () => {
      const code = [
        'export const day = (): Temporal.PlainDate => Temporal.PlainDate.from({ year: 2026, month: 11, day: 10 });',
        'export const time = (): Temporal.PlainTime => Temporal.PlainTime.from({ hour: 16, minute: 30 });',
        'export const date = (zoned: Temporal.ZonedDateTime): Temporal.PlainDate => Temporal.PlainDate.from(zoned);',
        'export const wallClock = (day: Temporal.PlainDate): Temporal.PlainDateTime => Temporal.PlainDateTime.from(day);',
        'export const at = (zoned: Temporal.ZonedDateTime): Temporal.Instant => Temporal.Instant.from(zoned);',
        'export const copy = (zoned: Temporal.ZonedDateTime): Temporal.ZonedDateTime => Temporal.ZonedDateTime.from(zoned);',
        '',
      ].join('\n');

      expect(await ruleIds('src/lib/probe/probe.ts', `${TEMPORAL}${code}`)).not.toContain(RULE);
    });
  });

  describe('a Temporal.Instant prints no local time outside src/lib/time', () => {
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
        'the instant of a zoned date-time',
        "export const text = (zoned: Temporal.ZonedDateTime): string => zoned.toInstant().toLocaleString('en-US');\n",
      ],
    ];

    it.each(FORMATS)('rejects the locale format of %s in src/lib', async (_kind, code) => {
      expect(await ruleIds('src/lib/probe/probe.ts', `${TEMPORAL}${code}`)).toContain(RULE);
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

      expect(await ruleIds('src/lib/probe/probe.ts', `${TEMPORAL}${code}`)).not.toContain(RULE);
    });
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
