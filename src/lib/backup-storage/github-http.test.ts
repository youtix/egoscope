import { describe, expect, it } from 'vitest';

import { parseServerEnv } from '@/lib/env';
import { now, toEpochMs } from '@/lib/time';

import { errorOf, GithubCall } from './github-http';

import type { Secret } from '@/lib/env';

const RATE_LIMITED = { kind: 'rate_limited' };
const TOKEN_REJECTED = { kind: 'unauthorized', cause: 'token_rejected' };
const CALL_BUDGET_MS = 10_000;
const PERMISSION = JSON.stringify({
  message: 'Resource not accessible by personal access token',
  status: '403',
});
const SECONDARY_LIMIT = JSON.stringify({
  message:
    'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.',
  status: '403',
});

/** The token as the configuration gives it. */
function secret(value: string): Secret {
  const parsed = parseServerEnv({ BACKUP_GITHUB_TOKEN: value });
  const token = parsed.ok ? parsed.env.BACKUP_GITHUB_TOKEN : undefined;
  if (token === undefined) {
    throw new Error('The test token does not parse.');
  }
  return token;
}

/** The headers of an answer that has `remaining` requests left in its window. */
function left(remaining: string, more: Readonly<Record<string, string>> = {}): Headers {
  return new Headers({ 'x-ratelimit-remaining': remaining, ...more });
}

describe('errorOf', () => {
  it.each([
    { what: '403 with no request left', status: 403, headers: left('0'), text: PERMISSION },
    {
      what: '403 with retry-after, a permission message and requests left',
      status: 403,
      headers: left('4988', { 'retry-after': '60' }),
      text: PERMISSION,
    },
    {
      what: '403 with the message of the secondary limit and neither header',
      status: 403,
      headers: left('4989'),
      text: SECONDARY_LIMIT,
    },
    {
      what: '403 whose message names the limit in other letter cases',
      status: 403,
      headers: new Headers(),
      text: JSON.stringify({ message: 'API Rate Limit exceeded for user ID 900000002.' }),
    },
    { what: '429', status: 429, headers: new Headers(), text: '' },
  ])('[TRV-47] reads $what as the rate limit', ({ status, headers, text }) => {
    expect(errorOf(status, headers, text)).toStrictEqual(RATE_LIMITED);
  });

  it.each([
    { what: 'a permission message and requests left', text: PERMISSION },
    { what: 'an empty body', text: '' },
    { what: 'a body that is no JSON', text: 'rate limit <html>' },
    { what: 'a message that is no text', text: JSON.stringify({ message: 403 }) },
    { what: 'a JSON body without a message', text: JSON.stringify(['rate limit']) },
    { what: 'a JSON null', text: 'null' },
  ])('[TRV-47] reads a 403 with $what as a rejected token', ({ text }) => {
    expect(errorOf(403, left('4993'), text)).toStrictEqual(TOKEN_REJECTED);
  });

  it.each([
    { status: 401, text: SECONDARY_LIMIT, error: TOKEN_REJECTED },
    { status: 404, text: SECONDARY_LIMIT, error: { kind: 'not_found' } },
    { status: 502, text: SECONDARY_LIMIT, error: { kind: 'unavailable' } },
  ])(
    '[TRV-47] reads $status as $error.kind, whatever its message says',
    ({ status, text, error }) => {
      expect(errorOf(status, left('4993'), text)).toStrictEqual(error);
    },
  );
});

describe('GithubCall.stream', () => {
  it('[TRV-47] reads a refused download whose body is cut off as an empty body', async () => {
    const call = new GithubCall(fetch, secret('invented-token-for-tests'), {
      deadline: toEpochMs(now() + CALL_BUDGET_MS),
      signal: new AbortController().signal,
    });
    const cut = new ReadableStream({
      start: (controller) => {
        controller.error(new TypeError('terminated'));
      },
    });
    const texts: string[] = [];

    await expect(
      call.stream(new Response(cut, { status: 403 }), (status, headers, text) => {
        texts.push(text);
        return errorOf(status, headers, text);
      }),
    ).resolves.toStrictEqual({ ok: false, error: TOKEN_REJECTED });
    expect(texts).toStrictEqual(['']);
  });
});
