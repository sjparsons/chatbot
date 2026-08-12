# chatbot

A retail chat assistant, built up one service at a time. Products and store
policies are the two things it will eventually answer questions about.

This is an npm workspaces monorepo. Each service is its own package under
`packages/` with its own `dev` / `build` / `start` / `test` / `typecheck`
scripts, and the root can run them individually or all at once.

## Requirements

- Node 24+ (developed on 24.14)
- npm 11+

## Getting started

```sh
npm install     # installs every workspace
npm run dev     # starts all services
```

The chat UI is then at http://localhost:5173.

## Scripts

Run from the repo root:

| Script              | What it does                                                  |
| ------------------- | ------------------------------------------------------------- |
| `npm run dev`       | Starts every service in parallel, labelled per service         |
| `npm run start`     | Same, but serving built output rather than dev servers         |
| `npm run build`     | Builds every workspace that defines a `build` script           |
| `npm test`          | Runs every workspace's tests                                   |
| `npm run typecheck` | Typechecks every workspace                                     |

To work on one service in isolation, target its workspace directly:

```sh
npm run dev -w @chatbot/chat-ui
npm test -w @chatbot/chat-ui
```

`build`, `test`, and `typecheck` fan out with `--if-present`, so a package
without one of those scripts is skipped rather than failing the run. `dev` and
`start` use `concurrently` and list each service explicitly — that's what gives
each one its own label and colour in the combined output.

## Packages

| Package            | Directory           | Port | Description                       |
| ------------------ | ------------------- | ---- | --------------------------------- |
| `@chatbot/chat-ui` | `packages/chat-ui`  | 5173 | React chat interface. See its [README](packages/chat-ui/README.md). |

## Adding a service

1. Create `packages/<name>` with a `package.json` named `@chatbot/<name>`.
2. Give it `dev`, `build`, `start`, `test`, and `typecheck` scripts. Anything
   missing is skipped by the fan-out scripts, but `dev` is needed for the root
   to start it.
3. Extend the shared TypeScript config: `"extends": "../../tsconfig.base.json"`.
4. Add it to the root `dev` and `start` scripts as another `concurrently` entry:

   ```
   concurrently -n chat-ui,my-service -c blue,green \
     "npm run dev -w @chatbot/chat-ui" \
     "npm run dev -w @chatbot/my-service"
   ```

5. Add a row to the Packages table above.

## Conventions

- TypeScript throughout, with Python available if a component is better served
  by it.
- `tsconfig.base.json` holds the shared compiler options (strict, plus
  `noUncheckedIndexedAccess` and unused-symbol checks). Packages override only
  what they need — the UI adds DOM libs and JSX, for example.
- Each package is independently runnable and testable. Nothing in `packages/`
  imports from a sibling yet.

## Status

Only the chat UI exists so far, and it is standalone — sending a message
returns a hardcoded mock response rather than calling a backend. The rest of
the system (chat API service, model orchestration, product search, policy
retrieval) is not built yet.
