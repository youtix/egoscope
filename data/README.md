# data

Everything that is data rather than code lives here: seeds, test fixtures and raw files. Code never
lives here, and data never lives in `src/`; `bun run lint:structure` enforces both.

## What belongs here

- `fixtures/<module>/`: inputs for tests, grouped by the module that reads them. Typical examples
  are recorded responses of the statistics source, the news feeds or the language model, and sample
  research results for the JSON import.
- `seeds/`: data that the application loads into an empty database, such as a starting event
  taxonomy, once the database exists.

## Rules

- Invented players only. No real NBA player names anywhere in this repository, fixtures included.
- No personal data, no secrets, and no copyrighted article text: press fixtures use invented text.
- Names are kebab-case, and folders stay shallow.
- Prefer JSON, or the native format of a recorded source. When the origin of a file is not obvious,
  add a short README beside it that says where it comes from and how to refresh it.
- Code reads these files through the `@data/` import alias, for example
  `import season from '@data/fixtures/stats-source/season.json'`.
