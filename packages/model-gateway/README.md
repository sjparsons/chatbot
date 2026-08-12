# @chatbot/model-gateway

Everything between chat-api and a model provider: the client, model config,
timeouts, the fallback model, and one error type.

```ts
const gateway = createGateway();
for await (const delta of gateway.generate(messages, { signal, system })) { … }
```

`generate` is an **async generator**, which is what let token streaming land in
here without touching the SSE transport or the UI. It yields provider text
deltas as they arrive; how many there are is the provider's business, so a
consumer must append rather than assume.

## Configuration

| Variable             | Default             | Purpose                                  |
| -------------------- | ------------------- | ---------------------------------------- |
| `MODEL_PROVIDER`     | `anthropic`         | `mock` skips the network entirely         |
| `MODEL_ID`           | `claude-haiku-4-5`  | Model the turn goes to                    |
| `MODEL_FALLBACK_ID`  | `claude-sonnet-5`   | Tried once on a retryable failure; `none` disables |
| `MODEL_MAX_TOKENS`   | `4096`              | Ceiling on the reply, not a target        |
| `MODEL_TIMEOUT_MS`   | `60000`             | Wall clock for one provider call          |
| `MODEL_MAX_RETRIES`  | `2`                 | Attempts per call, inside the SDK         |
| `MODEL_LOG_PAYLOADS` | on (`0` disables)   | Print the messages sent and text returned |
| `MODEL_LOG_WIRE`     | off (`1` enables)   | Also print the raw HTTP exchange with the provider |
| `ANTHROPIC_API_KEY`  | —                   | The only variable you must set (or `ANTHROPIC_AUTH_TOKEN`) |

## Non-obvious things

- **A refusal is a successful response, not an exception.** HTTP 200,
  `stop_reason: "refusal"`, empty content. It has to be checked *before* reading
  the content, and it is not retryable — it is a decision, not a fault. Streamed,
  `stop_reason` only arrives in the final `message_delta`, so the check runs
  after the stream ends. That is still sound: a refusal carries no text, so
  nothing has been yielded by the time it throws.
- **Only `text_delta` is prose.** `thinking_delta` and `input_json_delta` arrive
  on the same `content_block_delta` event and would otherwise be concatenated
  straight into the reply.
- **The fallback cannot fire once a chunk is out the door.** The reader is
  already looking at it, and a second model would restart the reply mid-sentence
  rather than continue it. Streaming trades some of the fallback's reach for
  time-to-first-token; a failure after the first delta is final.
- **Retries are the SDK's, not ours.** It already backs off and honours
  `retry-after` on a 429. A second layer on top would only multiply the wait.
  What the gateway adds is the *fallback model*, which the SDK has no concept of.
- **The fallback only fires on retryable codes** (`timeout`, `rate_limit`,
  `overloaded`, `upstream`). Bad credentials or a bad model id fail the same way
  on any model, so retrying them just burns a second call.
- **`GatewayError.code`, not the message, is the contract.** chat-api maps codes
  to what the browser is told; provider messages carry request ids and internal
  detail and stay in the turn log.
- **Turn metadata is a callback (`onMetadata`), not the generator's return
  value.** `for await` discards a generator's return, and the turns worth
  accounting for are exactly the ones that never reach it — a refusal throws, an
  abort breaks out of the loop, and both were billed. The callback has already
  fired by then. On a fallback it fires once per *answering* call; the last one
  is the one that produced the reply.
- **Cost is priced here, from `pricing.ts`.** The gateway is what knows which
  model ran, so it is what can price it. An unlisted model yields a null cost
  rather than a guess. Dated ids are priced by their alias prefix, so a model
  release does not need a new table entry.
- **The timeout is set explicitly because the SDK's default is 10 minutes**,
  which would hold an SSE stream open far longer than anyone waits.
- **Haiku does not accept `effort`** — it 400s. Nor does the gateway send
  `thinking`; neither is wanted for a retail chat reply.
- **Credentials come from the environment and nowhere else.** The SDK reads
  `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` from the process env — there is no
  config file, profile, or ambient credential behind it. It also does *not*
  fail at construction when both are missing: it gets as far as building request
  headers on the first turn. The gateway checks up front so a missing key is a
  failed boot, not a failed customer message.
- **`MODEL_LOG_WIRE=1` swaps the SDK's `fetch`** rather than parsing anything
  back out of it, so what it prints is the actual exchange: URL, headers, and
  both JSON bodies. `x-api-key` and `authorization` are redacted going in —
  there is a test asserting the key appears nowhere in the log, because this is
  the one feature that could leak it. The response is `clone()`d before reading,
  since a body is consumed once and the SDK still needs the original — but a
  streaming body is *not* awaited: draining it to completion would hold every
  token back until the last one arrived, turning a debug flag into a bug. Its
  frames are logged in the background as they land, with a `+Nms` offset that is
  the sharpest view of what the provider is actually doing.
- **The wire log is where the response fields the SDK doesn't type live** —
  `stop_details`, `service_tier`, and the `anthropic-ratelimit-*` headers. The
  cost columns no longer need it: token counts and the dated model id come off
  the stream events, and the request id off the stream object.
- **The system prompt is a per-call argument, not gateway config.** The gateway
  does not know what the assistant is; chat-api owns the prompt artifact and
  hands it over per turn. Later steps send different prompts to different models
  through the same gateway, which config could not express. It goes on the wire
  as the API's top-level `system` parameter — there is no `role: "system"`
  message — and is omitted entirely when absent, since `""` is a system prompt,
  not the lack of one.
- **`system` carries its version with its text**, and the payload log prints the
  version rather than the text: the same prompt every turn is not worth
  reprinting, and the id is the handle for finding it in git. A version that
  could be logged without the text it labels is one that can drift from it.
- **The fallback model gets the same prompt.** A fallback answering under
  different instructions would be a silent behaviour change logged under the
  same version.
- **The mock is a provider, not a test double.** It keeps the suite hermetic and
  `npm run dev` runnable without a key, and it logs in the same shape as a real
  turn so switching providers does not change what the dev log looks like. It
  streams word by word (`MOCK_DELAY_*` is the pause before the first chunk,
  `MOCK_CHUNK_DELAY_MS` the gap after that), so the transport is exercised
  keyless rather than only against a real model.

## Deliberately not here yet

No tool loop (phase 3). The payload log is the stand-in: while nothing else
records what the model saw in full, stdout is it.

The system prompt passes *through* here but does not live here — it is
chat-api's artifact, at
[`src/prompt/`](../chat-api/src/prompt/).
