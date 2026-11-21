import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import { Secret } from './secret-value';
import { isSecret } from './secrets';
import { SERVER_ENV_VARIABLES } from './server-env';

const MASK = '[secret]';
// Made-up secrets, in the shapes that the schema accepts.
const BOT_TOKEN = '123456:made-up-bot-token';
const POOLED = 'postgresql://app@pooled.example.invalid/egoscope?sslmode=verify-full';
const DIRECT = `${POOLED}&application_name=migrations`;

/**
 * The `redact` of a server whose configuration holds `variables`: its modules
 * load afresh and read that configuration.
 */
async function redactOf(variables: Readonly<Record<string, string>>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(variables)) {
    vi.stubEnv(name, value);
  }
  const { redact } = await import('./secrets');
  return redact;
}

describe('isSecret', () => {
  it('[TRV-64] answers for every variable of the schema whether it holds a secret', () => {
    const answers = Object.fromEntries(SERVER_ENV_VARIABLES.map((name) => [name, isSecret(name)]));

    expect(answers).toStrictEqual({
      LOG_LEVEL: false,
      NODE_ENV: false,
      VERCEL_ENV: false,
      VERCEL_DEPLOYMENT_ID: false,
      APP_BASE_URL: false,
      DATABASE_URL: true,
      DATABASE_URL_UNPOOLED: true,
      CRON_SECRET: true,
      INITIAL_PASSWORD: true,
      FINGERPRINT_KEY: true,
      BACKUP_GITHUB_REPOSITORY: false,
      BACKUP_GITHUB_TOKEN: true,
      BACKUP_ENCRYPTION_KEY: true,
      STATS_SOURCE_BASE_URL: false,
      CLOUDFLARE_ACCOUNT_ID: false,
      CLOUDFLARE_AI_API_TOKEN: true,
      GROQ_API_KEY: true,
      TELEGRAM_BOT_TOKEN: true,
      TELEGRAM_WEBHOOK_SECRET: true,
      EGOSCOPE_LOT: false,
      EGOSCOPE_FAKES: false,
    });
  });

  it.each(['HOME', 'SESSION_SECRET', 'database_url', ''])(
    'answers false for %j, which the schema does not declare',
    (name) => {
      expect(isSecret(name)).toBe(false);
    },
  );
});

describe('redact, examples', () => {
  it('[TRV-64] masks each secret of the configuration in a text, a secret that holds another whole', async () => {
    const redact = await redactOf({ DATABASE_URL: POOLED, DATABASE_URL_UNPOOLED: DIRECT });

    expect(redact(`migrating through ${DIRECT}, serving through ${POOLED}.`)).toBe(
      'migrating through [secret], serving through [secret].',
    );
  });

  it('[TRV-64] masks a secret made of the syntax of a regular expression, and nothing like it', async () => {
    const password = String.raw`p.s*w+r?d(1)[2]{3}|4\5^6$`;
    const redact = await redactOf({ INITIAL_PASSWORD: password });

    expect(redact(`${password} is not pXsswwrd1`)).toBe('[secret] is not pXsswwrd1');
  });

  it('[TRV-64] masks an error, with its name, message, stack, cause and own fields', async () => {
    const redact = await redactOf({ TELEGRAM_BOT_TOKEN: BOT_TOKEN });
    const refused = Object.assign(new Error(`connect ECONNREFUSED bot${BOT_TOKEN}`), {
      code: 'ECONNREFUSED',
    });
    const failure = new TypeError(`fetch failed: https://api.telegram.org/bot${BOT_TOKEN}/getMe`, {
      cause: refused,
    });
    // Each stack starts with its error's message, the token included.
    const stackOf = (error: Error): string => error.stack?.replaceAll(BOT_TOKEN, () => MASK) ?? '';

    expect([failure.stack, refused.stack]).toStrictEqual([
      expect.stringContaining(BOT_TOKEN),
      expect.stringContaining(BOT_TOKEN),
    ]);
    expect(redact(failure)).toStrictEqual({
      name: 'TypeError',
      message: 'fetch failed: https://api.telegram.org/bot[secret]/getMe',
      stack: stackOf(failure),
      cause: {
        name: 'Error',
        message: 'connect ECONNREFUSED bot[secret]',
        stack: stackOf(refused),
        code: 'ECONNREFUSED',
      },
    });
  });

  it('[TRV-64] gives every other value its JSON form, masked at any depth, keys included', async () => {
    const redact = await redactOf({ TELEGRAM_BOT_TOKEN: BOT_TOKEN });
    const answer = {
      url: new URL(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`),
      at: new Date(Date.UTC(2026, 10, 21, 9)),
      [BOT_TOKEN]: [{ token: new Secret(BOT_TOKEN) }, `bot${BOT_TOKEN}`],
      count: 3,
      ok: false,
      big: 10n,
      none: null,
      missing: undefined,
      call: () => BOT_TOKEN,
      mark: Symbol(BOT_TOKEN),
    };

    expect(redact(answer)).toStrictEqual({
      url: 'https://api.telegram.org/bot[secret]/getMe',
      at: '2026-11-21T09:00:00.000Z',
      [MASK]: [{ token: MASK }, 'bot[secret]'],
      count: 3,
      ok: false,
      big: 10n,
      none: null,
      missing: undefined,
      call: undefined,
      mark: undefined,
    });
  });

  it('replaces an object found inside itself, and copies an object met twice elsewhere', async () => {
    const redact = await redactOf({ TELEGRAM_BOT_TOKEN: BOT_TOKEN });
    const shared = { token: BOT_TOKEN };
    const loop: Record<string, unknown> = { first: shared, second: [shared] };
    loop['self'] = loop;

    expect(redact(loop)).toStrictEqual({
      first: { token: MASK },
      second: [{ token: MASK }],
      self: '[circular]',
    });
  });

  it.each([
    ['holds no secret', { LOG_LEVEL: 'debug' }],
    [
      'is invalid, so that no secret reached a service',
      { LOG_LEVEL: 'INFO', TELEGRAM_BOT_TOKEN: BOT_TOKEN },
    ],
  ])('masks nothing while the configuration %s', async (_case, variables) => {
    const redact = await redactOf(variables);

    expect(redact(`bot${BOT_TOKEN}`)).toBe(`bot${BOT_TOKEN}`);
    expect(redact({ token: BOT_TOKEN })).toStrictEqual({ token: BOT_TOKEN });
  });
});

// The secret variables that a property configures, with values of their shapes:
// texts that a provider or the owner gives, of printable characters but spaces,
// generated keys, and connection strings.
const SECRET_NAMES = [
  'INITIAL_PASSWORD',
  'BACKUP_GITHUB_TOKEN',
  'CLOUDFLARE_AI_API_TOKEN',
  'GROQ_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'CRON_SECRET',
  'BACKUP_ENCRYPTION_KEY',
  'DATABASE_URL',
] as const;

type SecretName = (typeof SECRET_NAMES)[number];

const printable = fc.integer({ min: 0x21, max: 0x7e }).map((code) => String.fromCodePoint(code));
const textSecret = fc.string({ unit: printable, minLength: 1, maxLength: 12 });
const key = fc.uint8Array({ minLength: 32, maxLength: 32 }).map((bytes) => Buffer.from(bytes));

const configuration: fc.Arbitrary<Readonly<Record<SecretName, string>>> = fc.record({
  INITIAL_PASSWORD: textSecret,
  BACKUP_GITHUB_TOKEN: textSecret,
  CLOUDFLARE_AI_API_TOKEN: textSecret,
  GROQ_API_KEY: textSecret,
  TELEGRAM_BOT_TOKEN: textSecret,
  CRON_SECRET: key.map((bytes) => bytes.toString('base64url')),
  BACKUP_ENCRYPTION_KEY: key.map((bytes) => bytes.toString('base64')),
  DATABASE_URL: key.map(
    (bytes) =>
      `postgresql://app:${bytes.toString('base64url')}@db.example.invalid/egoscope?sslmode=verify-full`,
  ),
});

// What separates the secrets of a text: characters that no secret holds.
const separatorUnit = fc.constantFrom(' ', '\n', '\t', 'é', '—');
const lead = fc.string({ unit: separatorUnit, maxLength: 3 });
const separator = fc.string({ unit: separatorUnit, minLength: 1, maxLength: 3 });

/** A text made of separators and secrets, each secret followed by a separator. */
type Parts = Readonly<{ lead: string; pieces: readonly (readonly [SecretName, string])[] }>;

const piece = fc.tuple(fc.constantFrom(...SECRET_NAMES), separator);
const parts: fc.Arbitrary<Parts> = fc.record({
  lead,
  pieces: fc.array(piece, { size: 'small' }),
});

/** The text of `text`, with `valueOf` in place of each secret. */
const render = (text: Parts, valueOf: (name: SecretName) => string): string =>
  text.lead + text.pieces.map(([name, after]) => `${valueOf(name)}${after}`).join('');

type Tree =
  | Readonly<{ text: Parts }>
  | Readonly<{ list: readonly Tree[] }>
  | Readonly<{ record: readonly (readonly [Parts, Tree])[] }>;

/** A list of at most three nodes. */
const listOf = (node: fc.Arbitrary<Tree>): fc.Arbitrary<Tree> =>
  fc.array(node, { maxLength: 3 }).map((list) => ({ list }));

/** A record of at most three nodes, under keys made like texts. */
const recordOf = (node: fc.Arbitrary<Tree>): fc.Arbitrary<Tree> =>
  fc.array(fc.tuple(parts, node), { maxLength: 3 }).map((record) => ({ record }));

const { tree } = fc.letrec<{ tree: Tree }>((tie) => ({
  tree: fc.oneof(
    { depthSize: 'small' },
    parts.map((text) => ({ text })),
    listOf(tie('tree')),
    recordOf(tie('tree')),
  ),
}));

/** The value of `node`, with `valueOf` in place of each secret of its texts and keys. */
function build(node: Tree, valueOf: (name: SecretName) => string): unknown {
  if ('text' in node) {
    return render(node.text, valueOf);
  }
  if ('list' in node) {
    return node.list.map((item) => build(item, valueOf));
  }
  return Object.fromEntries(
    node.record.map(([name, item]) => [render(name, valueOf), build(item, valueOf)]),
  );
}

describe('redact, over generated secrets', () => {
  it('[TRV-64] replaces every secret of a text with the mask, and changes nothing else', async () => {
    await fc.assert(
      fc.asyncProperty(configuration, parts, async (secrets, text) => {
        const redact = await redactOf(secrets);

        expect(redact(render(text, (name) => secrets[name]))).toBe(render(text, () => MASK));
      }),
    );
  });

  it('[TRV-64] replaces every secret of an object, at any depth and in its keys, and changes nothing else', async () => {
    await fc.assert(
      fc.asyncProperty(configuration, tree, async (secrets, value) => {
        const redact = await redactOf(secrets);

        expect(redact(build(value, (name) => secrets[name]))).toStrictEqual(
          build(value, () => MASK),
        );
      }),
    );
  });
});
