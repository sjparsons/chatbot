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
  sessions.tsx       Context holding the session list, with refresh()
  routes/
    root.tsx         Layout: sidebar, header, <Outlet />
    chat.tsx         Chat page — owns message and session state
  components/
    Sidebar.tsx      Session history; collapsible
    MessageList.tsx  Renders messages, autoscrolls, shows pending state
    MessageInput.tsx Composer form
  api/
    chat.ts          chat-api client
    sessions.ts      Session list and stored transcript
    sse.ts           Server-Sent Events parser
    config.ts        API base URL
  types.ts           Message, Role, SessionSummary
  vite-env.d.ts      Typing for VITE_ environment variables
  styles.css         Plain CSS, light and dark via prefers-color-scheme
```

## Routes

| Route            | Page                                            |
| ---------------- | ----------------------------------------------- |
| `/`              | New chat — no session id until the first turn    |
| `/c/:sessionId`  | A previous session, rehydrated from the server   |

`/c/:sessionId` is client-side only, so a static host serving `dist/` needs a
history fallback to `index.html`. Vite's dev server and `vite preview` do this
already; it only bites in production.

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

**The URL is the store.** Once the first turn completes, `chat.tsx` navigates to
`/c/<id>` with `replace`, so a refresh or a pasted link rehydrates from
`GET /sessions/:id/messages`. Nothing is kept in `localStorage` except whether
the sidebar is expanded.

Two things here are less obvious than they look:

- **Rehydration is guarded by a ref, not by the route param alone.** Sending the
  first message creates the session and then puts it in the URL — at which point
  the transcript we already hold is on screen. Without the guard the route
  change would re-fetch and wipe the streamed reply.
- **The navigation happens after the stream, not in `onStart`.** Navigating
  mid-stream re-renders the route while deltas are still arriving. Deferring it
  keeps routing off the streaming path entirely.

The sidebar refreshes after every completed turn, since a turn can create a
session or change which one sorts first.
