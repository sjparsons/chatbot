# @chatbot/chat-api

HTTP service the chat UI talks to. Streams replies over Server-Sent Events and
records every turn in SQLite.

Turns go to a real model through `@chatbot/model-gateway`, which owns the
provider client, timeouts, the fallback model, and error mapping. Set
`MODEL_PROVIDER=mock` to run without a key: the mock echoes the context it was
handed, so `RESPONSE (5 messages in context, previous: "…")` still shows the
model would have seen the earlier turns.

```sh
npm run dev -w @chatbot/chat-api    # http://localhost:3001
```

## Scripts

| Script      | What it does                                      |
| ----------- | ------------------------------------------------- |
| `dev`       | `tsx watch`, restarts on change                    |
| `build`     | Compiles to `dist/`, copies `schema.sql`           |
| `start`     | Runs the compiled output                           |
| `test`      | Vitest, against an in-memory DB on a random port   |
| `typecheck` | `tsc --noEmit`                                     |

## Configuration

Copy the example at the repo root and fill in the key:

```sh
cp .env.example .env.local
```

`.env.local` is gitignored. chat-api finds it by walking up from its own source
rather than from the working directory, so one file at the root of the main
checkout also serves every git worktree under `.claude/worktrees/` — the boot
log names the file it actually loaded. Real environment variables are not
overwritten, so `ANTHROPIC_API_KEY=… npm run dev` still wins, and `ENV_FILE`
points at a specific file.

| Variable             | Default                  | Purpose                        |
| -------------------- | ------------------------ | ------------------------------ |
| `PORT`               | `3001`                   | Listen port                     |
| `CORS_ORIGINS`       | `http://localhost:5173`  | Comma-separated allowed origins |
| `DATABASE_URL`       | `./data/chat.sqlite`     | SQLite file, or `:memory:`      |
| `CONTEXT_WINDOW_TURNS` | `10`                   | Turns of transcript sent to the model |

Model, provider, timeouts and the payload log are configured separately — see
[`@chatbot/model-gateway`](../model-gateway/README.md).

### CORS preflight

The `OPTIONS` requests before every `POST /chat` are the browser, not us:
`Content-Type: application/json` isn't a CORS-safelisted content type, so it
checks first. We don't set `Access-Control-Max-Age`, so browsers cache the
preflight only briefly (~5s in Chrome) and you'll see one per message — a
`maxAge` on the `cors` options would collapse that, left off while the traffic
is worth watching.

Same-origin in production (reverse proxy under `/api`) removes CORS entirely —
a deployment change, not a code one.

## Endpoints

| Method | Path                       | Description                              |
| ------ | -------------------------- | ---------------------------------------- |
| `GET`  | `/health`                  | Liveness check                            |
| `POST` | `/chat`                    | Send a message, stream the reply over SSE |
| `GET`  | `/sessions`                | Session history, newest first             |
| `POST` | `/sessions`                | Create an empty session                   |
| `GET`  | `/sessions/:id`            | Session metadata                          |
| `GET`  | `/sessions/:id/messages`   | Flattened transcript, oldest first        |

### `POST /chat`

```jsonc
{ "content": "do you sell blue shirts?", "sessionId": null }
```

`sessionId` may be omitted, `null`, or unknown — a session is created and its id
returned on the `start` event. Clients hold that id and send it on later turns.

```
event: start
data: {"sessionId":"7771215b-…","requestId":"0cf2a776-…"}

event: delta
data: {"text":"RESPONSE (3 messages in context, previous: \"…\")"}

event: done
data: {"responseId":"5b53bb03-…","latencyMs":713}
```

Every event's `data` is JSON so clients parse them uniformly. Failures emit
`event: error` with `{"message": "…"}` instead of `done`, and the stream is
closed either way — a provider failure never leaves the client hanging.

That message is a **category** ("the assistant is busy — try again in a
moment"), not the provider's. Provider messages carry request ids and internal
detail, so they stay in the `responses` row and the server log.

There's one `delta` today; real token streaming emits many. That's the only wire
change it requires, which is why the mock is an async generator rather than a
function returning a string.

Clients use `fetch` and read the `ReadableStream`, not `EventSource` — the
latter can only issue GETs and can't send a body. The model APIs behave the same
way, so the shape carries over.

### `GET /sessions`

Backs the UI's sidebar. `?limit=` defaults to 100, caps at 200.

```jsonc
{ "sessions": [
  { "id": "7771215b-…", "createdAt": "…", "updatedAt": "…",
    "preview": "do you sell blue shirts?", "turnCount": 3 }
] }
```

`preview` is the *first* user message, so a row's label doesn't change as the
conversation goes on; it's `null` for a session with no turns yet, which is why
the query uses subqueries rather than a join that would drop those rows.

Ordered by `updated_at`, which only moves when a response is written. A session
whose reply failed keeps its old timestamp and sorts lower than you might
expect.

Unlike the tables' role as a turn log, this is a read path — but a UI query, not
one on the request path, so the "not a cache" note below still holds.

## The system prompt

`src/prompt/system.md` is the assistant's instructions — a file in git, loaded
at boot and passed to the gateway with every turn.

Its **version is the first 12 hex characters of the SHA-256 of the text sent**,
not a number anyone maintains. Edit the prompt and the id moves on its own,
which is the point: a hand-bumped version that someone forgets to bump labels
every turn after it with a lie. What a hash gives up is ordering — two ids tell
you the prompt changed, not which came first. Git knows that.

The text is trimmed before hashing, so the id covers exactly the bytes the
provider receives rather than the file's trailing newline.

It appears twice in the log: once at boot, and once per turn on the gateway's
request line (`system 07d6cad1e22f (1619 chars)`). If those disagree, the file
changed while the process was up. The prompt text itself is *not* printed per
turn — that is what the version replaces. Step 5 puts the same string in the
`responses` row, which is what makes "which prompt produced this reply"
answerable in SQL rather than by scrolling stdout.

`createApp()` takes the prompt as an argument, like the repository and the
gateway, so the request path never reads the filesystem and tests supply their
own.

Tool definitions belong in this directory too, and in the hash, when there are
any — phase 3.

## Context assembly

`context.ts` turns a session transcript into the model's message array. The
request is logged *before* the model is called, so it comes back as the last
turn — the one with no response yet — and becomes the trailing user message.

Two decisions worth knowing:

- **Last N turns verbatim** (`CONTEXT_WINDOW_TURNS`, the current turn included),
  windowed in SQL so the request path never loads a transcript that only grows.
  Summarizing older turns is deferred until sessions outgrow the window.
- **A turn that never got a successful reply is dropped whole**, rather than
  contributing a lone user message. That keeps roles strictly alternating,
  which is what the provider APIs expect, and an abandoned turn isn't something
  the model ever said. Visible in the log as a `status = 'error'` response and
  absent from the next turn's context.

Turns are ordered by `created_at`, ties broken by `id` — a random UUID, so
same-millisecond turns order arbitrarily. Real turns are a round trip apart;
tests that insert back-to-back have to set the clock.

## Database

SQLite via `better-sqlite3` at `data/chat.sqlite` (gitignored).
`src/db/schema.sql` is applied on boot and is idempotent — fine while changes
are additive, but swap in a migration tool before the first destructive one.

- **`sessions`** — one row per conversation
- **`requests`** — one row per inbound message
- **`responses`** — one row per reply, 1:1 with a request, carrying `status`
  (`ok`/`error`), `error`, `latency_ms`

This is the transcript of record — what was asked and what was answered,
independent of whatever a model eventually sees in its context window. A
response row is written even when the stream fails or the client disconnects
mid-flight, so dropped turns are visible rather than missing.

Model id, prompt version, token counts, and cost belong here too — those are
what make a regression attributable. Step 5.

**Not a cache yet.** Logging every turn makes caching possible later, but
nothing reads these tables on the request path. Adding that means picking a key,
and in multi-turn chat the latest message alone won't do — "does it come in
blue?" depends on what preceded it. Deferred until there's an expensive call
worth avoiding.

## Layout

```
src/
  index.ts        Entry point: opens the DB, starts the server
  server.ts       Express app assembly (createApp, for tests)
  config.ts       Environment configuration
  context.ts      Transcript -> the model's message array
  prompt/
    system.md     The system prompt, versioned by its own hash
    index.ts      Loads it and stamps the version
  sse.ts          Server-Sent Events writer
  routes/
    chat.ts       POST /chat
    sessions.ts   Session and transcript endpoints
  db/
    index.ts      Connection and schema application
    schema.sql    DDL
    repository.ts All SQL lives here
```

`createApp()` takes its repository as an argument, so tests hand it an in-memory
database. All SQL is confined to `db/repository.ts` — moving to Postgres means
rewriting that one file.
