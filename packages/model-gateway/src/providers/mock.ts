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

/**
 * Stand-in for a model call — no network, no key, no cost.
 *
 * Kept so the tests stay hermetic and `npm run dev` works without credentials.
 * The reply echoes the previous turn, which is what makes "did it see turn 1
 * when answering turn 2" answerable without a real model.
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
      });

      const startedAt = Date.now();
      await sleep(config.mockDelayMinMs + Math.random() * span, options.signal);

      const previousUserMessage = messages
        .slice(0, -1)
        .filter((message) => message.role === "user")
        .at(-1);

      const text = previousUserMessage
        ? `RESPONSE (${messages.length} messages in context, previous: "${previousUserMessage.content}")`
        : "RESPONSE";

      log({
        direction: "response",
        model: "mock",
        stopReason: "end_turn",
        text,
        usage: null,
        latencyMs: Date.now() - startedAt,
      });

      yield text;
    },
  };
}
