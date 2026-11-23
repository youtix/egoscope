# Test support fixtures

Written by hand for `src/lib/testing`: valid research results in the format 1.0, with English
keys, which a test or an end-to-end journey pastes into the import of a scenario's request. Every
player, outlet and link is invented; the links use the reserved `.example` domain.

- `research-results/request-to-do.json`: two media storms of Soren Vail (`p09` of the invented
  league of `data/fixtures/stats-source/world/`), one dated to the day and one to the minute.
- `research-results/request-to-do-empty.json`: the same request answered with no event, which
  still makes the player profiled.

Both answer the request of the `request-to-do` scenario: the followed player's identifier is the
fixed one that the players factory gives `p09`, and the reference `REQ-2026-0001` is the one the
request draws when no other request of 2026 was written before it. The tests of
`src/lib/testing/scenarios.test.ts` read both with the import's own checks.
