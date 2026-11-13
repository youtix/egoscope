# Requirement waivers

`bun run trace` holds every requirement and acceptance criterion of the French specifications to
one rule: a test names it in its title, as in `it('[JOU-04] rejects a 31st active player', …)`, or
this register lists it with its reason. Reviewers read every entry.

An entry is one of two kinds:

- **waiver**: no automated test can or must verify the requirement, for example a documentation
  requirement, or a requirement that a decision record overrides. The ID then has no test, its
  `part` stays empty, and the last column gives the reference: the decision record, or the
  document that fulfills the requirement.
- **limit**: tests prove the application's part of the requirement, and one named part can only be
  checked by hand, for example the quality of a real language model's answers, or the wording of a
  text that an outside AI writes. The entry names that part, and its manual check in the last
  column: a script, or a step of the deployment guide. The ID keeps its tests.

An ID has at most one entry, and every entry gives its reason. Acceptance criteria are cited by the
IDs of the [acceptance criteria index](acceptance-criteria-index.md).

| ID  | kind | part | reason | manual check or reference |
| --- | ---- | ---- | ------ | ------------------------- |
