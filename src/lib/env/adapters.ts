import { DEFAULT_LOT, readServerEnv } from './server-env';

import type { Lot, Port } from './server-env';

/** Which adapter serves a port: its real one, or its fake. */
export type AdapterKind = 'real' | 'fake';

/**
 * The adapter that serves `port`, which the port's accessor returns: its fake
 * when EGOSCOPE_FAKES lists it or says `all`, and its real adapter otherwise.
 * Fakes serve only on a valid configuration, which never carries them beside a
 * real credential or on a production deployment, so that they stay with
 * development and the hermetic end-to-end mode (TRV-64).
 */
export function adapterFor(port: Port): AdapterKind {
  const env = readServerEnv();
  const fakes = env.ok ? env.env.EGOSCOPE_FAKES : undefined;
  return fakes === 'all' || fakes?.includes(port) === true ? 'fake' : 'real';
}

/**
 * The lot that this build serves, set by EGOSCOPE_LOT (H-12, ADR 0001): 1 by
 * default, and the default while the configuration is invalid. A Lot 2 screen,
 * task or reaction stays inactive while it is 1 (TRV-37).
 */
export function activeLot(): Lot {
  const env = readServerEnv();
  return env.ok ? env.env.EGOSCOPE_LOT : DEFAULT_LOT;
}
