# 0005. Code organization rules

- Status: Accepted
- Date: 2026-11-11

## Context

The specs say nothing about code organization, but they ship data the code needs: the drafts of the nine candidate types loaded at first start (TAX-15 and the annex of [02](../02-taxonomie-des-evenements.md)) and the initial list of domains not admitted as sources (H-IMP-13). The tests will also need fixtures: research results, box scores, feeds.

## Decision

These rules come from the owner:

- Raw data files never mix with source code: seeds and fixtures live in `data/`, outside `src/`.
- One consistent naming convention.
- No excessive nesting.
- A single, clearly identified entry point.

## Consequences

- The English drafts of the candidate types ([0010](0010-english-product.md), [0015](0015-calendar-derived-event-types.md)) and the initial domain list (H-IMP-13) are seed files under `data/`.
- Test fixtures live under `data/` as well, among them the research-AI quirks of [0013](0013-tool-agnostic-research-ai.md) and the invented players of [0006](0006-public-specs-without-license-or-real-players.md).
- The toolchain fixes the naming convention and enforces it by lint, together with the layout of [0007](0007-next-native-module-layout.md).
