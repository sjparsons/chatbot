import Anthropic from "@anthropic-ai/sdk";
import type { GatewayConfig } from "../config.js";
import { GatewayError, mapProviderError } from "../errors.js";
import type { Logger } from "../logging.js";
import type { Gateway, GenerateOptions, Message } from "../types.js";

/**
 * The slice of the provider response the gateway reads. Narrow on purpose: the
 * real SDK `Message` satisfies it structurally, and a test double can be a
 * plain object rather than a mocked module.
 */
export interface ModelResponse {
  content: Array<{ type: string; text?: string }>;
  stop_reason: string | null;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface ModelClient {
  messages: {
    create(
      params: { model: string; max_tokens: number; messages: Message[] },
      options?: { signal?: AbortSignal },
    ): Promise<ModelResponse>;
  };
}

export interface AnthropicProviderOptions {
  client?: ModelClient;
  logger?: Logger;
}

export function createAnthropicProvider(
  config: GatewayConfig,
  { client, logger }: AnthropicProviderOptions = {},
): Gateway {
  // Constructing the real client throws when no key is resolvable, which is a
  // better failure than every turn dying with a 401 at request time.
  const model: ModelClient =
    client ??
    new Anthropic({
      apiKey: config.apiKey,
      timeout: config.timeoutMs,
      maxRetries: config.maxRetries,
    });

  const log: Logger = logger ?? (() => {});

  async function complete(
    modelId: string,
    messages: Message[],
    signal: AbortSignal | undefined,
  ): Promise<string> {
    log({
      direction: "request",
      model: modelId,
      maxTokens: config.maxTokens,
      messages,
    });

    const startedAt = Date.now();

    let response: ModelResponse;
    try {
      response = await model.messages.create(
        { model: modelId, max_tokens: config.maxTokens, messages },
        { signal },
      );
    } catch (error) {
      const mapped = mapProviderError(error, modelId);
      log({
        direction: "error",
        model: modelId,
        code: mapped.code,
        message: mapped.message,
        latencyMs: Date.now() - startedAt,
      });
      throw mapped;
    }

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");

    log({
      direction: "response",
      model: modelId,
      stopReason: response.stop_reason,
      text,
      usage: response.usage
        ? {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          }
        : null,
      latencyMs: Date.now() - startedAt,
    });

    // A refusal is a *successful* HTTP response carrying no text, not a thrown
    // error — so it has to be checked before reading content, and it is a
    // decision rather than a fault, which is why it is not retryable.
    if (response.stop_reason === "refusal") {
      throw new GatewayError("refusal", "the model declined to answer", {
        model: modelId,
      });
    }

    if (!text) {
      throw new GatewayError(
        "upstream",
        `model returned no text (stop_reason: ${response.stop_reason ?? "none"})`,
        { model: modelId },
      );
    }

    return text;
  }

  return {
    async *generate(
      messages: Message[],
      options: GenerateOptions = {},
    ): AsyncGenerator<string> {
      let text: string;

      try {
        text = await complete(config.model, messages, options.signal);
      } catch (error) {
        const failure = mapProviderError(error, config.model);
        const fallback = config.fallbackModel;

        if (!failure.retryable || !fallback || fallback === config.model) {
          throw failure;
        }

        // The SDK has already exhausted its own backoff against the primary
        // model, so this is the last thing standing between a provider blip
        // and a failed turn.
        try {
          text = await complete(fallback, messages, options.signal);
        } catch (fallbackError) {
          const mapped = mapProviderError(fallbackError, fallback);
          throw new GatewayError(
            mapped.code,
            `${config.model} failed (${failure.code}); fallback ${fallback} failed: ${mapped.message}`,
            {
              retryable: mapped.retryable,
              status: mapped.status,
              model: fallback,
              cause: fallbackError,
            },
          );
        }
      }

      yield text;
    },
  };
}
