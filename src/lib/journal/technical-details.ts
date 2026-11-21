import { z } from 'zod';

import { incidents } from '@/lib/db';
import { redact } from '@/lib/env';
import { toEpochMs } from '@/lib/time';

// The longest error message kept from a service's error object (CL-DSN-11).
const MAX_ERROR_MESSAGE_LENGTH = 300;

// A text of the details, which no secret of the configuration ever reaches: each one
// is replaced by its mask, "[secret]", so that the details never hold a password, a
// key or a token (TRV-44, TRV-64).
const detailText = z.string().transform((text) => redact(text));

/**
 * The technical details of an entry, stored apart and hidden unless asked for, for
 * whoever helps the owner diagnose a problem (TRV-44). They hold the allowlist of
 * CL-DSN-11 and nothing else: the service, the operation, the instant, the duration, the
 * HTTP status or error code, the code and message of an error object the service
 * returned, at most 300 characters and never from a successful response, request
 * identifiers, sizes and counts, and a structured response's validation outcome. Never
 * a request or response body, a feed item, an article's title, link or excerpt, a model
 * output, a prompt or anything of DSN-18 (DSN-11), and never a secret of the
 * configuration, which every text of them loses before it is kept, an error message
 * before its cut (TRV-44).
 */
const technicalDetailsSchema = z.object({
  service: z.enum(incidents.serviceRole.enumValues).optional(),
  operation: detailText.optional(),
  at: z
    .number()
    .int()
    .transform((value) => toEpochMs(value))
    .optional(),
  durationMs: z.number().nonnegative().optional(),
  httpStatus: z.number().int().optional(),
  errorCode: detailText.optional(),
  errorMessage: detailText
    .transform((message) => message.slice(0, MAX_ERROR_MESSAGE_LENGTH))
    .optional(),
  requestIds: z.array(detailText).readonly().optional(),
  bytes: z.number().int().nonnegative().optional(),
  items: z.number().int().nonnegative().optional(),
  tokens: z.number().int().nonnegative().optional(),
  validation: z
    .object({ field: detailText, position: z.number().int().nonnegative().optional() })
    .optional(),
});

/** The technical details of an entry, as its writer gives them (TRV-44, CL-DSN-11). */
export type TechnicalDetails = Readonly<z.input<typeof technicalDetailsSchema>>;

/** The technical details as the journal keeps and shows them: no secret, an error message cut at 300 characters. */
export type StoredTechnicalDetails = Readonly<z.output<typeof technicalDetailsSchema>>;

/**
 * The details that the journal keeps of `details`: the allowlisted keys only, whatever
 * else a caller's object carries, every secret of the configuration masked in their
 * texts, then an error message cut at 300 characters (TRV-44, TRV-64, DSN-11, CL-DSN-11).
 */
export function keptDetails(details: TechnicalDetails): StoredTechnicalDetails {
  return technicalDetailsSchema.parse(details);
}

/** The kept details of a stored row, read back for whoever asks to see them (TRV-44). */
export function readDetails(stored: unknown): StoredTechnicalDetails {
  return technicalDetailsSchema.parse(stored);
}
