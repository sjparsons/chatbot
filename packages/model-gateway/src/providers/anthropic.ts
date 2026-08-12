import Anthropic from "@anthropic-ai/sdk";
import type { GatewayConfig } from "../config.js";
import { GatewayError, mapProviderError } from "../errors.js";
import type { Logger } from "../logging.js";
import { estimateCostUsd } from "../pricing.js";
import type {
  Gateway,
  GenerateOptions,
  Message,
  TokenUsage,
} from "../types.js";
import { wireLoggingFetch } from "./wire-log.js";

/**
 * Usage as it arrives on the wire. Every field is optional because it is split
 * across two events: `message_start` carries the input and cache counts,
 * `message_delta` the output count.
 */
interface StreamUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/**
 * The slice of a streaming event the gateway reads. Narrow on purpose: the
 * SDK's `RawMessageStreamEvent` union satisfies it structurally, and a test
 * double can be a plain object rather than a mocked module.
 *
 * What matters, and where it arrives: `message_start` carries the model id and
 * the input and cache token counts, `content_block_delta` the text,
 * `message_delta` the stop reason and the output token count.
 */
export interface ModelStreamEvent {
  type: string;
  delta?: { type?: string; text?: string; stop_reason?: string | null };
  message?: {
    /**
     * Dated (`claude-haiku-4-5-20251001`) even though the request sent an
     * alias. This is the id worth logging.
     */
    model?: string;
    usage?: StreamUsage;
  };
  usage?: StreamUsage;
}

/**
 * A stream, plus the one thing about the call that is not in the events.
 *
 * `request_id` comes from a response header, so no SSE frame carries it — the
 * SDK hangs it off the stream object instead. Optional, so a test double stays
 * a plain async iterable.
 */
export type ModelStream = AsyncIterable<ModelStreamEvent> & {
  request_id?: string | null;
};

export interface ModelClient {
  messages: {
    stream(
      params: {
        model: string;
        max_tokens: number;
        messages: Message[];
        /** Top-level on this API, not a message with `role: "system"`. */
        system?: string;
      },
      options?: { signal?: AbortSignal },
    ): ModelStream;
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
  // The SDK does NOT throw for a missing credential at construction — it gets
  // as far as building headers on the first request and fails there, which
  // turns a config mistake into a runtime error a customer sees. Refuse to
  // start instead. It reads only these two variables: no config file, no
  // profile, no ambient credential.
  if (!client && !config.apiKey && !config.authToken) {
    throw new Error(
      "model-gateway: no credentials. Set ANTHROPIC_API_KEY, or MODEL_PROVIDER=mock to run without a model.",
    );
  }

  const log: Logger = logger ?? (() => {});

  const model: ModelClient =
    client ??
    new Anthropic({
      apiKey: config.apiKey,
      authToken: config.authToken,
      timeout: config.timeoutMs,
      maxRetries: config.maxRetries,
      // Swapping fetch is how the raw exchange gets logged; leaving it unset
      // keeps the SDK's own default.
      ...(config.logWire ? { fetch: wireLoggingFetch(log) } : {}),
    });

  /**
   * One streamed call to one model, yielding text as it arrives.
   *
   * The completion checks — refusal, no text — can only run once the stream
   * ends, because `stop_reason` arrives in the final `message_delta`. That is
   * sound rather than merely convenient: both conditions imply an empty reply,
   * so nothing has been yielded by the time they throw.
   */
  async function* streamModel(
    modelId: string,
    messages: Message[],
    { signal, system, onMetadata }: GenerateOptions,
  ): AsyncGenerator<string> {
    log({
      direction: "request",
      model: modelId,
      maxTokens: config.maxTokens,
      messages,
      system: system ?? null,
    });

    const startedAt = Date.now();

    let text = "";
    let firstTokenMs: number | null = null;
    let stopReason: string | null = null;
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    let cacheCreationTokens: number | null = null;
    let cacheReadTokens: number | null = null;
    // The alias we asked for, until `message_start` names the dated id.
    let resolvedModel = modelId;
    let requestId: string | null = null;

    try {
      const stream = model.messages.stream(
        {
          model: modelId,
          max_tokens: config.maxTokens,
          messages,
          // Omitted rather than sent empty when there is no prompt: the API
          // treats "" as a system prompt, and an empty one is not nothing.
          ...(system ? { system: system.text } : {}),
        },
        { signal },
      );

      for await (const event of stream) {
        if (event.type === "message_start") {
          // Everything about the call that is fixed before generation starts:
          // which model actually ran, and what the prompt cost to read.
          resolvedModel = event.message?.model ?? resolvedModel;
          inputTokens = event.message?.usage?.input_tokens ?? inputTokens;
          cacheCreationTokens =
            event.message?.usage?.cache_creation_input_tokens ??
            cacheCreationTokens;
          cacheReadTokens =
            event.message?.usage?.cache_read_input_tokens ?? cacheReadTokens;
          continue;
        }

        if (event.type === "message_delta") {
          stopReason = event.delta?.stop_reason ?? stopReason;
          inputTokens = event.usage?.input_tokens ?? inputTokens;
          outputTokens = event.usage?.output_tokens ?? outputTokens;
          cacheCreationTokens =
            event.usage?.cache_creation_input_tokens ?? cacheCreationTokens;
          cacheReadTokens =
            event.usage?.cache_read_input_tokens ?? cacheReadTokens;
          continue;
        }

        // Only `text_delta` is prose. `thinking_delta` and `input_json_delta`
        // ride the same event and must not be concatenated into the reply.
        if (event.type !== "content_block_delta") continue;
        if (event.delta?.type !== "text_delta") continue;

        const chunk = event.delta.text ?? "";
        if (!chunk) continue;

        firstTokenMs ??= Date.now() - startedAt;
        text += chunk;
        yield chunk;
      }

      // Not in any SSE frame — it is a response header, which the SDK hangs
      // off the stream. Read once the stream is done, by which point the
      // headers are long since in.
      requestId = stream.request_id ?? null;
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

    log({
      direction: "response",
      model: modelId,
      stopReason,
      text,
      usage:
        inputTokens === null && outputTokens === null
          ? null
          : { inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 },
      firstTokenMs,
      latencyMs: Date.now() - startedAt,
    });

    // Emitted here — after the stream has ended, before the refusal and
    // empty-text checks below throw. A refused turn is a billed turn, and the
    // point of the columns downstream is that it can still be accounted for.
    const usage: TokenUsage | null =
      inputTokens === null && outputTokens === null
        ? null
        : {
            inputTokens: inputTokens ?? 0,
            outputTokens: outputTokens ?? 0,
            // Absent on a stream that never touched a cache, which is zero
            // tokens rather than unknown.
            cacheCreationInputTokens: cacheCreationTokens ?? 0,
            cacheReadInputTokens: cacheReadTokens ?? 0,
          };

    onMetadata?.({
      model: resolvedModel,
      stopReason,
      providerRequestId: requestId,
      usage,
      costUsd: estimateCostUsd(resolvedModel, usage),
    });

    // A refusal is a *successful* response carrying no text, not a thrown
    // error — and it is a decision rather than a fault, which is why it is not
    // retryable.
    if (stopReason === "refusal") {
      throw new GatewayError("refusal", "the model declined to answer", {
        model: modelId,
      });
    }

    if (!text) {
      throw new GatewayError(
        "upstream",
        `model returned no text (stop_reason: ${stopReason ?? "none"})`,
        { model: modelId },
      );
    }
  }

  return {
    async *generate(
      messages: Message[],
      options: GenerateOptions = {},
    ): AsyncGenerator<string> {
      let emitted = false;

      try {
        for await (const chunk of streamModel(config.model, messages, options)) {
          emitted = true;
          yield chunk;
        }
        return;
      } catch (error) {
        const failure = mapProviderError(error, config.model);
        const fallback = config.fallbackModel;

        // Streaming narrows when the fallback can fire: once a chunk is out the
        // door the reader is already showing it, and a second model would
        // restart the reply mid-sentence rather than continue it.
        if (
          emitted ||
          !failure.retryable ||
          !fallback ||
          fallback === config.model
        ) {
          throw failure;
        }

        // The SDK has already exhausted its own backoff against the primary
        // model, so this is the last thing standing between a provider blip
        // and a failed turn.
        try {
          yield* streamModel(fallback, messages, options);
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
    },
  };
}
