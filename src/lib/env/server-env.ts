import 'server-only';

import { z } from 'zod';

import { Secret } from './secret-value';

// libpq's sslmode that encrypts the connection and checks the server's
// certificate and host name; pg obeys the last sslmode of a URL, so all of them
// must say it (TRV-14).
const VERIFY_FULL = 'verify-full';

const hasVerifyFull = (value: string): boolean => {
  // Zod runs this check even when the value is no URL at all.
  const modes = URL.parse(value)?.searchParams.getAll('sslmode') ?? [];
  return modes.length > 0 && modes.every((mode) => mode === VERIFY_FULL);
};

// The real credentials: the values that let this server reach the database or an
// outside service. The schema declares each one with this mark, by which alone a
// new credential joins the fakes rule below: there is no list to update. The mark
// counts before or after a check, a wrapper or a pipe, at either end of the pipe.
export const realCredentials = z.registry();

// The secret values, which the schema declares through `secret` alone: every real
// credential, and the secrets that this server keeps to itself (TRV-64).
const secretValues = z.registry();

/**
 * The schemas that `schema` was made from: the one that a check such as `.min()`,
 * `.trim()` or `.refine()`, or `.describe()`, copied, which zod keeps as the copy's
 * parent; the one under `.optional()`, `.default()` and every other wrapper of
 * zod; and both ends of a pipe, which `.transform()`, `.pipe()` and
 * `z.preprocess()` make.
 */
function sourceSchemas({ _zod: { def, parent } }: z.core.$ZodType): readonly unknown[] {
  return [
    parent,
    'innerType' in def ? def.innerType : undefined,
    'in' in def ? def.in : undefined,
    'out' in def ? def.out : undefined,
  ];
}

/**
 * Says whether `schema` carries the mark of `registry`, on itself or on a schema
 * that it was made from: zod keeps a mark on the one schema it was registered on,
 * which `.min()`, `.optional()`, `.transform()` or any other call after
 * `.register()` would otherwise hide.
 */
function hasMark(registry: z.core.$ZodRegistry, schema: z.core.$ZodType): boolean {
  return (
    registry.has(schema) ||
    sourceSchemas(schema).some(
      (source) => source instanceof z.core.$ZodType && hasMark(registry, source),
    )
  );
}

/**
 * Says whether `schema` carries the mark of a real credential, on itself or on a
 * schema that it was made from (TRV-64), so that no call after `.register()` hides
 * it from the fakes rule.
 */
export function isCredential(schema: z.core.$ZodType): boolean {
  return hasMark(realCredentials, schema);
}

// A value kept secret (TRV-64): it parses as a Secret, which prints and
// serializes as a mask and hands out its value only to the call that needs it.
const secret = (schema: z.ZodType<string>) =>
  schema.transform((value) => new Secret(value)).register(secretValues);

// A Postgres connection string, reached over a verified encrypted connection (TRV-14).
const databaseUrl = secret(z.url({ protocol: /^postgres(?:ql)?$/u }).refine(hasVerifyFull));

// The random bytes of a key that the owner generates (accounts-and-keys sheet).
const KEY_BYTES = 32;

const holdsKeyBytes =
  (encoding: 'base64' | 'base64url') =>
  (value: string): boolean =>
    Buffer.from(value, encoding).length === KEY_BYTES;

// A key that the owner generates with the command of the accounts-and-keys sheet:
// 32 random bytes in base64url, 43 characters, safe in an HTTP header.
const generatedKey = secret(z.base64url().refine(holdsKeyBytes('base64url')));

// The key of the backups, 32 random bytes in base64 (backup-storage sheet), the
// key of their authenticated encryption (CL-TRV-04).
const encryptionKey = secret(z.base64().refine(holdsKeyBytes('base64')));

// A token or an identifier that a provider issues, kept as the provider gives it.
const issued = z.string();

// The private backup repository, `owner/repository` (backup-storage sheet).
const githubRepository = z.string().regex(/^[\w.-]+\/[\w.-]+$/u);

/** A lot of the specifications: a Lot 2 build serves the features of both (H-12, ADR 0001). */
export type Lot = 1 | 2;

/** The lot of a build that sets no EGOSCOPE_LOT: 1 until the Lot 2 milestone flips it to 2. */
export const DEFAULT_LOT: Lot = 1;

const LOT_OF = { '1': 1, '2': 2 } as const satisfies Readonly<Record<string, Lot>>;

// The lot switch, which the build configuration sets and the owner never does.
const lotSwitch = z
  .enum(['1', '2'])
  .transform((lot) => LOT_OF[lot])
  .default(DEFAULT_LOT);

// The outside services that a fake can replace, one port each (module map §5).
const PORTS = [
  'stats-source',
  'link-check',
  'backup-storage',
  'runtime-cache',
  'language-model',
  'press-feeds',
  'telegram',
] as const;

/** An outside service behind a port of its own, which a fake can replace (module map §5). */
export type Port = (typeof PORTS)[number];

const ports = z.array(z.enum(PORTS));

// The fakes switch: `all`, the hermetic mode of the end-to-end tests, in which
// every outside service is a fake, or a comma-separated list of ports.
const fakesSwitch = z.union([
  z.literal('all'),
  z
    .string()
    .transform((list) => list.split(',').map((port) => port.trim()))
    .pipe(ports),
]);

// Every variable the server reads, and its rules, under the names of the
// accounts-and-keys sheet (TRV-37, TRV-64). The deployment values are optional
// here: outside Vercel, development and the tests run on PGlite and fakes, and
// `missingOnDeployment` asks a Vercel deployment for those it needs.
const serverEnvShape = {
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  // Set by Next.js and Vitest, never by hand: `next dev` keeps its database on disk.
  NODE_ENV: z.enum(['development', 'production', 'test']).optional(),
  // Set by Vercel on each of its deployments, and absent everywhere else, while the
  // project setting "Enable access to System Environment Variables" stays on.
  VERCEL_ENV: z.enum(['production', 'preview', 'development']).optional(),
  VERCEL_DEPLOYMENT_ID: issued.optional(),
  APP_BASE_URL: z.url({ protocol: /^https$/u }).optional(),
  // Neon's pooled connection string, for the application, and its direct one,
  // for migrations and long reads. Previews carry neither.
  DATABASE_URL: databaseUrl.optional().register(realCredentials),
  DATABASE_URL_UNPOOLED: databaseUrl.optional().register(realCredentials),
  CRON_SECRET: generatedKey.optional(),
  INITIAL_PASSWORD: secret(z.string()).optional(),
  FINGERPRINT_KEY: generatedKey.optional(),
  BACKUP_GITHUB_REPOSITORY: githubRepository.optional(),
  BACKUP_GITHUB_TOKEN: secret(issued).optional().register(realCredentials),
  BACKUP_ENCRYPTION_KEY: encryptionKey.optional(),
  // A mirror of the statistics files, or a test server; the source's public address otherwise.
  STATS_SOURCE_BASE_URL: z.url({ protocol: /^https?$/u }).optional(),
  CLOUDFLARE_ACCOUNT_ID: issued.optional(),
  CLOUDFLARE_AI_API_TOKEN: secret(issued).optional().register(realCredentials),
  GROQ_API_KEY: secret(issued).optional().register(realCredentials),
  TELEGRAM_BOT_TOKEN: secret(issued).optional().register(realCredentials),
  TELEGRAM_WEBHOOK_SECRET: generatedKey.optional(),
  EGOSCOPE_LOT: lotSwitch,
  // Outside services replaced with fakes, for development and the end-to-end tests only.
  EGOSCOPE_FAKES: fakesSwitch.optional(),
};

/** What a Vercel deployment needs of a variable, after the accounts-and-keys sheet (TRV-37). */
type Need = Readonly<{
  /** The first lot whose build reads it: a Lot 2 build reads the values of both lots. */
  lot: Lot;
  /** Whether a Vercel deployment of that lot, or of a later one, is invalid without it. */
  required: boolean;
}>;

const NEEDED_BY_LOT_1: Need = { lot: 1, required: true };
const OPTIONAL_IN_LOT_1: Need = { lot: 1, required: false };
const NEEDED_BY_LOT_2: Need = { lot: 2, required: true };
const OPTIONAL_IN_LOT_2: Need = { lot: 2, required: false };

// The lot that needs each variable, and whether a deployment requires it.
const NEEDS = {
  LOG_LEVEL: OPTIONAL_IN_LOT_1,
  NODE_ENV: OPTIONAL_IN_LOT_1,
  // The host check reports these two missing, rather than the configuration.
  VERCEL_ENV: OPTIONAL_IN_LOT_1,
  VERCEL_DEPLOYMENT_ID: OPTIONAL_IN_LOT_1,
  APP_BASE_URL: NEEDED_BY_LOT_1,
  DATABASE_URL: NEEDED_BY_LOT_1,
  DATABASE_URL_UNPOOLED: NEEDED_BY_LOT_1,
  CRON_SECRET: NEEDED_BY_LOT_1,
  INITIAL_PASSWORD: NEEDED_BY_LOT_1,
  FINGERPRINT_KEY: NEEDED_BY_LOT_1,
  // Required by the sheet, yet the application runs without them: the backup task
  // then opens "backup failed", whose cause includes a missing storage
  // configuration (TRV-50).
  BACKUP_GITHUB_REPOSITORY: OPTIONAL_IN_LOT_1,
  BACKUP_GITHUB_TOKEN: OPTIONAL_IN_LOT_1,
  BACKUP_ENCRYPTION_KEY: OPTIONAL_IN_LOT_1,
  STATS_SOURCE_BASE_URL: OPTIONAL_IN_LOT_1,
  CLOUDFLARE_ACCOUNT_ID: NEEDED_BY_LOT_2,
  CLOUDFLARE_AI_API_TOKEN: NEEDED_BY_LOT_2,
  // Without it, the model chain is Workers AI alone (detection-model sheet).
  GROQ_API_KEY: OPTIONAL_IN_LOT_2,
  TELEGRAM_BOT_TOKEN: NEEDED_BY_LOT_2,
  TELEGRAM_WEBHOOK_SECRET: NEEDED_BY_LOT_2,
  EGOSCOPE_LOT: OPTIONAL_IN_LOT_1,
  EGOSCOPE_FAKES: OPTIONAL_IN_LOT_1,
} as const satisfies Readonly<Record<keyof typeof serverEnvShape, Need>>;

const serverEnvSchema = z.object(serverEnvShape);

/** Every variable of the schema, in schema order. */
export const SERVER_ENV_VARIABLES: readonly string[] = Object.keys(serverEnvShape);

const namesMarkedBy = (registry: z.core.$ZodRegistry): readonly string[] =>
  Object.entries(serverEnvShape)
    .filter(([, schema]) => hasMark(registry, schema))
    .map(([name]) => name);

/** The variables whose values are never logged, displayed or exported (TRV-64). */
export const SECRET_VARIABLES: ReadonlySet<string> = new Set(namesMarkedBy(secretValues));

const CREDENTIALS = namesMarkedBy(realCredentials);
const FAKES = 'EGOSCOPE_FAKES';

export type ServerEnv = Readonly<z.infer<typeof serverEnvSchema>>;

export type ServerEnvError = Readonly<{
  kind: 'invalid-server-env';
  /** Names of the invalid variables, in schema order. Their values are never reported. */
  variables: readonly string[];
}>;

export type ServerEnvResult =
  Readonly<{ ok: true; env: ServerEnv }> | Readonly<{ ok: false; error: ServerEnvError }>;

type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * The variables that refuse the fakes switch, then the switch itself: every real
 * credential set beside it, and `VERCEL_ENV` on a production deployment. Fakes
 * never serve where a credential could reach a real service, and a credential
 * refuses them on its own, since the host's system variables exist only while a
 * project setting is on. Read from the values as given, so that the rule holds
 * whatever else is invalid, a malformed connection string included.
 */
function refusedBesideFakes(defined: EnvSource): readonly string[] {
  if (defined[FAKES] === undefined) {
    return [];
  }
  const refusing = [
    ...(defined['VERCEL_ENV'] === 'production' ? ['VERCEL_ENV'] : []),
    ...CREDENTIALS.filter((name) => defined[name] !== undefined),
  ];
  return refusing.length === 0 ? [] : [...refusing, FAKES];
}

/** The lot that `defined` sets, or the default while EGOSCOPE_LOT is unset or invalid. */
function lotOf(defined: EnvSource): Lot {
  const lot = serverEnvShape.EGOSCOPE_LOT.safeParse(defined['EGOSCOPE_LOT']);
  return lot.success ? lot.data : DEFAULT_LOT;
}

/**
 * The variables that a Vercel deployment lacks: each one that its lot, or an
 * earlier one, requires (TRV-37). Previews carry no variable by design (TRV-78),
 * so a preview names them all and never connects. Nothing outside Vercel: there,
 * development and the tests run on PGlite and fakes. A configuration with the
 * fakes switch, which no deployment may carry, is left to the fakes rule.
 */
function missingOnDeployment(defined: EnvSource): readonly string[] {
  if (defined['VERCEL_ENV'] === undefined || defined[FAKES] !== undefined) {
    return [];
  }
  const lot = lotOf(defined);
  return Object.entries(NEEDS)
    .filter(([name, need]) => need.required && need.lot <= lot && defined[name] === undefined)
    .map(([name]) => name);
}

/**
 * Validates a server environment (TRV-37, TRV-64). An empty value counts as
 * unset. A Vercel deployment must carry every value that its lot requires, and
 * the fakes switch is refused beside a real credential or on a production
 * deployment. The error names the invalid variables but never echoes a value,
 * so it is safe to log.
 */
export function parseServerEnv(source: EnvSource): ServerEnvResult {
  const defined: EnvSource = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const parsed = serverEnvSchema.safeParse(defined);
  // One variable can fail several checks.
  const invalid = new Set([
    ...(parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.map(String).join('.'))),
    ...missingOnDeployment(defined),
    ...refusedBesideFakes(defined),
  ]);
  if (parsed.success && invalid.size === 0) {
    return { ok: true, env: parsed.data };
  }
  const variables = SERVER_ENV_VARIABLES.filter((name) => invalid.has(name));
  return { ok: false, error: { kind: 'invalid-server-env', variables } };
}

const processEnvResult = parseServerEnv(process.env);

/**
 * Returns the validation of `process.env`, done once when the server loads
 * this module (TRV-37, TRV-64).
 */
export function readServerEnv(): ServerEnvResult {
  return processEnvResult;
}
