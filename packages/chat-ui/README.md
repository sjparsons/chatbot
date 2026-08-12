# @chatbot/chat-ui

The chat interface — a React SPA served by Vite. It calls
[`@chatbot/chat-api`](../chat-api/README.md) directly over HTTP and renders the
reply as it streams in.

**chat-api must be running**, or every message fails. `npm run dev` at the repo
root starts both.

```sh
npm run dev -w @chatbot/chat-ui    # http://localhost:5173
```

## Scripts

| Script       | What it does                          |
| ------------ | ------------------------------------- |
| `dev`        | Vite dev server with hot reload        |
| `build`      | Typechecks, then builds to `dist/`     |
| `start`      | Serves the built output                |
| `test`       | Vitest, single run                     |
| `test:watch` | Vitest in watch mode                   |
| `typecheck`  | `tsc --noEmit`                         |

## Configuration

| Variable            | Default                 | Purpose           |
| ------------------- | ----------------------- | ----------------- |
| `VITE_CHAT_API_URL` | `http://localhost:3001` | chat-api base URL |

Copy `.env.example` to `.env.local` to override.

## Stack

React 19, React Router 7 (library mode via `createBrowserRouter` — no server, so
no loaders or actions), Vite 6, Vitest.

## Layout

```
src/
  main.tsx           Mounts RouterProvider into #root
  router.tsx         Route definitions
  routes/
    root.tsx         Layout: header plus <Outlet />
    chat.tsx         Chat page — owns message and session state
  components/
    MessageList.tsx  Renders messages, autoscrolls, shows pending state
    MessageInput.tsx Composer form
  api/
    chat.ts          chat-api client
    sse.ts           Server-Sent Events parser
  types.ts           Message and Role
  vite-env.d.ts      Typing for VITE_ environment variables
  styles.css         Plain CSS, light and dark via prefers-color-scheme
```

## Talking to chat-api

```ts
const { sessionId, content } = await sendMessage(
  { content: "do you sell blue shirts?", sessionId },
  { onStart: (p) => setSessionId(p.sessionId), onDelta: (text) => ... },
);
```

Uses `fetch` plus a `ReadableStream` reader rather than `EventSource`, which can
only issue GETs and can't send a body. `api/sse.ts` handles the wire format:
events split across chunks, several events per chunk, comments, keep-alives.

`onDelta` fires per chunk. There's one chunk today, but the UI appends rather
than replaces, so real token streaming needs no changes here.

## Rendering a turn

`routes/chat.tsx` appends the user's message and disables the composer, then:

- **before the first chunk** — `MessageList` shows a `…` placeholder
- **on the first chunk** — an assistant message is appended and the placeholder
  goes; the message itself is now the progress indicator
- **on later chunks** — text is appended to that message
- **on failure** — the error renders above the composer

## Session state

The session id arrives on the `start` event of the first turn and is sent with
every message after, which is what ties the turns together server-side.

Messages and session id are in-memory, so a refresh starts a new conversation.
The transcript is still on the server and `GET /sessions/:id/messages` will
rehydrate it, but nothing persists the id in the browser yet.
