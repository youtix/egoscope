export type { LinkCheckError } from './errors';
export { createFakeLinkCheck } from './fake';
export type { FakeLinkCheck, ScriptedAnswer } from './fake';
export { fakeLinkCheck, linkCheck } from './port';
export type { LinkCheck, LinkCheckOutcome } from './port';
export type { CallContext, CallMetadata, LinkProbe, LinkVerdict, ProbeRequest } from './types';
