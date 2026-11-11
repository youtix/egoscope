// Setup for component tests, which run in jsdom.
import * as domMatchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { afterEach, expect } from 'vitest';

import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

// jest-dom 7 ships typings for Vitest 4's `Assertion<T>`, which clash with
// Vitest 5's `Assertion<R, T>`. Vitest 5 reads custom matchers from
// `Matchers<R, T>`, so the DOM matchers are declared there instead.
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- Module augmentation merges into Vitest's interface; a type alias cannot.
  interface Matchers<
    R extends void | Promise<void> = void | Promise<void>,
    T = unknown,
  > extends TestingLibraryMatchers<T, R> {}
}

expect.extend(domMatchers);

afterEach(() => {
  cleanup();
});
