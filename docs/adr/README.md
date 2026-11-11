# Decision records

These records hold the product and delivery decisions the owner settled in the design interview of 2026-11-11, before any code was written. All are accepted and dated 2026-11-11. Record N carries decision N of that interview.

The French functional specs in `docs/` stay the reference. Where a record changes, extends or settles a requirement, the [deviations register](../engineering/spec-deviations.md) lists it; implementers and reviewers check the register first. French terms map to English through `docs/engineering/glossary.md`.

## Records

| Record                                                                         | Decision                                                                              |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| [0001](0001-build-both-lots-in-dependency-ordered-waves.md)                    | Both lots built in one run: foundation, Lot 1 to a tagged milestone, then Lot 2        |
| [0002](0002-free-hosting-on-vercel-and-neon-with-an-external-trigger.md)       | Vercel Hobby and Neon, all free; TypeScript and Bun; scheduled work via an external trigger |
| [0003](0003-public-repository-and-pull-request-workflow.md)                    | Public repository, one pull request per task, merge on green CI and independent review |
| [0004](0004-quality-bar.md)                                                    | Quality bar: strict typing, lint, coverage, property and mutation tests, traceability  |
| [0005](0005-code-organization-rules.md)                                        | Data apart from code, one naming convention, shallow folders, one entry point          |
| [0006](0006-public-specs-without-license-or-real-players.md)                   | Public specs, no license, no real player names                                         |
| [0007](0007-next-native-module-layout.md)                                      | Next-native layout: pages under `src/app/`, shared logic under `src/lib/`              |
| [0008](0008-autonomous-build-and-end-of-build-handover.md)                     | No checkpoints; accounts and secrets handed over at the end                            |
| [0009](0009-minor-open-questions-keep-spec-defaults.md)                        | The nine minor open questions keep the spec defaults                                   |
| [0010](0010-english-product.md)                                                | English product; press stays English and French                                        |
| [0011](0011-choosing-the-remaining-services.md)                                | Remaining services chosen by the spec criteria, fewest accounts first                  |
| [0012](0012-statistics-coverage-gives-way.md)                                  | Statistics coverage gives way; indicator unchanged                                     |
| [0013](0013-tool-agnostic-research-ai.md)                                      | Tool-agnostic research AI; import tested against AI output quirks                      |
| [0014](0014-developer-level-deployment-guide.md)                               | Deployment guide written for a developer                                               |
| [0015](0015-calendar-derived-event-types.md)                                   | Birthday and former-team events derived from the calendar                              |
| [0016](0016-per-type-doubtful-criterion-switch.md)                             | A type sheet can switch off one doubtful-case criterion                                |
| [0017](0017-temporary-fingerprint-of-withdrawn-events.md)                      | Temporary keyed fingerprint of a withdrawn event                                       |
| [0018](0018-encrypted-weekly-backups.md)                                       | Encrypted weekly backups outside the database                                          |
| [0019](0019-two-daily-collection-and-detection-runs.md)                        | Collection and detection at 16:30 and 23:00 Paris time                                 |
| [0020](0020-empty-initial-player-list.md)                                      | The app starts with an empty player list                                               |
| [0021](0021-verdict-thresholds-and-chance.md)                                  | Editable verdict thresholds; chance shown, not corrected                               |
| [0022](0022-uncertain-events-keep-spec-defaults.md)                            | Uncertain events keep the spec defaults                                                |

## The twelve points to settle before development

Every point of the section « Points à trancher avant de développer » of the specs' [README](../README.md) is settled:

| Point in `docs/README.md`                                       | Questions          | Record                                                                                                                     |
| --------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Services gratuits                                               | Q-02               | [0011](0011-choosing-the-remaining-services.md), with [0002](0002-free-hosting-on-vercel-and-neon-with-an-external-trigger.md) for host and database |
| Couverture de la source de statistiques                         | Q-STA-01           | [0012](0012-statistics-coverage-gives-way.md)                                                                              |
| IA de recherche gratuite et son quota                           | Q-BKT-02           | [0013](0013-tool-agnostic-research-ai.md)                                                                                  |
| Niveau technique de l'utilisateur                               | Q-01               | [0014](0014-developer-level-deployment-guide.md)                                                                           |
| Liste initiale des joueurs                                      | Q-03               | [0020](0020-empty-initial-player-list.md)                                                                                  |
| Seuils du verdict et profils nombreux                           | Q-04, Q-VUE-01     | [0021](0021-verdict-thresholds-and-chance.md)                                                                              |
| Heure de la détection quotidienne                               | Q-SUI-02           | [0019](0019-two-daily-collection-and-detection-runs.md)                                                                    |
| Types connus d'avance                                           | Q-TAX-01           | [0015](0015-calendar-derived-event-types.md)                                                                               |
| Types liés à un facteur parasite                                | Q-SEN-01           | [0016](0016-per-type-doubtful-criterion-switch.md)                                                                         |
| Événements peu sûrs                                             | Q-BKT-01, Q-IMP-01 | [0022](0022-uncertain-events-keep-spec-defaults.md)                                                                        |
| Empreinte d'un événement retiré                                 | Q-DSN-01           | [0017](0017-temporary-fingerprint-of-withdrawn-events.md)                                                                  |
| Emplacement des sauvegardes                                     | Q-TRV-01           | [0018](0018-encrypted-weekly-backups.md)                                                                                   |

The same section names the heaviest drafting hypotheses. H-12 (two lots) is confirmed by [0001](0001-build-both-lots-in-dependency-ordered-waves.md), H-13 (indicator formula) by [0012](0012-statistics-coverage-gives-way.md), H-03 (five valid cases) by [0021](0021-verdict-thresholds-and-chance.md).

## Adding or changing a record

- A new record takes the next free number and a kebab-case title, and keeps the sections of the others: status and date, context, decision, consequences, alternatives considered where any were.
- Numbers never change. To change a decision, add a record that supersedes the old one and mark the old one "Superseded by" with the new number.
- The rows of the deviations register change in the same pull request as the record.
