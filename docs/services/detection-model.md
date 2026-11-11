# Detection model: Cloudflare Workers AI, with Groq as fallback

| Item                | Value                                                                              |
| ------------------- | ---------------------------------------------------------------------------------- |
| Role                | Classifies each pre-filtered press article into structured JSON (DET-14 to DET-24) |
| Primary             | Cloudflare Workers AI, model `@cf/zai-org/glm-4.7-flash`, free daily allocation    |
| Fallback            | Groq, model `openai/gpt-oss-120b`, free plan                                       |
| Same-account spares | `@cf/google/gemma-4-26b-a4b-it` (Workers AI), `openai/gpt-oss-20b` (Groq)          |
| Excluded            | Google Gemini free tier: its terms reserve EEA use to paid services (below)        |
| Date checked        | 2026-11-11                                                                         |

## Role

The detection (document 04, lot 2) sends each article that names a followed player to a language
model, with the validated type sheets, the do-not-repropose list and the recent events of the
recognized players, and expects back a JSON structure: for each recognized player, the facts the
article reports, each with a type, a confidence from 0 to 100, a short description, a one-sentence
justification and closed context values (DET-14, DET-16, DET-21). The model must read English and
French press and answer in English (owner decision on language), and must return valid structured
output reliably (TRV-16).

No single free provider meets every rule with margin on its own (see [README.md](README.md)), so the
application uses two: the primary carries the volume, the fallback takes over when the primary's
daily allocation is used up, when it fails, and for the second attempt after an unusable answer.

## Plan and cost

- **Cloudflare Workers AI**: a free allocation of 10,000 neurons a day on both the Free and the Paid
  Workers plans; using more requires Workers Paid
  ([Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)). Workers
  Free is the default plan and needs no credit card
  ([Cloudflare Workers](https://www.cloudflare.com/product/workers/)). Permanent, renewed daily.
- **Groq**: the Free plan; a payment method is needed only to upgrade to the Developer tier
  ([Groq billing FAQ](https://console.groq.com/docs/billing-faqs)). Never upgrade.

## Account needed

- **Cloudflare**: the account also used by the scheduler ([scheduler.md](scheduler.md)). Create a
  Workers AI API token from the Workers AI page with the "Workers AI" template, or a custom token
  with Workers AI Read and Workers AI Edit, and note the account ID
  ([Workers AI REST API](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)).
- **Groq**: one GroqCloud account and one API key from the console.

## Limits

| Limit                              | Value                                                                          | Source                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Workers AI free allocation         | 10,000 neurons a day, reset at 00:00 UTC                                       | [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)                                          |
| `glm-4.7-flash` cost               | 5,500 neurons per million input tokens; 36,400 per million output tokens       | [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)                                          |
| `gemma-4-26b-a4b-it` cost          | 9,091 neurons per million input tokens; 27,273 per million output tokens       | [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)                                          |
| Workers AI rate limit              | 300 requests a minute for text generation                                      | [Workers AI limits](https://developers.cloudflare.com/workers-ai/platform/limits/), updated 2026-09-17                        |
| `glm-4.7-flash` context            | 131,072 tokens; function calling; more than 100 languages                      | [glm-4.7-flash model page](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/)                                |
| Groq `openai/gpt-oss-120b`, Free   | 30 requests a minute, 1,000 a day, 8,000 tokens a minute, 200,000 tokens a day | [Groq rate limits](https://console.groq.com/docs/rate-limits)                                                                 |
| Groq `openai/gpt-oss-20b`, Free    | Same limits, counted separately per model                                      | [Groq rate limits](https://console.groq.com/docs/rate-limits)                                                                 |
| Groq cached tokens                 | Do not count towards rate limits; cache expires after 2 hours unused           | [Groq rate limits](https://console.groq.com/docs/rate-limits), [prompt caching](https://console.groq.com/docs/prompt-caching) |
| Groq `openai/gpt-oss-120b` context | 131,072 tokens; listed as a production model                                   | [Groq models](https://console.groq.com/docs/models)                                                                           |

## Our expected use and the margin

At most about 150 calls a day, typically 30 to 80, in two runs (16:30 and 23:00 Paris time), both
inside the same Cloudflare quota day (00:00 UTC is 01:00 or 02:00 in Paris). Sizes per call:
**realistic**, 5,500 input tokens (instructions, about seven to ten type sheets, the
do-not-repropose list, the article title and its 500-character excerpt from COL-27, the recognized
players and their recent events) and 600 output tokens; **ceiling** given for this research, 8,000
input and 1,000 output.

| Case                                         | Workers AI `glm-4.7-flash`                                   | Groq `gpt-oss-120b`                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Cost of one realistic call                   | 52 neurons                                                   | 6,100 tokens, or about 1,600 counted when the 4,500-token prefix is cached                                         |
| Realistic calls a day within the free limits | about 190                                                    | about 32 uncached, about 125 cached (1,000 requests a day)                                                         |
| Typical day, 55 realistic calls              | about 2,870 neurons, 29% of the allocation                   | not needed                                                                                                         |
| 150 realistic calls                          | about 7,810 neurons, 78%                                     | not needed                                                                                                         |
| 150 calls at the ceiling                     | about 12,060 neurons, 121%: about 124 fit, the rest overflow | a 9,000-token request exceeds the 8,000-token minute limit, so the overflow waits for the 00:00 UTC reset (DET-08) |

Together the two providers handle about 220 to 315 realistic calls a day, against at most 150: a
margin of 50% or more. A typical day uses under a third of the primary alone. Figures are computed
from the published rates; the application measures the real sizes in its first weeks (TRV-08).

### What the implementation must do

1. **One interface, an ordered list of providers**: primary, then fallback, each with its own
   counters and declared limits (TRV-03), reset at its own boundary.
2. **One prompt, one JSON schema, written for strict mode**: Groq's strict structured outputs need
   every property listed in `required` and `additionalProperties: false`, and do not combine with
   streaming or tool use ([Groq structured outputs](https://console.groq.com/docs/structured-outputs)).
   The same schema goes to Workers AI.
3. **Validate every answer** against the schema and the rules of DET-21 and DET-22. When the
   primary's answer is unusable, make the second attempt on the fallback, whose strict mode uses
   constrained decoding.
4. **Put the static part first** (instructions, type sheets, do-not-repropose list), byte for byte
   identical across calls, so Groq's automatic prompt caching applies.
5. **Keep each Groq request under about 7,000 tokens** including the maximum output, since a
   request larger than the 8,000-token minute limit can never pass on the free plan. If the type
   sheets grow beyond that, the overflow simply stays with the primary or waits.
6. **Record the provider and model ID** with each classification result, next to the instructions
   version (DET-53), so the quality indicators can be compared by model (DET-56).

## Terms on personal use and automated access

- **Cloudflare**: the [Self-Serve Subscription Agreement](https://www.cloudflare.com/terms/), last
  updated 2025-09-12, is made between Cloudflare and "you, or the Entity you represent", so an
  individual can use it for a personal project; it adds a Data Act addendum for individuals in the
  European Union, and Free Services last until Cloudflare ends them (section 2.6). The models carry
  their own licenses, which Cloudflare asks users to review
  ([Workers AI data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/)).
  Programmatic calls through the REST API are the product.
- **Groq**: the [Services Agreement](https://console.groq.com/docs/legal/services-agreement), last
  modified 2026-06-22, covers services provided for developers, businesses or enterprises and states
  that they are not for consumer use. A developer calling the API from a personal application is the
  developer use the agreement describes; the clause still leaves some ambiguity for a purely
  personal project, which is one reason Groq is the fallback rather than the primary. Customers in
  the European Economic Area contract with Groq UK Limited. Preview models are for evaluation only
  ([Groq models](https://console.groq.com/docs/models)); `openai/gpt-oss-120b` is a production model.

## Why the Gemini free tier is excluded

Gemini would be the strongest technical fit (native schema-constrained JSON, current models such as
`gemini-3.5-flash-lite` on the free tier, France listed as an available region), but it fails three
rules for an owner in France:

1. **EEA clause**: the Gemini API Additional Terms, effective 2026-03-23, allow only Paid Services
   when an API client is made available to users in the European Economic Area, Switzerland or the
   United Kingdom ([Gemini API Additional Terms](https://aistudio.google.com/docs/terms), "Use
   Restrictions"). This application is an API client whose only user is in France; reading the
   clause as not applying to a developer's own tool is possible, but not safe.
2. **Purpose clause**: the same section reserves AI Studio and the Gemini API for developers building
   for professional or business purposes, not for consumer use, which a personal, non-commercial
   project does not clearly satisfy.
3. **Unpublished limits**: the free tier's per-model limits are shown only inside AI Studio after
   signing in, and Google states that limits are not guaranteed
   ([Gemini rate limits](https://aistudio.google.com/docs/rate-limits)), so the volume could not be
   checked against them.

For the record, users in the EEA get the paid-tier data terms even on the unpaid quota, so their
prompts are not used to improve Google's products ([Gemini API Additional Terms](https://aistudio.google.com/docs/terms),
"Unpaid Services").

## Inactivity policy

- **Cloudflare**: no inactivity clause in the Self-Serve Subscription Agreement.
- **Groq**: no inactivity clause in the Services Agreement. The fallback is exercised whenever the
  primary fails and by the installation check (TRV-47), so its key does not sit unused.

## Data we send

Only public press data, as DET-14 and DSN-05 require: the article's title and excerpt, its outlet and
publication time, the recognized players and their name variants, the validated type sheets, the
do-not-repropose list and the recent events of those players (types, dates, short descriptions).
Nothing about the owner. What the providers do with it:

- **Cloudflare**: zero data retention for standard inference, and no use of the content to train
  models ([Workers AI data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/),
  updated 2026-10-16).
- **Groq**: inference data is not retained by default; inputs and outputs may be logged for up to 30
  days only for reliability or abuse cases, with an opt-out in Data Controls; retained data is stored
  in Google Cloud in the United States ([Your data](https://console.groq.com/docs/your-data)). The
  agreement forbids Groq to train on inputs or outputs without permission
  ([Services Agreement](https://console.groq.com/docs/legal/services-agreement), section 4.2).

## Availability in France

- **Cloudflare**: worldwide; no country restriction found.
- **Groq**: available; customers in the European Economic Area contract with Groq UK Limited under
  the laws of England and Wales ([Services Agreement](https://console.groq.com/docs/legal/services-agreement)).
- **Gemini, for the record**: France is an available region, but see the exclusion above.

## How it is called

Both over plain HTTPS with `fetch`; no SDK is required.

- **Workers AI**: `POST https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/zai-org/glm-4.7-flash`
  with `Authorization: Bearer {CLOUDFLARE_AI_API_TOKEN}`
  ([Workers AI REST API](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)). The
  body carries `messages`, `max_completion_tokens` and
  `response_format: { type: "json_schema", json_schema: { name, schema, strict: true } }`, which the
  model's input schema accepts ([glm-4.7-flash input schema](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/sync-input.json)).
  Cloudflare does not guarantee that an answer matches the schema and returns the error
  "JSON Mode couldn't be met" when it cannot ([JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/)),
  hence the validation and the strict fallback.
- **Groq**: OpenAI-compatible, base URL `https://api.groq.com/openai/v1`
  ([OpenAI compatibility](https://console.groq.com/docs/openai)); `POST /chat/completions` with
  `Authorization: Bearer {GROQ_API_KEY}`, `model: "openai/gpt-oss-120b"`,
  `response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }` and
  `reasoning_effort: "low"`. Every response carries `x-ratelimit-*` headers; usage reports cached
  tokens in `prompt_tokens_details.cached_tokens` ([Groq rate limits](https://console.groq.com/docs/rate-limits),
  [prompt caching](https://console.groq.com/docs/prompt-caching)).

### Environment variables

| Variable                  | Value                                                   | Secret |
| ------------------------- | ------------------------------------------------------- | ------ |
| `CLOUDFLARE_ACCOUNT_ID`   | The Cloudflare account ID shown on the Workers AI page  | No     |
| `CLOUDFLARE_AI_API_TOKEN` | API token with Workers AI Read and Workers AI Edit only | Yes    |
| `GROQ_API_KEY`            | GroqCloud API key                                       | Yes    |

## When a quota is hit

- **Workers AI**: beyond 10,000 neurons in a day, further operations fail with an error until
  00:00 UTC ([Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)).
  The application stops at its own counter first (TRV-04), and treats an unexpected refusal as the
  limit being reached for the day (TRV-06); either way it switches to the fallback.
- **Groq**: `429 Too Many Requests` with a `retry-after` header in seconds
  ([Groq rate limits](https://console.groq.com/docs/rate-limits)). A per-minute limit means wait and
  retry; the daily limits mean the fallback is done for the day.
- **Both exhausted or failing**: articles stay "en attente de classification" without loss, in the
  priority order of DET-09; the "quota atteint" incident opens with the number waiting and the next
  resumption (DET-08, DET-11); the owner can classify an article himself (DET-13).

## Quota parameters to enter (TRV-03)

| Service and parameter                                 | Value to enter           |
| ----------------------------------------------------- | ------------------------ |
| Workers AI, neurons a day                             | 10,000 (reset 00:00 UTC) |
| Workers AI, requests a minute                         | 300                      |
| Groq `openai/gpt-oss-120b`, requests a minute / a day | 30 / 1,000               |
| Groq `openai/gpt-oss-120b`, tokens a minute / a day   | 8,000 / 200,000          |

## Replaceable by

Any API that accepts a JSON schema and reads English and French; the provider sits behind the
application's interface and both current ones are plain HTTPS. In order of preference:

- **The same-account spares**: `@cf/google/gemma-4-26b-a4b-it` (256,000-token context, about 150
  realistic calls a day from the same allocation) if `glm-4.7-flash` is retired, and
  `openai/gpt-oss-20b` on Groq, which has its own 200,000 tokens a day.
- **Google Gemini** (`gemini-3.5-flash-lite` is on the free tier today,
  [Gemini pricing](https://aistudio.google.com/docs/pricing)), only if its EEA clause is ever lifted.
- **OVHcloud AI Endpoints** without an account: 2 requests a minute per IP address and per model
  ([AI Endpoints capabilities](https://docs.ovhcloud.com/en/guides/public-cloud/ai-machine-learning/ai-endpoints-capabilities)),
  but presented for comparing and testing before production
  ([AI Endpoints catalog](https://www.ovhcloud.com/en/public-cloud/ai-endpoints/catalog/)), with no
  contract, and shared by every Vercel customer behind the same outbound address.

## Date checked

2026-11-11.

## What was verified and how

Read on 2026-11-11, without logging in, from the official documentation of each provider: Workers
AI pricing, limits, JSON mode, data usage, REST API, model pages and input schemas; the Cloudflare
Self-Serve Subscription Agreement; Groq's rate limits, models, structured outputs, prompt caching,
billing FAQ, data and Services Agreement pages; Google's Gemini rate limits, pricing, regions and
Additional Terms; and the pages of every rejected provider listed in [README.md](README.md). No
account was created and no key used. An unauthenticated test call to OVHcloud's anonymous endpoint
returned schema-valid JSON. Not verified: how the two models actually perform on this taxonomy
(to be measured, DET-56), whether Groq caches prompts on the free plan as on paid ones (its pages
state no plan restriction), and real output sizes.

## Risks

- **Schema adherence on Workers AI is not guaranteed**: validation and the strict fallback absorb
  failures, at the cost of quota.
- **Model churn**: Cloudflare retires models on short schedules (for example
  `@cf/qwen/qwen3-30b-a3b-fp8`, planned deprecation 2026-11-20 on its
  [model page](https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/)); keep the
  model ID configurable and check the model page before each deployment (TRV-10).
- **Different models classify differently**: detections from the two providers are not strictly
  comparable; the recorded model ID makes this visible.
- **Free allocations can shrink without notice**: TRV-06 handles a refusal below the declared limit.
- **Groq's consumer-use wording**, described above.
- **The 8,000-token minute limit on Groq** caps the size of the prompt the fallback can take.
