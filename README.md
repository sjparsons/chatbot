# chatbot

A retail chat assistant — product search and store policy questions — built up
one service at a time.

npm workspaces monorepo. Each service is a package under `packages/` with its
own `dev` / `build` / `start` / `test` / `typecheck` scripts, runnable alone or
all at once from the root.

Requires Node 24+ and npm 11+.

```sh
npm install
npm run dev     # UI at http://localhost:5173
```

## Packages

| Package             | Directory            | Port | Description                          |
| ------------------- | -------------------- | ---- | ------------------------------------ |
| [`@chatbot/chat-ui`](packages/chat-ui/README.md)   | `packages/chat-ui`  | 5173 | React chat interface                 |
| [`@chatbot/chat-api`](packages/chat-api/README.md) | `packages/chat-api` | 3001 | HTTP + SSE service, SQLite turn log  |

The UI calls chat-api directly from the browser — no proxy — so chat-api allows
CORS from the UI's origin.

## Scripts

| Script              | What it does                                     |
| ------------------- | ------------------------------------------------ |
| `npm run dev`       | All services in parallel, labelled per service    |
| `npm run start`     | Same, from built output                           |
| `npm run build`     | Builds every workspace                            |
| `npm test`          | Runs every workspace's tests                      |
| `npm run typecheck` | Typechecks every workspace                        |

Target one service with `-w`: `npm run dev -w @chatbot/chat-ui`.

`build` / `test` / `typecheck` fan out with `--if-present`, so a package missing
one is skipped rather than failing. `dev` and `start` use `concurrently` and
list services explicitly, which is what gives each its own label and colour.

## Adding a service

1. Create `packages/<name>` with a `package.json` named `@chatbot/<name>`.
2. Give it `dev`, `build`, `start`, `test`, `typecheck`. Only `dev` is required
   for the root to start it.
3. Extend the shared config: `"extends": "../../tsconfig.base.json"`.
4. Add it to the root `dev` and `start` scripts as another `concurrently` entry.
5. Add a row to the table above.

## Conventions

- TypeScript throughout; Python where a component is better served by it.
- `tsconfig.base.json` holds the shared compiler options (strict, plus
  `noUncheckedIndexedAccess` and unused-symbol checks). Packages override only
  what they need.
- Each package runs and tests independently. Nothing imports from a sibling yet.

## Status

UI and chat-api are wired together: replies stream over SSE, every turn lands in
SQLite. Sessions persist across a refresh — the id is in the URL and a sidebar
lists previous conversations to jump back into.

No model yet — chat-api returns `RESPONSE` to everything after a random
0.5–3s delay, so the streaming and pending states are exercised against
something realistic. Model orchestration, product search, policy retrieval, and
guardrails are not built.
