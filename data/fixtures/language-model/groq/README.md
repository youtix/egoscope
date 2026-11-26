# The recorded answers of the Groq provider

These files are answers of Groq's chat completions endpoint (`POST /openai/v1/chat/completions`),
as the detection-model sheet (`docs/services/detection-model.md`) calls it. No Groq account or key
existed when they were written: each one follows the shape of Groq's public documentation (OpenAI
compatibility, rate limits and their headers, structured outputs, prompt caching, errors), with the
status, the headers the provider reads and the JSON body. Every value that names something is
invented: the organization, every id, the players (`player-7`) and the articles (`article-1`,
`article-2`). No answer holds a key or any other credential.

The tests of the provider (`src/lib/language-model/groq.test.ts`) serve them from a fake HTTP layer,
so that no test reaches Groq.

- `request.json`: the request that the provider sends for the two articles of its tests, without
  the Authorization header that carries the key.
- `completion.json`: an answer in strict JSON-schema mode that names both articles, with cached
  prompt tokens and the `x-ratelimit-*` headers.
- `errors.json`: the failures, by name: the tokens a minute (`429` with `retry-after`), the
  requests a day and the tokens a day (`429`), an answer that does not hold to the schema (`400`
  `json_validate_failed`), a rejected key (`401`) and a server error (`503`).
