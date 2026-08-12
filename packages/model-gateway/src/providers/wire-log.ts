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

/**
 * Wraps `fetch` so the exact HTTP exchange with the provider can be logged:
 * method, URL, headers, and both JSON bodies verbatim.
 *
 * The response is cloned before reading, because a body can only be consumed
 * once and the SDK still needs the original. That buffers the whole response,
 * which is fine while calls are non-streaming — when real token streaming
 * lands, this has to log the SSE frames instead rather than draining a clone.
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

    let body: unknown;
    try {
      body = parseBody(await response.clone().text());
    } catch {
      body = "«could not read body»";
    }

    log({
      direction: "wire-response",
      status: response.status,
      headers: headersToObject(response.headers),
      body,
      latencyMs,
    });

    return response;
  };
}
