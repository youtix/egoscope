# Requirement waivers

Each mode of `scripts/trace-requirements.ts` checks exactly this:

- `bun run trace`, one of the static checks: the specs define each of their IDs once, in the form
  that `scripts/spec-ids.ts` reads; every ID that a test title cites, in the square brackets it
  starts with, is one that the specs define, and its other square brackets hold no ID; this
  register is sound; the acceptance criteria index is up to date. It requires no ID to have a test
  or a waiver.
- The `trace` workflow, on a pull request: the same; the description has a "Requirements covered"
  heading, unless the dependency-update bot opened the pull request; every ID listed under it is
  one that the specs define, so that a typo such as `JOU-4` fails; and each requirement and
  acceptance criterion among them has a test that names it in its title, as in
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

| ID        | kind  | part                                                                                       | reason                                                                                                                                                                                                                                                                         | manual check or reference                                                                                                                                                                                                                                          |
| --------- | ----- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CA-TRV-06 | limit | installing the app on the home screen of a real phone, and opening it from there as an app | the tests prove the manifest, the icons and the worker that make the app installable (`src/app/manifest.test.ts`, `e2e/installable-app.spec.ts`), but only a person with a phone can follow the steps of its system and see the app open on its own, without the browser's bar | on the deployed app, open it in the phone's browser, add it to the home screen as the browser offers, then open it from its icon: it opens in a window of its own, named Egoscope (the step of the deployment guide that installs the app, once that guide exists) |
