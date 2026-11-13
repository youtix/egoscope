# Engineering reference documents

The English reference documents of Egoscope, which implementers and reviewers read next to the
French functional specifications in [`docs/`](../README.md). Read them in this order:

1. [Decision records](../adr/README.md) and the [deviations register](spec-deviations.md): what the owner decided, the coordinator's choices under the owner's delegation, and every requirement those decisions change, extend or settle.
2. [Glossary](glossary.md): one English term, code identifier and UI label for each French term of the specifications.
3. [Rulings](clarifications/README.md): the clarifications `CL-<PREFIX>-nn`, one file per specification file, which settle what the specifications leave unclear.
4. [Module map](module-map.md): the layers, modules, routes, scheduled tasks, ports and parameters, and the build tasks that deliver them.
5. [Data model](domain-model/README.md): every table, column, status set, invariant and exchange format the application stores or reads.
6. [Services](../services/README.md): the external service of each role, its free tier, limits and replacement; the statistics source has its own [sheet](../services/statistics-source.md) and [evaluation](statistics-source-evaluation.md).

## Precedence

The French specifications decide behavior; a ruling outranks a reading of a specification; the
glossary owns terms, labels and the stored values it lists; the data model owns tables, columns and
every stored value the glossary does not list (a task that displays such a value adds its label to
the glossary in its own pull request); the module map owns module names, routes, parameter keys and
task keys.
