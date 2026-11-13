## Summary

<!-- What this pull request does and why, in two or three sentences. One task per pull request. -->

## Requirements covered

<!--
Every requirement and acceptance criterion this pull request implements or changes, cited
exactly as the French specifications and docs/engineering/acceptance-criteria-index.md write
them (JOU-04, CA-TRV-12), with how it is verified: the test that carries the ID in its title, or
the check that proves it. Hypotheses, questions, decisions and rulings (H-13, Q-04, D-07,
CL-STA-01) may be cited too; they need no test. Write "None" for tooling-only work.

The trace workflow reads every ID of this section outside this comment, and fails unless each
requirement and criterion among them has a test that names it, or a waiver in
docs/engineering/requirement-waivers.md.
-->

| Requirement | Verified by |
| ----------- | ----------- |
|             |             |

## Checklist

- [ ] `bun run check:changed` passes locally (`bun run gate` too after a tooling, CI or dependency
      change), and every required check is green (`ci-ok`, and the final job of any other workflow).
- [ ] Tests sit beside the code they test, carry the requirement IDs they verify, and assert
      behavior with concrete expected values.
- [ ] No lint rule, TypeScript flag, coverage threshold or test was weakened. Any rule that seems
      wrong is raised under "Notes for the reviewer".
- [ ] No secret, personal data or real player name was added.
- [ ] README.md, CLAUDE.md and the English reference documents (`docs/engineering/`, `docs/adr/`,
      once they exist) are updated if a convention changed.

## Notes for the reviewer

<!-- Decisions, trade-offs, follow-ups, and where to look first. -->

🤖 Generated with [Claude Code](https://claude.com/claude-code)
