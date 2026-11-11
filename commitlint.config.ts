import type { UserConfig } from '@commitlint/types';

// Conventional Commits, checked on every commit (lefthook) and on pull request
// titles (CI), because a squash merge turns the title into the commit subject.
const config: UserConfig = {
  extends: ['@commitlint/config-conventional'],
};

export default config;
