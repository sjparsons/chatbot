import type { Logger } from "../logging.js";

/** Headers that carry the credential and must never reach a log. */
const REDACTED = new Set(["x-api-key", "authorization", "proxy-authorization"]);

type HeaderSource = RequestInit["headers"] | Headers;

function headersToObject(headers: HeaderSource): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;

  // Three shapes to handle — Headers, [key, value][], and a plain record — so
  // dispatch on each rather than trying to view them as one iterable.
  const add = (key: string, value: unknown): void => {
    const name = key.toLowerCase();
    out[name] = REDACTED.has(name)
      ? "«redacted»"
      : Array.isArray(value)
        ? value.join(", ")
        : String(value);
  };

  if (headers instanceof Headers) {
    headers.forEach((value, key) => add(key, value));
  } else if (Array.isArray(headers)) {
    for (const entry of headers as unknown[]) {
      if (Array.isArray(entry) && entry.length >= 2) {
        add(String(entry[0]), entry[1]);
      }
    }
  } else {
    for (const [key, value] of Object.entries(headers)) add(key, value);
  }

  return out;
}

/** Bodies are JSON here, but never let a log line be the thing that throws. */
function parseBody(body: unknown): unknown {
  if (typeof body !== "string") return body === undefined ? undefined : "«non-string body»";
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/** Reads a clone of a streaming body, logging each frame as it lands. */
async function logStream(
  body: ReadableStream<Uint8Array>,
  startedAt: number,
  log: Logger,
): Promise<void> {
  const decoder = new TextDecoder();

  try {
    for await (const bytes of body as unknown as AsyncIterable<Uint8Array>) {
      const text = decoder.decode(bytes, { stream: true });
      if (text) {
        log({
          direction: "wire-chunk",
          text,
          sinceStartMs: Date.now() - startedAt,
        });
      }
    }
  } catch {
    // The SDK abandoning the stream (an abort, a disconnect) tears down this
    // side of the clone too. Nothing to report — the turn already logged why.
  }
}

/**
 * Wraps `fetch` so the exact HTTP exchange with the provider can be logged:
 * method, URL, headers, and both JSON bodies verbatim.
 *
 * The response is cloned before reading, because a body can only be consumed
 * once and the SDK still needs the original. A streaming response is *not*
 * awaited — draining a clone to completion would hold every token back until
 * the last one arrived, turning the debug flag into a bug. Its frames are
 * logged in the background as they arrive instead.
 */
export function wireLoggingFetch(log: Logger): typeof globalThis.fetch {
  return async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    log({
      direction: "wire-request",
      method: init?.method?.toUpperCase() ?? "GET",
      url,
      headers: headersToObject(init?.headers),
      body: parseBody(init?.body),
    });

    const startedAt = Date.now();
    const response = await globalThis.fetch(input, init);
    const latencyMs = Date.now() - startedAt;

    const streaming =
      response.headers.get("content-type")?.includes("text/event-stream") ??
      false;
    const cloned = streaming ? response.clone() : null;

    let body: unknown = null;
    if (!streaming) {
      try {
        body = parseBody(await response.clone().text());
      } catch {
        body = "«could not read body»";
      }
    }

    log({
      direction: "wire-response",
      status: response.status,
      headers: headersToObject(response.headers),
      body,
      latencyMs,
    });

    // Deliberately not awaited: the SDK gets the response now, and the frames
    // are logged as they arrive. Both halves of the clone have to be read or
    // the unread one buffers, so this always runs to completion.
    if (cloned?.body) void logStream(cloned.body, startedAt, log);

    return response;
  };
}
