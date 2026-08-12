import type { GatewayConfig } from "../config.js";
import { GatewayError } from "../errors.js";
import type { Logger } from "../logging.js";
import type { Gateway, GenerateOptions, Message } from "../types.js";

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new GatewayError("aborted", "request aborted"));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(new GatewayError("aborted", "request aborted"));
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** Splits into chunks that still join back to the original text. */
const words = (text: string): string[] => text.match(/\S+\s*/g) ?? [text];

/**
 * Stand-in for a model call — no network, no key, no cost.
 *
 * Kept so the tests stay hermetic and `npm run dev` works without credentials.
 * The reply echoes the previous turn, which is what makes "did it see turn 1
 * when answering turn 2" answerable without a real model.
 *
 * It streams word by word, so the transport and the UI get exercised without a
 * key. `mockDelayMinMs`/`Max` is the pause before the first chunk — the model
 * thinking — and `mockChunkDelayMs` the gap between chunks after that.
 */
export function createMockProvider(
  config: GatewayConfig,
  { logger }: { logger?: Logger } = {},
): Gateway {
  const span = Math.max(0, config.mockDelayMaxMs - config.mockDelayMinMs);
  const log: Logger = logger ?? (() => {});

  return {
    async *generate(
      messages: Message[],
      options: GenerateOptions = {},
    ): AsyncGenerator<string> {
      // Logged in the same shape as a real turn, so switching providers does
      // not change what the dev log looks like.
      log({
        direction: "request",
        model: "mock",
        maxTokens: config.maxTokens,
        messages,
        system: options.system ?? null,
      });

      const startedAt = Date.now();
      await sleep(config.mockDelayMinMs + Math.random() * span, options.signal);
      const firstTokenMs = Date.now() - startedAt;

      const previousUserMessage = messages
        .slice(0, -1)
        .filter((message) => message.role === "user")
        .at(-1);

      const text = previousUserMessage
        ? `RESPONSE (${messages.length} messages in context, previous: "${previousUserMessage.content}")`
        : "RESPONSE";

      const chunks = words(text);
      for (const [index, chunk] of chunks.entries()) {
        if (index > 0) await sleep(config.mockChunkDelayMs, options.signal);
        yield chunk;
      }

      log({
        direction: "response",
        model: "mock",
        stopReason: "end_turn",
        text,
        usage: null,
        firstTokenMs,
        latencyMs: Date.now() - startedAt,
      });

      // Emitted so the metadata path is exercised by every test that runs
      // against the mock. There are no real tokens to report and nothing to
      // price, which is what null means here — distinct from zero.
      options.onMetadata?.({
        model: "mock",
        stopReason: "end_turn",
        providerRequestId: null,
        usage: null,
        costUsd: null,
      });
    },
  };
}
