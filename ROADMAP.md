# Roadmap

Incremental plan toward a working retail assistant. Each step should leave the
system runnable.

## Where things stand

Two packages, wired together and committed:

- **chat-ui** (:5173) — React SPA, streams replies via `fetch` + `ReadableStream`
- **chat-api** (:3001) — Express, `POST /chat` emits SSE `start`/`delta`/`done`,
  every turn logged to SQLite (`sessions`, `requests`, `responses`)

No model. `mock.ts` yields one chunk after 0.5–3s — but it now takes the
assembled message array, so a second turn demonstrably sees the first.

Sessions survive a refresh: the id is in the URL and the sidebar lists previous
conversations (step 20, done early).

**Seams already in place:** `mock.ts` is an async generator taking a message
array (many chunks needs no transport change, and a provider client drops into
the same signature); all SQL is confined to `db/repository.ts`; `createApp()`
takes its repository as an argument.

## Decisions already made

| Decision | Rationale |
| --- | --- |
| SQLite, file-backed | Zero setup while iterating. Confined to `repository.ts`, so Postgres later is one file. |
| UI calls chat-api directly | No BFF. Same-origin in prod removes CORS; deployment change, not code. |
| SSE over POST, not `EventSource` | `EventSource` can't send a body. Matches how provider APIs stream. |
| Turn log is observability, not cache | No read path on the request path. Caching needs a key strategy, and in multi-turn chat the latest message alone won't do. |

---

## Phase 1 — A real model, end to end

**1. Context assembly.** ✅ Done. `context.ts` builds the message array from the
session transcript; window policy is the last `CONTEXT_WINDOW_TURNS` turns
verbatim (default 10), windowed in SQL. Turns without a successful reply are
dropped so roles stay alternating. Summarization stays deferred.

**2. Model gateway.** New package. Owns the provider client, model config,
retries with backoff, timeouts, fallback model, and error mapping — including
refusals, which arrive as a successful response with an empty content array,
not an exception.
*Done when:* chat-api calls the gateway instead of `mock.ts`, and provider
failures surface as a clean `error` event rather than a hung stream.

**3. Real streaming.** Pipe provider deltas through the gateway into the
existing SSE `delta` events. The transport already handles many chunks; the
mock only ever emits one, so this is untested in practice.
*Done when:* text appears progressively in the UI.

**4. Prompt as a versioned artifact.** System prompt and tool definitions live
in files, in git, with a version id.
*Done when:* changing the prompt changes a version string that gets logged.

**5. Extend the turn log.** Add model id, prompt version, input/output tokens,
cost, and finish reason to `responses`. This is what makes a regression
attributable to a change.
*Done when:* a turn's full cost and provenance are reconstructable from SQL.

**6. Minimal eval harness.** A handful of golden cases, run against the current
prompt, scored. Thin is fine — the point is a baseline before behavior starts
changing underneath.
*Done when:* `npm test` or a sibling script reports a score, and a prompt
regression shows up as a number.

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
