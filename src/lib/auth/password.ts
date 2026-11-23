import 'server-only';

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import type { BinaryLike, ScryptOptions } from 'node:crypto';

// scrypt's cost (N = 2^15), block size and parallelism (RFC 7914), and twice the 32 MiB
// they need as the memory ceiling, since Node refuses a computation that reaches it.
const COST = 32_768;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const MAX_MEMORY = 67_108_864;
const KEY_BYTES = 64;
const SALT_BYTES = 16;
const SCHEME = 'scrypt';
const SEPARATOR = '$';
const ENCODING = 'base64url';
// Splits a text into the characters a person sees, an accented letter or an emoji each one.
const CHARACTERS = new Intl.Segmenter('en', { granularity: 'grapheme' });

// scrypt with its options; `promisify` alone would take the overload without them.
const scryptKey = promisify<BinaryLike, BinaryLike, number, ScryptOptions, Buffer>(scrypt);

/** The derived key of `password`, its Unicode form normalized so that every device types it alike. */
async function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return scryptKey(password.normalize('NFKC'), salt, KEY_BYTES, options);
}

/**
 * The stored form of `password` (TRV-60): a scrypt hash with a salt of its own, which
 * names its parameters, `scrypt$N$r$p$salt$key`, and from which the password cannot be read.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const options = { N: COST, r: BLOCK_SIZE, p: PARALLELISM, maxmem: MAX_MEMORY };
  const key = await derive(password, salt, options);
  return [
    SCHEME,
    COST,
    BLOCK_SIZE,
    PARALLELISM,
    salt.toString(ENCODING),
    key.toString(ENCODING),
  ].join(SEPARATOR);
}

/**
 * Says whether `password` is the one that `stored` was made from (TRV-60), comparing the
 * keys in constant time; a stored value of another form matches no password.
 */
export async function isSamePassword(password: string, stored: string): Promise<boolean> {
  const [scheme, cost, blockSize, parallelism, salt, key] = stored.split(SEPARATOR);
  if (scheme !== SCHEME || salt === undefined || key === undefined) {
    return false;
  }
  const expected = Buffer.from(key, ENCODING);
  const options = {
    N: Number(cost),
    r: Number(blockSize),
    p: Number(parallelism),
    maxmem: MAX_MEMORY,
  };
  const actual = await derive(password, Buffer.from(salt, ENCODING), options);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Says whether `password` has at least `minLength` characters, counted as a person counts them (TRV-60). */
export function isLongEnough(password: string, minLength: number): boolean {
  return [...CHARACTERS.segment(password)].length >= minLength;
}
