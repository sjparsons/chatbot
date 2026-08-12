import type { Message, SystemPrompt } from "./types.js";

export interface ModelRequestLog {
  direction: "request";
  model: string;
  maxTokens: number;
  messages: Message[];
  /** The prompt artifact this turn was sent with; null if none was. */
  system: SystemPrompt | null;
}

export interface ModelResponseLog {
  direction: "response";
  model: string;
  stopReason: string | null;
  text: string;
  usage: { inputTokens: number; outputTokens: number } | null;
  /** Time to the first text chunk. `null` if the reply carried no text. */
  firstTokenMs: number | null;
  latencyMs: number;
}

export interface ModelErrorLog {
  direction: "error";
  model: string;
  code: string;
  message: string;
  latencyMs: number;
}

export interface ModelWireRequestLog {
  direction: "wire-request";
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface ModelWireResponseLog {
  direction: "wire-response";
  status: number;
  headers: Record<string, string>;
  /** `null` for a streaming response, whose frames arrive as `wire-chunk`s. */
  body: unknown;
  latencyMs: number;
}

/** One raw read off a streaming response body — usually a whole SSE frame. */
export interface ModelWireChunkLog {
  direction: "wire-chunk";
  text: string;
  sinceStartMs: number;
}

export type ModelLogEvent =
  | ModelRequestLog
  | ModelResponseLog
  | ModelErrorLog
  | ModelWireRequestLog
  | ModelWireResponseLog
  | ModelWireChunkLog;

export type Logger = (event: ModelLogEvent) => void;

export const silentLogger: Logger = () => {};

const indent = (text: string): string =>
  text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");

/**
 * Prints the exact message array handed to the provider and the text that came
 * back. Nothing is truncated — the context window is capped at a handful of
 * turns, and a half-printed prompt is not much use when you are trying to work
 * out what the model actually saw.
 */
export const consoleLogger: Logger = (event) => {
  if (event.direction === "request") {
    const count = event.messages.length;
    // The system prompt is printed as its version, not its text: it is the same
    // every turn, it is long, and the version is exactly the handle for looking
    // it up in git. The transcript below still prints in full — that part is
    // different every turn and nowhere else to be seen.
    const system = event.system
      ? `system ${event.system.version} (${event.system.text.length} chars)`
      : "no system prompt";
    console.log(
      `\n→ ${event.model}  (${count} message${count === 1 ? "" : "s"}, max_tokens ${event.maxTokens}, ${system})`,
    );
    for (const message of event.messages) {
      console.log(`  [${message.role}] ${message.content}`);
    }
    return;
  }

  if (event.direction === "wire-request") {
    console.log(`\n⇢ ${event.method} ${event.url}`);
    console.log(indent(JSON.stringify(event.headers, null, 2)));
    console.log(indent(JSON.stringify(event.body, null, 2)));
    return;
  }

  if (event.direction === "wire-response") {
    console.log(`⇠ ${event.status}  ${event.latencyMs}ms`);
    console.log(indent(JSON.stringify(event.headers, null, 2)));
    if (event.body !== null) {
      console.log(indent(JSON.stringify(event.body, null, 2)));
    }
    return;
  }

  if (event.direction === "wire-chunk") {
    console.log(indent(`+${event.sinceStartMs}ms ${event.text.trimEnd()}`));
    return;
  }

  if (event.direction === "response") {
    const usage = event.usage
      ? `  in=${event.usage.inputTokens} out=${event.usage.outputTokens}`
      : "";
    const ttft =
      event.firstTokenMs === null ? "" : `  ttft=${event.firstTokenMs}ms`;
    console.log(
      `← ${event.model}  stop=${event.stopReason ?? "none"}${usage}${ttft}  ${event.latencyMs}ms`,
    );
    console.log(`  ${event.text}`);
    return;
  }

  console.log(
    `← ${event.model}  FAILED ${event.code}  ${event.latencyMs}ms\n  ${event.message}`,
  );
};
