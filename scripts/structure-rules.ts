/**
 * Layout rules that ESLint cannot see, checked over every file of the
 * repository: module rules 2, 5 and 6 of CLAUDE.md, the code/data split, and
 * the TypeScript extensions that every tool understands.
 */

export type StructureViolation = Readonly<{ path: string; problem: string }>;

type Files = ReadonlySet<string>;
type Check = (path: string, files: Files) => readonly string[];

const KEBAB = '[a-z0-9]+(?:-[a-z0-9]+)*';
const KEBAB_NAME = new RegExp(`^${KEBAB}$`, 'u');
// A kebab-case base name, then lowercase extensions: `game-score.test.ts`.
const FILE_NAME = new RegExp(String.raw`^${KEBAB}(?:\.${KEBAB})*$`, 'u');
// Next.js route segments: `players`, `[playerId]`, `[...slug]`, `[[...slug]]`,
// `(group)`, `@slot`, and intercepting routes such as `(..)photo`.
const ROUTE_SEGMENT = new RegExp(
  String.raw`^(?:${KEBAB}|\[(?:\.\.\.)?[a-z][a-zA-Z0-9]*\]|\[\[\.\.\.[a-z][a-zA-Z0-9]*\]\]|\(${KEBAB}\)|@${KEBAB}|(?:\(\.{1,3}\))+${KEBAB})$`,
  'u',
);
const CONVENTIONAL_NAMES: ReadonlySet<string> = new Set(['README.md']);
const NAMED_TREES: ReadonlySet<string> = new Set(['src', 'data', 'scripts']);
const NEXT_ROOT_FILES: ReadonlySet<string> = new Set([
  'src/instrumentation.ts',
  'src/instrumentation-client.ts',
  'src/proxy.ts',
]);
const CODE_EXTENSION = /\.[cm]?[jt]sx?$/u;
const TS_OR_TSX = /\.tsx?$/u;
const TS_ONLY_TREES = ['src/', 'scripts/'];
const PURE_CORES = ['src/lib/stats-engine/', 'src/lib/ai-exchange/'];
const RAW_DATA_EXTENSION = /\.(?:csv|tsv|jsonl?|ndjson|xlsx?|parquet|sqlite|db)$/u;
const APP_MANIFEST = /^src\/app\/manifest\.(?:json|webmanifest)$/u;
const TEST_FILE = /^(?<base>.+)\.test\.tsx?$/u;
const LIB = 'src/lib/';
// A file sits at most in src/lib/<module>/<sub>/.
const MAX_SEGMENTS_BELOW_LIB = 3;

const checkSrcRoot: Check = (path) =>
  path.startsWith('src/') &&
  !path.startsWith('src/app/') &&
  !path.startsWith(LIB) &&
  !NEXT_ROOT_FILES.has(path)
    ? ['src/ holds only app/ and lib/, plus the Next.js root files (instrumentation.ts, proxy.ts).']
    : [];

const checkLibDepth: Check = (path) => {
  if (!path.startsWith(LIB)) {
    return [];
  }
  const segments = path.slice(LIB.length).split('/');
  if (segments.length === 1) {
    return ['Put this file in a module folder: src/lib/<module>/.'];
  }
  return segments.length > MAX_SEGMENTS_BELOW_LIB
    ? ['Too deep: files sit at most in src/lib/<module>/<sub>/ (module rule 5).']
    : [];
};

const checkRouteFolders: Check = (path) =>
  path.startsWith('src/app/') &&
  path
    .split('/')
    .slice(2, -1)
    .some((folder) => folder.startsWith('_'))
    ? [
        'Colocated files sit flat in their route folder, without private _folders; move shared code to src/lib/<module> (module rule 5).',
      ]
    : [];

const checkNames: Check = (path) => {
  const segments = path.split('/');
  if (!NAMED_TREES.has(segments[0] ?? '')) {
    return [];
  }
  const fileName = segments.at(-1) ?? '';
  const folderPattern = path.startsWith('src/app/') ? ROUTE_SEGMENT : KEBAB_NAME;
  const badFolder = segments.slice(0, -1).find((folder) => !folderPattern.test(folder));
  if (badFolder !== undefined) {
    return [`Folder "${badFolder}" is not kebab-case (module rule 6).`];
  }
  return FILE_NAME.test(fileName) || CONVENTIONAL_NAMES.has(fileName)
    ? []
    : [`File name "${fileName}" is not kebab-case (module rule 6).`];
};

const checkCodeAndData: Check = (path) => {
  if (path.startsWith('data/')) {
    return CODE_EXTENSION.test(path)
      ? ['data/ holds data only: code goes to src/ or scripts/.']
      : [];
  }
  if (!path.startsWith('src/')) {
    return [];
  }
  if (path.endsWith('.d.ts')) {
    return ['No hand-written .d.ts in src/: declarations escape type-checking (skipLibCheck).'];
  }
  return RAW_DATA_EXTENSION.test(path) && !APP_MANIFEST.test(path)
    ? ['Raw data, seeds and fixtures belong in data/, not src/.']
    : [];
};

// Code is .ts or .tsx: the module rules, the type check and coverage are tuned
// to them, and the pure core is plain .ts with nothing else beside it.
const checkLanguage: Check = (path) => {
  if (PURE_CORES.some((core) => path.startsWith(core))) {
    return path.endsWith('.ts') && !path.endsWith('.d.ts')
      ? []
      : ['The pure core holds .ts files only (module rule 2).'];
  }
  return TS_ONLY_TREES.some((tree) => path.startsWith(tree)) &&
    CODE_EXTENSION.test(path) &&
    !TS_OR_TSX.test(path)
    ? [
        'Code in src/ and scripts/ is .ts or .tsx: .mts, .cts and JavaScript files escape the checks.',
      ]
    : [];
};

// A test sits beside its subject, whatever the subject's extension: tsconfig.x.test.ts
// beside tsconfig.x.json works as well as foo.test.ts beside foo.ts.
const checkTestColocation: Check = (path, files) => {
  const base = TEST_FILE.exec(path)?.groups?.['base'];
  if (base === undefined) {
    return [];
  }
  const hasSubject = [...files].some(
    (file) => file.startsWith(`${base}.`) && !TEST_FILE.test(file),
  );
  return hasSubject ? [] : ['A test sits next to the file it tests: foo.test.ts beside foo.ts.'];
};

const CHECKS: readonly Check[] = [
  checkSrcRoot,
  checkLibDepth,
  checkRouteFolders,
  checkNames,
  checkCodeAndData,
  checkLanguage,
  checkTestColocation,
];

function missingModuleIndexes(files: Files): readonly StructureViolation[] {
  const modules = new Set(
    [...files]
      .filter((path) => path.startsWith(LIB) && path.slice(LIB.length).includes('/'))
      .map((path) => `${LIB}${path.slice(LIB.length).split('/', 1).join('')}`),
  );
  return [...modules]
    .filter((module) => !files.has(`${module}/index.ts`))
    .map((module) => ({
      path: `${module}/`,
      problem: 'A module exposes its public API through its index.ts (module rule 4).',
    }));
}

/**
 * Returns every layout violation among `paths` (repository-relative, with
 * forward slashes), sorted by path.
 */
export function findStructureViolations(paths: readonly string[]): readonly StructureViolation[] {
  const files: Files = new Set(paths);
  const perFile = paths.flatMap((path) =>
    CHECKS.flatMap((check) => check(path, files)).map((problem) => ({ path, problem })),
  );
  return [...perFile, ...missingModuleIndexes(files)].toSorted((left, right) =>
    left.path.localeCompare(right.path, 'en'),
  );
}
