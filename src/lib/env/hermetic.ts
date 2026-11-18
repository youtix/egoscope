import { readServerEnv } from './server-env';

const FAKES = 'EGOSCOPE_FAKES';

export type FakesSwitchError = Readonly<{
  kind: 'refused-fakes';
  /** Names of the invalid variables, the fakes switch among them. Their values are never reported. */
  variables: readonly string[];
}>;

export type FakesSwitchCheck =
  Readonly<{ ok: true }> | Readonly<{ ok: false; error: FakesSwitchError }>;

/**
 * Says whether this server runs in the hermetic mode of the end-to-end tests:
 * `EGOSCOPE_FAKES=all` on a valid configuration, so every outside service is a
 * fake, no real credential is set and no production deployment runs it (TRV-64).
 * Every route under /api/test/ answers 404 unless it does.
 */
export function isHermetic(): boolean {
  const env = readServerEnv();
  return env.ok && env.env.EGOSCOPE_FAKES === 'all';
}

/**
 * Says whether the fakes switch lets this server start: not while the switch is
 * invalid, whether set beside a real credential, on a production deployment or
 * misspelled, so that fakes never serve where a credential could reach a real
 * service, and a misspelled list never falls back on real services (TRV-64).
 */
export function checkFakesSwitch(): FakesSwitchCheck {
  const env = readServerEnv();
  return env.ok || !env.error.variables.includes(FAKES)
    ? { ok: true }
    : { ok: false, error: { kind: 'refused-fakes', variables: env.error.variables } };
}
