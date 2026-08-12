import { parseSseStream } from "./sse";
import { API_URL } from "./config";

export interface ChatStreamHandlers {
  /** Fires once, before any text — carries the session the turn belongs to. */
  onStart?: (payload: { sessionId: string; requestId: string }) => void;
  /** Fires per chunk. Today there is exactly one; with a real model, many. */
  onDelta?: (text: string) => void;
}

export interface ChatResult {
  sessionId: string;
  content: string;
}

/**
 * Sends a message to chat-api and consumes the SSE response.
 *
 * Resolves once the stream completes; rejects if the service reports an error
 * or the connection drops mid-stream.
 */
export async function sendMessage(
  params: { content: string; sessionId: string | null },
  handlers: ChatStreamHandlers = {},
): Promise<ChatResult> {
  const response = await fetch(`${API_URL}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      content: params.content,
      sessionId: params.sessionId,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `chat-api responded ${response.status}${detail ? `: ${detail}` : ""}`,
    );
  }

  if (!response.body) throw new Error("chat-api returned no response body");

  let sessionId = params.sessionId;
  let content = "";
  let done = false;

  for await (const { event, data } of parseSseStream(response.body)) {
    const payload = data as Record<string, unknown>;

    switch (event) {
      case "start": {
        sessionId = String(payload.sessionId);
        handlers.onStart?.({
          sessionId,
          requestId: String(payload.requestId),
        });
        break;
      }
      case "delta": {
        const text = String(payload.text ?? "");
        content += text;
        handlers.onDelta?.(text);
        break;
      }
      case "done": {
        done = true;
        break;
      }
      case "error": {
        throw new Error(String(payload.message ?? "unknown error"));
      }
    }
  }

  if (!done) throw new Error("chat-api stream ended before completing");
  if (!sessionId) throw new Error("chat-api did not return a session id");

  return { sessionId, content };
}
