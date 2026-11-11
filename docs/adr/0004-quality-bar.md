# 0004. Quality bar

- Status: Accepted
- Date: 2026-11-11

## Context

The specs set no code-quality rule, but several requirements need strong verification: deterministic recalculation (SEN-36), exact numeric expectations (the acceptance criteria of [07](../07-statistiques-de-match.md) and [08](../08-sensibilite-et-verdict.md), and the full worked example of 08), WCAG level AA (IHM-61), and a delivered status of every requirement "et le moyen de le vérifier" (TRV-79). Every spec document ends with acceptance criteria written as given/when/then.

## Decision

- Strictest TypeScript settings.
- Type-aware ESLint with architecture-boundary rules and zero warnings; Prettier.
- Coverage gates: 100% on the pure statistics core, at least 90% elsewhere.
- Property-based and mutation testing on the calculation engine.
- Every spec acceptance criterion traced to a test.
- Playwright with axe on key journeys.
- The owner's stated priorities: readability, maintainability, separation of concerns, performance.

## Consequences

- The pure statistics core holds the calculations of 07 (Game Score, performance index, season reference), 08 (normalized gap, verdict, profile confidence, robustness test, general trend, expected false signals of SEN-41) and the category and summary rules of 10 (SUI-22, SUI-27). It performs no I/O, which makes the 100% gate and mutation testing practical.
- Property-based tests use invariants the specs state: sign symmetry (H-04, SEN-24, and the criterion of 08 with opposite gaps), the count identities of SEN-32, determinism (SEN-36), the measured game excluded from its own reference (STA-17).
- Each acceptance criterion is cited by at least one test. Criteria with an ID are cited by it (for example CA-TRV-21). Criteria that a spec numbers or lists without an ID are cited by document and position, for example `08 AC-11` for the eleventh criterion of document 08; the traceability tooling may fix the exact syntax. A criterion whose expected value the [deviations register](../engineering/spec-deviations.md) changes is tested against the register's value and cites both.
- Key journeys include, for example, the Lot 1 journey of [12](../12-interface-et-acces.md) from player to first profile, an import with errors and its correction message, the withdrawal screen, offline consultation and, in Lot 2, the alert sheet.
- The requirement status of TRV-79 is generated from the traceability data.
