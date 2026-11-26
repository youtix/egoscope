# The recorded answers of the Workers AI adapter

These files are answers of Cloudflare Workers AI's REST API
(`POST /client/v4/accounts/{account}/ai/run/@cf/zai-org/glm-4.7-flash`), as the detection-model
sheet (`docs/services/detection-model.md`) calls it. No Cloudflare account or token existed when
they were written: each one follows the provider's public documentation, not a real call. Every
answer comes in Cloudflare's API envelope (`result`, `success`, `errors`, `messages`). A successful
answer's `result` has the chat-completion layout of the model's output schema (`choices`, each with
its `message.content`, and `usage` with its `prompt_tokens`, `completion_tokens` and optional
`prompt_tokens_details.cached_tokens`). The errors carry the codes and messages of the Workers AI
errors page. Every player, article, identifier and instant is invented. No answer holds a token or
any other credential.

The tests of the adapter (`src/lib/language-model/workers-ai.test.ts`) serve them from a fake
HTTP layer, so that no test reaches Cloudflare.

- `request.json`: the body that the adapter sends for the request of its tests, in the keys of the
  model's input schema (`messages`, `max_completion_tokens`, `response_format`).
- `answer.json`: an answer that names the two articles of the contract's request, with its usage,
  part of its prompt cached.
- `failures.json`, by name:
  - `prose_answer`: an answer whose content is prose, not JSON;
  - `no_content`: an answer cut at its maximum output, with no content;
  - `json_mode_not_met`: the refusal "JSON Mode couldn't be met" of JSON mode;
  - `neurons_used_up`: the `429` of the daily free allocation used up (code 3036);
  - `out_of_capacity`: the `429` of a capacity limit (code 3040);
  - `request_timeout`: the `408` of a request timeout (code 3007);
  - `bad_token`: the `401` of a rejected token (code 10000);
  - `server_error`: a `502` with a page instead of JSON.

What the documentation does not say, and these files therefore invent, for the owner's first real
call to check: the status of the JSON-mode refusal (written `400`, without a code); whether a
minute limit comes with a `retry-after` header (none here, the adapter then waits a minute); and
that a `glm-4.7-flash` answer gives its content as a string in `choices`, not in a `response`
field as older models do.
