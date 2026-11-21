import 'server-only';

import { adapterFor } from '@/lib/env';

import { createFakeLinkCheck } from './fake';
import { createHttpLinkCheck } from './http';

import type { LinkCheckError } from './errors';
import type { FakeLinkCheck } from './fake';
import type { CallContext, CallMetadata, LinkProbe, ProbeRequest } from './types';

/** A probe's answer, with what it cost whether it gave a verdict or not (module map §5). */
export type LinkCheckOutcome = Readonly<
  | { ok: true; value: LinkProbe; call: CallMetadata }
  | { ok: false; error: LinkCheckError; call: CallMetadata }
>;

/**
 * The check of a public article link (IMP-17): one GET, up to 5 redirects, the
 * request's timeout, no cookie and a generic user agent that carries nothing about
 * the owner (CL-IMP-25, TRV-66).
 */
export type LinkCheck = Readonly<{
  probe: (ctx: CallContext, request: ProbeRequest) => Promise<LinkCheckOutcome>;
}>;

// The fake of the whole process lives on globalThis under a registered symbol, so
// that every copy of this module serves the same scripted answers.
const SHARED_FAKE = Symbol.for('egoscope.link-check.fake');

const isFake = (value: unknown): value is FakeLinkCheck =>
  typeof value === 'object' && value !== null && 'answer' in value;

/**
 * The fake that the whole process shares, which the accessor serves under
 * EGOSCOPE_FAKES, and which the hermetic end-to-end controls script (IMP-17).
 */
export function fakeLinkCheck(): FakeLinkCheck {
  const existing: unknown = Reflect.get(globalThis, SHARED_FAKE);
  if (isFake(existing)) {
    return existing;
  }
  const fake = createFakeLinkCheck();
  Reflect.set(globalThis, SHARED_FAKE, fake);
  return fake;
}

/**
 * The link check that `env.adapterFor` names (module map §5): the shared fake under
 * EGOSCOPE_FAKES, the plain HTTP adapter otherwise (IMP-17).
 */
export function linkCheck(): LinkCheck {
  return adapterFor('link-check') === 'fake' ? fakeLinkCheck() : createHttpLinkCheck();
}
