/**
 * Why the storage refuses the app: its configuration lacks the space or the
 * token, or the token was rejected, expired or revoked (TRV-47, CL-TRV-04).
 */
export type UnauthorizedCause = 'not_configured' | 'token_rejected';

/**
 * The failures of the backup storage (module map §5): refused access, a file or
 * container that does not exist, a file above the size limit, the provider's rate
 * limit, and an unreachable or failing service, an interrupted upload included.
 */
export type BackupStorageError =
  | Readonly<{ kind: 'unauthorized'; cause: UnauthorizedCause }>
  | Readonly<{ kind: 'not_found' }>
  | Readonly<{ kind: 'too_large' }>
  | Readonly<{ kind: 'rate_limited' }>
  | Readonly<{ kind: 'unavailable' }>;

/** What a storage without its space or its token answers to every call, before any request (TRV-47). */
export const NOT_CONFIGURED: BackupStorageError = { kind: 'unauthorized', cause: 'not_configured' };
