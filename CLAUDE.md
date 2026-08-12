# Working on this repo

**Read `ROADMAP.md` first.** It has current state, the decisions already made
and why, and the ordered plan. Package READMEs cover the detail.

## How this project is built

Sam is leading the design and building this incrementally to learn the
architecture. Implement the step being asked for — don't build ahead, don't
scaffold future phases, don't fold in the next roadmap item because it's
adjacent. If a step seems wrong or is missing a prerequisite, say so in a
sentence or two, then build what was asked.

Questions about the architecture are genuine questions. Answer them directly
rather than turning them into work.

## Bar for "done"

- `npm run typecheck` and `npm test` clean
- new behaviour has a test
- anything touching the wire gets a real smoke test (start it, curl it, check
  the DB) — not just unit tests
- state plainly what you did *not* verify

## Docs

Keep READMEs tight. Document what is non-obvious — why a decision was made, what
bit someone — not what the code already says. Update them in the same change as
the code.

## Commits

Only when asked. Straight to `main`, matching the existing history. Body should
explain the why, especially any non-obvious fix.

## Non-obvious things

- **Abort detection in `routes/chat.ts` listens on `res`, not `req`.**
  `express.json()` drains the request stream before the handler runs, so `req`
  emits `close` immediately and flags every stream as aborted — `res.end()` then
  never fires and the client hangs. Guard with `res.writableEnded`.
- **The gateway's `generate()` is an async generator** so that real token
  streaming needs no transport or UI change. Keep it that way.
- **A model refusal is a successful response, not an exception** — HTTP 200,
  `stop_reason: "refusal"`, empty content. Check it before reading the content.
- **All SQL lives in `db/repository.ts`** — the Postgres move is meant to be one
  file.
- **`createApp()` takes its repository and its gateway as arguments** so tests
  use an in-memory DB and the mock provider on an ephemeral port.
- **chat-api references model-gateway as a TypeScript project**, so `typecheck`
  is `tsc --build` and emits. That is what keeps the two in dependency order
  regardless of the workspace order npm happens to use. Tests skip it — vitest
  aliases the package to its source.
- **The UI streams with `fetch` + `ReadableStream`, not `EventSource`** —
  `EventSource` can't send a body.
- **`OPTIONS` requests in the browser are CORS preflight**, not application
  code. Expected while the UI and API are on different ports.
- **The turn log is not a cache.** Nothing reads it on the request path. Don't
  add a read path without deciding the key strategy first.
