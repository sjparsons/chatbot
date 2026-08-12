# @chatbot/chat-ui

The chat interface — a React single-page app served by Vite.

It is standalone right now: sending a message returns a hardcoded mock response
instead of calling a backend.

## Running

From the repo root:

```sh
npm run dev -w @chatbot/chat-ui
```

Or `npm run dev` at the root to start this alongside every other service. Either
way it serves on http://localhost:5173.

## Scripts

| Script              | What it does                                     |
| ------------------- | ------------------------------------------------ |
| `dev`               | Vite dev server with hot reload, port 5173        |
| `build`             | Typechecks, then builds to `dist/`                |
| `start`             | Serves the built `dist/` output, port 5173        |
| `test`              | Runs the Vitest suite once                        |
| `test:watch`        | Vitest in watch mode                              |
| `typecheck`         | `tsc --noEmit`                                    |

## Stack

- React 19
- React Router 7, used as a library (`createBrowserRouter`) rather than in
  framework mode — there is no server, so no loaders or actions
- Vite 6
- Vitest

## Layout

```
src/
  main.tsx              Mounts RouterProvider into #root
  router.tsx            Route definitions
  routes/
    root.tsx            Layout: header plus <Outlet />
    chat.tsx            Chat page — owns message state and send handling
  components/
    MessageList.tsx     Renders messages, autoscrolls, shows pending state
    MessageInput.tsx    Composer form
  api/
    chat.ts             Chat transport (mocked)
    chat.test.ts
  types.ts              Message and Role
  styles.css            Plain CSS, light and dark via prefers-color-scheme
```

## The mock transport

`src/api/chat.ts` is the seam where the real Chat API Service call will go:

```ts
export async function sendMessage(_content: string): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  return "RESPONSE";
}
```

The 300ms delay is deliberate — it makes the pending state visible while the
response is in flight. `routes/chat.tsx` appends the user's message, renders a
placeholder and disables the composer until the promise settles, then appends
the reply.

Replacing this function with a real HTTP call is the only change the UI needs to
talk to a backend. Streaming will require more than a swap, since the current
signature resolves a whole string at once.

## Message state

State lives in `routes/chat.tsx` and is in-memory only — a page refresh clears
the conversation. There is no session or persistence yet.
