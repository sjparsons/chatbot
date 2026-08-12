# @chatbot/model-gateway

Everything between chat-api and a model provider: the client, model config,
timeouts, the fallback model, and one error type.

```ts
const gateway = createGateway();
for await (const delta of gateway.generate(messages, { signal })) { … }
```

`generate` is an **async generator** even though the provider call is currently
non-streaming and yields one chunk. That is the seam: real token streaming is a
change in here, not to the SSE transport or the UI.

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
| `ANTHROPIC_API_KEY`  | —                   | Read by the SDK; absent means it throws at boot |

## Non-obvious things

- **A refusal is a successful response, not an exception.** HTTP 200,
  `stop_reason: "refusal"`, empty content. It has to be checked *before* reading
  the content, and it is not retryable — it is a decision, not a fault.
- **Retries are the SDK's, not ours.** It already backs off and honours
  `retry-after` on a 429. A second layer on top would only multiply the wait.
  What the gateway adds is the *fallback model*, which the SDK has no concept of.
- **The fallback only fires on retryable codes** (`timeout`, `rate_limit`,
  `overloaded`, `upstream`). Bad credentials or a bad model id fail the same way
  on any model, so retrying them just burns a second call.
- **`GatewayError.code`, not the message, is the contract.** chat-api maps codes
  to what the browser is told; provider messages carry request ids and internal
  detail and stay in the turn log.
- **The timeout is set explicitly because the SDK's default is 10 minutes**,
  which would hold an SSE stream open far longer than anyone waits.
- **Haiku does not accept `effort`** — it 400s. Nor does the gateway send
  `thinking`; neither is wanted for a retail chat reply.
- **The mock is a provider, not a test double.** It keeps the suite hermetic and
  `npm run dev` runnable without a key, and it logs in the same shape as a real
  turn so switching providers does not change what the dev log looks like.

## Deliberately not here yet

No system prompt (step 4 makes it a versioned artifact), no token/cost
accounting (step 5 puts it in the turn log), no tool loop (phase 3). The
payload log is the stand-in for all three: while nothing else records what the
model saw, stdout is it.
