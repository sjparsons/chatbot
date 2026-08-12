import type { Message } from "./types.js";

export interface ModelRequestLog {
  direction: "request";
  model: string;
  maxTokens: number;
  messages: Message[];
}

export interface ModelResponseLog {
  direction: "response";
  model: string;
  stopReason: string | null;
  text: string;
  usage: { inputTokens: number; outputTokens: number } | null;
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
  body: unknown;
  latencyMs: number;
}

export type ModelLogEvent =
  | ModelRequestLog
  | ModelResponseLog
  | ModelErrorLog
  | ModelWireRequestLog
  | ModelWireResponseLog;

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
    console.log(
      `\n→ ${event.model}  (${count} message${count === 1 ? "" : "s"}, max_tokens ${event.maxTokens})`,
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
    console.log(indent(JSON.stringify(event.body, null, 2)));
    return;
  }

  if (event.direction === "response") {
    const usage = event.usage
      ? `  in=${event.usage.inputTokens} out=${event.usage.outputTokens}`
      : "";
    console.log(
      `← ${event.model}  stop=${event.stopReason ?? "none"}${usage}  ${event.latencyMs}ms`,
    );
    console.log(`  ${event.text}`);
    return;
  }

  console.log(
    `← ${event.model}  FAILED ${event.code}  ${event.latencyMs}ms\n  ${event.message}`,
  );
};
