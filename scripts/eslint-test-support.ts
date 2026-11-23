/**
 * The zone of `import-x/no-restricted-paths` that keeps the test support out of
 * production code (module map, sections 1.1 and testing), which eslint.config.ts adds to
 * its layer zones and eslint-test-support.test.ts probes. Production code is every file
 * of src/ but a test, the test support itself and the hermetic routes under
 * src/app/api/test/, which alone of the application import it. The rule reads module
 * references of every kind: imports, type-only ones included, re-exports and `import()`.
 */

/** What the zone says to a production file that imports the test support. */
export const NO_TEST_SUPPORT_IN_PRODUCTION =
  'Production code never imports the test support, src/lib/testing: only tests, scripts/ and the hermetic routes under src/app/api/test/ do (module map, testing).';

/** A zone of `import-x/no-restricted-paths`: the files it covers, the folder they may not import, and why. */
type RestrictedZone = Readonly<{ target: readonly string[]; from: string; message: string }>;

/**
 * The zone that refuses `@/lib/testing` in the production files of src/ whose names end
 * in `.<extensions>` (a brace pattern such as `{ts,tsx}`), resolved against the base path
 * of the rule: one pattern per folder level, since a negated folder excludes its whole
 * subtree.
 */
export function testSupportZone(extensions: string): RestrictedZone {
  const file = `!(*.test).${extensions}`;
  return {
    target: [
      `./src/${file}`,
      `./src/!(app|lib)/**/${file}`,
      `./src/app/${file}`,
      `./src/app/!(api)/**/${file}`,
      `./src/app/api/${file}`,
      `./src/app/api/!(test)/**/${file}`,
      `./src/lib/${file}`,
      `./src/lib/!(testing)/**/${file}`,
    ],
    from: './src/lib/testing',
    message: NO_TEST_SUPPORT_IN_PRODUCTION,
  };
}
