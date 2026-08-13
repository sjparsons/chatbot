# Roadmap

Incremental plan toward a working retail assistant. Each step should leave the
system runnable.

## Where things stand

Three packages, wired together and committed:

- **chat-ui** (:5173) — React SPA, streams replies via `fetch` + `ReadableStream`
- **chat-api** (:3001) — Express, `POST /chat` emits SSE `start`/`delta`/`done`,
  every turn logged to SQLite (`sessions`, `requests`, `responses`)
- **model-gateway** — provider client, model config, timeouts, fallback model,
  error mapping

A real model, streaming. The assembled message array goes to Claude Haiku behind
a versioned system prompt and the reply streams back token by token; set
`ANTHROPIC_API_KEY` and it runs, or `MODEL_PROVIDER=mock` for the keyless
version. Every turn records the model, prompt version, tokens and cost it ran
under, so what a turn cost is a SQL query rather than a log line.

Sessions survive a refresh: the id is in the URL and the sidebar lists previous
conversations (step 20, done early).

A baseline. `npm run eval` scores six golden cases against a running chat-api
and appends the number to `packages/evals/results.jsonl`, stamped with the
prompt version that produced it.

**Seams already in place:** the gateway returns an async generator (streaming
cost the transport and the UI nothing, as intended); all SQL is confined to
`db/repository.ts`; `createApp()` takes its repository, its gateway *and* its
system prompt as arguments.

## Decisions already made

| Decision | Rationale |
| --- | --- |
| SQLite, file-backed | Zero setup while iterating. Confined to `repository.ts`, so Postgres later is one file. |
| UI calls chat-api directly | No BFF. Same-origin in prod removes CORS; deployment change, not code. |
| SSE over POST, not `EventSource` | `EventSource` can't send a body. Matches how provider APIs stream. |
| Turn log is observability, not cache | No read path on the request path. Caching needs a key strategy, and in multi-turn chat the latest message alone won't do. |
| Model prices live in the gateway | One table, in the package that already owns model config. Two copies drift silently, and a cost nobody trusts is worse than no cost. |

---

## Phase 1 — A real model, end to end

**1. Context assembly.** ✅ Done. `context.ts` builds the message array from the
session transcript; window policy is the last `CONTEXT_WINDOW_TURNS` turns
verbatim (default 10), windowed in SQL. Turns without a successful reply are
dropped so roles stay alternating. Summarization stays deferred.

**2. Model gateway.** ✅ Done. `@chatbot/model-gateway` owns the provider client,
model config, timeouts, the fallback model, and error mapping — refusals
included, checked as a successful empty response rather than caught. Retries are
the SDK's (it honours `retry-after`); what the gateway adds on top is the
fallback model, tried only on retryable codes. The mock survives as a provider,
so the suite stays hermetic. Payload logging is on by default.

**3. Real streaming.** ✅ Done. The provider call is `messages.stream()`, and
each `text_delta` is yielded straight through the gateway into the existing SSE
`delta` events — no transport or UI change, which was the point of the async
generator. The payload log gained time-to-first-token, the number streaming
exists to move. Two things the streamed shape forced:

- **The fallback model can no longer fire mid-reply.** Once a chunk has reached
  the client, a second model would restart the sentence rather than continue it,
  so a failure after the first delta is final.
- **`MODEL_LOG_WIRE=1` no longer drains a clone of the body.** Awaiting it held
  every token back until the last one arrived. Frames are logged as they land.

The mock streams word by word too, so the transport is exercised without a key.

**4. Prompt as a versioned artifact.** ✅ Done. `chat-api/src/prompt/system.md`
is the assistant's instructions, in git, loaded at boot and passed to the
gateway per turn. The version is the first 12 hex characters of the SHA-256 of
the text sent — derived, not hand-maintained, because a version someone forgets
to bump labels every turn after it with a lie. It prints at boot and on every
gateway request line; the prompt *text* no longer prints per turn, which is the
version earning its keep. The gateway takes `system` as a per-call argument
rather than config, so later steps can send different prompts to different
models. Tool definitions join the directory, and the hash, in phase 3.

**5. Extend the turn log.** ✅ Done. `responses` carries `model`,
`prompt_version`, `provider_request_id`, `stop_reason`, four token counts and
`cost_usd`, so a turn's cost and provenance are a `SELECT`. The dated model id
comes from the response, not the alias sent. Cost is priced in the gateway
(`pricing.ts`) and stored alongside the tokens rather than derived on read — a
price change must not rewrite what past turns cost, and the tokens make the
estimate recomputable. Every column is nullable and null is not zero: a turn
that failed before the model answered has no tokens, while `prompt_version` is
known up front and is recorded even then.

- The gateway hands metadata back through an `onMetadata` callback rather than
  the generator's return value, because a refusal throws and an abort breaks
  out of the loop — the turns most worth accounting for never reach a return.
- SDK 0.68.0 *does* type `cache_creation` and `service_tier` (they are on
  `Usage`); the earlier note here was wrong. Only `stop_details` is untyped,
  and nothing needs it — `stop_reason` is the finish reason.
- Columns were added to an existing table, and `CREATE TABLE IF NOT EXISTS` does
  not reach them. No migration: delete `data/chat.sqlite`.

**6. Minimal eval harness.** ✅ Done. `@chatbot/evals`, run with `npm run eval`
against a chat-api that is already up. Six golden cases, two of them multi-turn,
plus three style checks applied to every reply — 25 checks, and the score counts
checks rather than cases so a failure names itself. Each run appends a line to
`packages/evals/results.jsonl` stamped with the prompt version and model id
`/health` reports, so a regression is a `git diff`.

- **It scores the HTTP endpoint, not the gateway.** Everything phase 2 and 3 add
  — guardrails, tool results, summarization — sits between `/chat` and the
  model. A baseline taken below them would stay green while the product broke.
  It also makes the multi-turn cases real conversations: the model answers turn
  one itself, so the customer's pushback in turn two lands against what it
  actually said.
- **A check is a function from a reply to a verdict**, and `judge()` returns one.
  Mechanical rules stay regexes — paying a model to find em dashes is slower,
  costs money, and is wrong more often. Sonnet judges while Haiku answers.
- **`/health` grew a prompt version and model id.** The harness scores a server
  it did not configure, so a results line stamped from its own environment could
  name a prompt that server never loaded.
- **Deliberately outside `npm test`**, and it exits 0 even with failures. The
  subject is nondeterministic; a threshold here would be a flaky gate, not a
  signal. One sample per case, so run it twice before believing a drop.
- **Each run reports what the judging cost** — token counts and dollars, on
  stdout and in the results line. Grading is about a cent a run. The assistant's
  own inference is not included: step 5 records it per turn in `responses`, but
  nothing reports it back over the wire and the harness only sees HTTP. Adding
  the two together means querying the turn log by prompt version.
- Four runs at prompt `20792ec34f34` scored 24, 24, 22 and 22 out of 25, and
  every failure in all four was the same check: an em dash in a reply that was
  otherwise correct, in roughly a quarter of replies, against a prompt that
  forbids them. No judged check has failed yet, so the finding is style, and the
  fix is in `system.md` rather than here.

## Phase 2 — Guardrails

**7. Input guardrails.** PII detection and masking before anything leaves for
the provider (retail chat collects order numbers, emails, card fragments at
volume), plus out-of-scope and jailbreak filtering. A real layer, not prompt
text.
*Done when:* a blocked input never reaches the gateway and is logged as
blocked.

**8. Output guardrails.** Excluded-terms filtering (server-side, not trusted to
the model), brand-risk checks, and hallucinated-policy detection.

*Open decision:* output scanning conflicts with streaming. Options: buffer then
scan (costs time-to-first-token), scan in chunks (leaves a leakage window), or
stream prose freely and hard-gate only tool calls and structured payloads. The
third is likely right here — the damage lives in the actionable parts.

## Phase 3 — Tools

**9. Tool-calling loop.** In the gateway: `model → tool_use → execute → result →
model`, bounded by max iterations, a per-turn tool budget, and a wall clock.
Emit tool activity as SSE events so the UI can show what's happening.
*Done when:* a multi-step tool exchange completes and every hop is logged.

**10. Product search tool.** MCP server over a text-searchable product corpus.
Excluded terms filter here, server-side, so the model never receives them.

**11. Policy retrieval.** The other half of the product, and the half with legal
exposure. If the corpus is small, this is a cached system-prompt block rather
than a tool — decide before building. Either way: require citation of the source
and version, and refuse rather than guess when the answer isn't in the text.

**12. Product rendering.** A client-side tool whose input is a product-card
payload the UI renders directly. Keeps structured output out of the prose
stream — don't force the whole response into JSON.

**13. Prompt caching.** Once system prompt, tool defs, and policy text are
stable, mark the cache breakpoint. Requires the prefix to be byte-stable —
anything volatile (timestamps, session ids, cart state) must sit after it.

**14. Prompt injection review.** Product descriptions and review text re-enter
the context through tool results. Treat tool output as data, never instructions,
and confirm that before write actions exist.

## Phase 4 — Making it real

**15. Auth and identity.** Sessions tied to a user, tool calls carrying identity
for authorization, per-user rate limits, abuse controls.

**16. Cost controls.** Per-session token budget, max tool iterations, cheaper
model for classification and routing.

**17. Human handoff.** An escalation path and queue. Retail chat needs one, and
"flag for intervention" isn't a path.

**18. Feedback loop.** Thumbs up/down and unhappy-customer signals feed the eval
dataset from step 6. This is the flywheel, and it's the arrow most architectures
leave undrawn.

**19. Tracing.** Per-request spans: prompt version, model, tool calls, retrieved
context, tokens, cost, per-step latency. Plus a sampled full-I/O store that
someone actually reads.

**20. Session persistence in the browser.** ✅ Done, pulled forward out of
order. The session id lives in the URL (`/c/:sessionId`), so a refresh or a
pasted link rehydrates from `GET /sessions/:id/messages`. Widened beyond the
original entry: a new `GET /sessions` and a collapsible sidebar list previous
sessions and let you jump between them.

---

## Deferred

- **Caching read path** — needs a key strategy; revisit when there's an
  expensive call worth avoiding.
- **Write actions** (add to cart, initiate return) — the security cliff. Each
  gets its own dedicated tool, authorization check, and idempotency key; never
  reachable through a generic API-call tool.
- **Model router** — intent classification to cheaper models. One agent with
  good tools handles product + policy fine; the routing that earns its keep
  first is escalation to a human.
- **Postgres** — when SQLite stops fitting.
- **Context summarization** — when sessions outgrow the window.
