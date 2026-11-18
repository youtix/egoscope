# Requirement waivers

Each mode of `scripts/trace-requirements.ts` checks exactly this:

- `bun run trace`, one of the static checks: every ID that a test title cites, in the square
  brackets it starts with, is one that the specs define, and its other square brackets hold no ID;
  this register is sound; the acceptance criteria index is up to date. It requires no ID to have a
  test or a waiver.
- The `trace` workflow, on a pull request: the same; the description has a "Requirements covered"
  heading, unless the dependency-update bot opened the pull request; and each requirement and
  acceptance criterion listed under it has a test that names it in its title, as in
  `it('[JOU-04] rejects a 31st active player', …)`, or a waiver in this register.
- `bun run trace:strict`: the same as `bun run trace`, and every requirement and acceptance
  criterion of the French specifications has such a test or a waiver.

Reviewers read every entry.

An entry is one of two kinds:

- **waiver**: no automated test can or must verify the requirement, for example a documentation
  requirement, or a requirement that a decision record overrides. The ID then has no test, its
  `part` stays empty, and the last column gives the reference: the decision record, or the
  document that fulfills the requirement.
- **limit**: tests prove the application's part of the requirement, and one named part can only be
  checked by hand, for example the quality of a real language model's answers, or the wording of a
  text that an outside AI writes. The entry names that part, and its manual check in the last
  column: a script, or a step of the deployment guide. The ID keeps its tests.

An ID has at most one entry, and every entry gives its reason. `bun run trace` refuses a row that
breaks one of these rules, and names it. Acceptance criteria are cited by the IDs of the
[acceptance criteria index](acceptance-criteria-index.md).

| ID  | kind | part | reason | manual check or reference |
| --- | ---- | ---- | ------ | ------------------------- |
