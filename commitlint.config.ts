import { RuleConfigSeverity } from '@commitlint/types';

import type { Plugin, SyncRule, UserConfig } from '@commitlint/types';

// GitHub runs no workflow for a push, or for a pull request whose last commit
// carries one of these markers, and other checks honor the skip-checks trailer.
const SKIP_MARKER =
  /\[(?:skip ci|ci skip|no ci|skip actions|actions skip)\]|^skip-checks:\s*true\s*$/imu;

const noSkipMarkers: SyncRule = (commit) => {
  // commitlint adds the whole message as `raw` to what the parser returns.
  const raw = commit['raw'];
  return [
    !SKIP_MARKER.test(typeof raw === 'string' ? raw : ''),
    'This message would make GitHub skip CI: remove the [skip ci] marker or the skip-checks trailer.',
  ];
};

const egoscopeRules: Plugin = { rules: { 'egoscope/no-skip-markers': noSkipMarkers } };

// Conventional Commits, checked on every commit (lefthook) and on pull request
// titles (CI), because a squash merge turns the title into the commit subject.
const config: UserConfig = {
  extends: ['@commitlint/config-conventional'],
  // The default ignores would let merge, revert, fixup! and version-number
  // messages through unchecked, and such a title would become the subject.
  defaultIgnores: false,
  plugins: [egoscopeRules],
  rules: { 'egoscope/no-skip-markers': [RuleConfigSeverity.Error, 'always'] },
};

export default config;
