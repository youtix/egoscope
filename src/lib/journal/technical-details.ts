import { z } from 'zod';

import { incidents } from '@/lib/db';
import { toEpochMs } from '@/lib/time';

// The longest error message kept from a service's error object (CL-DSN-11).
const MAX_ERROR_MESSAGE_LENGTH = 300;

/**
 * The technical details of an entry, stored apart and hidden unless asked for, for
 * whoever helps the owner diagnose a problem (TRV-44). They hold the allowlist of
 * CL-DSN-11 and nothing else: the service, the operation, the instant, the duration, the
 * HTTP status or error code, the code and message of an error object the service
 * returned, at most 300 characters and never from a successful response, request
 * identifiers, sizes and counts, and a structured response's validation outcome. Never
 * a request or response body, a feed item, an article's title, link or excerpt, a model
 * output, a prompt or anything of DSN-18 (DSN-11).
 */
const technicalDetailsSchema = z.object({
  service: z.enum(incidents.serviceRole.enumValues).optional(),
  operation: z.string().optional(),
  at: z
    .number()
    .int()
    .transform((value) => toEpochMs(value))
    .optional(),
  durationMs: z.number().nonnegative().optional(),
  httpStatus: z.number().int().optional(),
  errorCode: z.string().optional(),
  errorMessage: z
    .string()
    .transform((message) => message.slice(0, MAX_ERROR_MESSAGE_LENGTH))
    .optional(),
  requestIds: z.array(z.string()).readonly().optional(),
  bytes: z.number().int().nonnegative().optional(),
  items: z.number().int().nonnegative().optional(),
  tokens: z.number().int().nonnegative().optional(),
  validation: z
    .object({ field: z.string(), position: z.number().int().nonnegative().optional() })
    .optional(),
});

/** The technical details of an entry, as its writer gives them (TRV-44, CL-DSN-11). */
export type TechnicalDetails = Readonly<z.input<typeof technicalDetailsSchema>>;

/** The technical details as the journal keeps and shows them: an error message cut at 300 characters. */
export type StoredTechnicalDetails = Readonly<z.output<typeof technicalDetailsSchema>>;

/**
 * The details that the journal keeps of `details`: the allowlisted keys only, whatever
 * else a caller's object carries, and an error message cut at 300 characters
 * (TRV-44, DSN-11, CL-DSN-11).
 */
export function keptDetails(details: TechnicalDetails): StoredTechnicalDetails {
  return technicalDetailsSchema.parse(details);
}

/** The kept details of a stored row, read back for whoever asks to see them (TRV-44). */
export function readDetails(stored: unknown): StoredTechnicalDetails {
  return technicalDetailsSchema.parse(stored);
}
