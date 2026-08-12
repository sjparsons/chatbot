import { APIError, APIUserAbortError } from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { loadConfig, type GatewayConfig } from "./config.js";
import { GatewayError } from "./errors.js";
import type { ModelLogEvent } from "./logging.js";
import {
  createAnthropicProvider,
  type ModelClient,
  type ModelResponse,
} from "./providers/anthropic.js";
import { createGateway } from "./index.js";
import type { Message } from "./types.js";

const messages: Message[] = [
  { role: "user", content: "do you sell blue shirts?" },
  { role: "assistant", content: "We do." },
  { role: "user", content: "in medium?" },
];

/** Config with no environment behind it, so the suite is not env-dependent. */
function testConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return loadConfig(
    {
      provider: "anthropic",
      model: "primary-model",
      fallbackModel: "fallback-model",
      maxTokens: 512,
      logPayloads: false,
      mockDelayMinMs: 0,
      mockDelayMaxMs: 0,
      ...overrides,
    },
    {},
  );
}

interface Call {
  model: string;
  maxTokens: number;
  messages: Message[];
}

type Responder = (model: string) => ModelResponse | Promise<ModelResponse>;

function fakeClient(respond: Responder): { client: ModelClient; calls: Call[] } {
  const calls: Call[] = [];

  return {
    calls,
    client: {
      messages: {
        async create(params) {
          calls.push({
            model: params.model,
            maxTokens: params.max_tokens,
            messages: params.messages,
          });
          return respond(params.model);
        },
      },
    },
  };
}

function textResponse(
  text: string,
  overrides: Partial<ModelResponse> = {},
): ModelResponse {
  return {
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 5 },
    ...overrides,
  };
}

async function drain(stream: AsyncGenerator<string>): Promise<string> {
  let text = "";
  for await (const chunk of stream) text += chunk;
  return text;
}

/** Fails the test if the generator does not throw. */
async function captureError(
  stream: AsyncGenerator<string>,
): Promise<GatewayError> {
  try {
    await drain(stream);
  } catch (error) {
    expect(error).toBeInstanceOf(GatewayError);
    return error as GatewayError;
  }

  throw new Error("expected the gateway to throw");
}

describe("anthropic provider", () => {
  it("returns the model's text and sends the assembled context through", async () => {
    const { client, calls } = fakeClient(() => textResponse("Yes, in medium."));
    const gateway = createAnthropicProvider(testConfig(), { client });

    expect(await drain(gateway.generate(messages))).toBe("Yes, in medium.");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe("primary-model");
    expect(calls[0]?.maxTokens).toBe(512);
    // The context array is passed through untranslated — that is the whole
    // reason context.ts builds it in the provider's shape.
    expect(calls[0]?.messages).toEqual(messages);
  });

  it("concatenates multiple text blocks and ignores non-text ones", async () => {
    const { client } = fakeClient(() =>
      textResponse("", {
        content: [
          { type: "thinking" },
          { type: "text", text: "Yes, " },
          { type: "text", text: "in medium." },
        ],
      }),
    );
    const gateway = createAnthropicProvider(testConfig(), { client });

    expect(await drain(gateway.generate(messages))).toBe("Yes, in medium.");
  });

  it("maps a refusal, which arrives as a successful empty response", async () => {
    const { client, calls } = fakeClient(() =>
      textResponse("", { content: [], stop_reason: "refusal" }),
    );
    const gateway = createAnthropicProvider(testConfig(), { client });

    const error = await captureError(gateway.generate(messages));

    expect(error.code).toBe("refusal");
    expect(error.retryable).toBe(false);
    // A refusal is a decision, not a fault — the fallback must not be tried.
    expect(calls).toHaveLength(1);
  });

  it("errors rather than yielding nothing when the response has no text", async () => {
    const { client } = fakeClient(() =>
      textResponse("", { content: [], stop_reason: "end_turn" }),
    );
    const gateway = createAnthropicProvider(
      testConfig({ fallbackModel: null }),
      { client },
    );

    const error = await captureError(gateway.generate(messages));
    expect(error.code).toBe("upstream");
  });

  it("falls back to the second model on a retryable failure", async () => {
    const { client, calls } = fakeClient((model) => {
      if (model === "primary-model") {
        throw APIError.generate(529, undefined, "Overloaded", new Headers());
      }
      return textResponse("Yes, in medium.");
    });
    const gateway = createAnthropicProvider(testConfig(), { client });

    expect(await drain(gateway.generate(messages))).toBe("Yes, in medium.");
    expect(calls.map((call) => call.model)).toEqual([
      "primary-model",
      "fallback-model",
    ]);
  });

  it("does not fall back on a credentials failure", async () => {
    const { client, calls } = fakeClient(() => {
      throw APIError.generate(401, undefined, "bad key", new Headers());
    });
    const gateway = createAnthropicProvider(testConfig(), { client });

    const error = await captureError(gateway.generate(messages));

    expect(error.code).toBe("auth");
    expect(error.retryable).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("reports both models when the fallback fails too", async () => {
    const { client } = fakeClient(() => {
      throw APIError.generate(529, undefined, "Overloaded", new Headers());
    });
    const gateway = createAnthropicProvider(testConfig(), { client });

    const error = await captureError(gateway.generate(messages));

    expect(error.message).toContain("primary-model");
    expect(error.message).toContain("fallback-model");
  });

  it("skips the fallback when it is disabled", async () => {
    const { client, calls } = fakeClient(() => {
      throw APIError.generate(529, undefined, "Overloaded", new Headers());
    });
    const gateway = createAnthropicProvider(
      testConfig({ fallbackModel: null }),
      { client },
    );

    expect((await captureError(gateway.generate(messages))).code).toBe(
      "overloaded",
    );
    expect(calls).toHaveLength(1);
  });

  it("maps an abort so a disconnect does not look like a provider fault", async () => {
    const { client } = fakeClient(() => {
      throw new APIUserAbortError();
    });
    const gateway = createAnthropicProvider(testConfig(), { client });

    const error = await captureError(gateway.generate(messages));

    expect(error.code).toBe("aborted");
    expect(error.retryable).toBe(false);
  });

  it("refuses to start without credentials, rather than failing mid-turn", () => {
    // The SDK gets as far as building request headers before it notices, which
    // would surface as a failed turn instead of a failed boot.
    expect(() => createAnthropicProvider(testConfig())).toThrow(
      /no credentials/,
    );
  });

  it("logs the message array sent and the text returned", async () => {
    const events: ModelLogEvent[] = [];
    const { client } = fakeClient(() => textResponse("Yes, in medium."));
    const gateway = createAnthropicProvider(testConfig(), {
      client,
      logger: (event) => events.push(event),
    });

    await drain(gateway.generate(messages));

    const request = events.find((event) => event.direction === "request");
    const response = events.find((event) => event.direction === "response");

    expect(request).toMatchObject({ model: "primary-model", messages });
    expect(response).toMatchObject({
      model: "primary-model",
      text: "Yes, in medium.",
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    });
  });
});

describe("createGateway", () => {
  it("uses the mock provider when configured, and echoes the previous turn", async () => {
    const gateway = createGateway({
      config: {
        provider: "mock",
        logPayloads: false,
        mockDelayMinMs: 0,
        mockDelayMaxMs: 0,
      },
    });

    const text = await drain(gateway.generate(messages));

    expect(text).toContain("3 messages in context");
    expect(text).toContain("do you sell blue shirts?");
  });
});
