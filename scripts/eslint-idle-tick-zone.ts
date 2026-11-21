/**
 * The layer zone of the idle tick, which eslint.config.ts adds to `layerZones` and
 * eslint-idle-tick-zone.test.ts probes. An idle tick decides from the wake plan alone,
 * so that a tick with nothing due opens no database connection (module map §1.6 and
 * §1.9, record 0025): `src/lib/wake-plan`, and the `src/lib/runtime-cache` port it reads
 * the plan through, never import `src/lib/db`, their tests included. Its paths are
 * relative to the base path of the zones.
 */
export const IDLE_TICK_ZONE = {
  target: ['./src/lib/wake-plan', './src/lib/runtime-cache'],
  from: './src/lib/db',
  message:
    'src/lib/wake-plan and src/lib/runtime-cache never touch the database, so that an idle tick decides without it (module map §1.9).',
} as const;
