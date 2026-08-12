import { APIError, APIUserAbortError } from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig, type GatewayConfig } from "./config.js";
import { GatewayError } from "./errors.js";
import type { ModelLogEvent } from "./logging.js";
import {
  createAnthropicProvider,
  type ModelClient,
  type ModelResponse,
} from "./providers/anthropic.js";
import { wireLoggingFetch } from "./providers/wire-log.js";
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
  system: string | undefined;
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
            system: params.system,
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

  it("sends the system prompt as a top-level parameter", async () => {
    const { client, calls } = fakeClient(() => textResponse("Yes, in medium."));
    const gateway = createAnthropicProvider(testConfig(), { client });

    await drain(
      gateway.generate(messages, {
        system: { version: "abc123", text: "you are a shop assistant" },
      }),
    );

    expect(calls[0]?.system).toBe("you are a shop assistant");
    // It is not smuggled in as a message — this API has no "system" role.
    expect(calls[0]?.messages).toEqual(messages);
  });

  it("omits the system parameter rather than sending an empty one", async () => {
    const { client, calls } = fakeClient(() => textResponse("Yes."));
    const gateway = createAnthropicProvider(testConfig(), { client });

    await drain(gateway.generate(messages));

    expect(calls[0]).not.toHaveProperty("system", "");
    expect(calls[0]?.system).toBeUndefined();
  });

  it("sends the same prompt to the fallback model", async () => {
    const { client, calls } = fakeClient((model) => {
      if (model === "primary-model") {
        throw APIError.generate(529, undefined, "Overloaded", new Headers());
      }
      return textResponse("Yes.");
    });
    const gateway = createAnthropicProvider(testConfig(), { client });

    await drain(
      gateway.generate(messages, {
        system: { version: "abc123", text: "you are a shop assistant" },
      }),
    );

    // A fallback that answers under different instructions is a silent
    // behaviour change, and the log would attribute it to the same version.
    expect(calls.map((call) => call.system)).toEqual([
      "you are a shop assistant",
      "you are a shop assistant",
    ]);
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

    const system = { version: "abc123", text: "you are a shop assistant" };
    await drain(gateway.generate(messages, { system }));

    const request = events.find((event) => event.direction === "request");
    const response = events.find((event) => event.direction === "response");

    // The prompt version is logged with the turn: what identifies which
    // instructions produced this reply, without reprinting them every turn.
    expect(request).toMatchObject({ model: "primary-model", messages, system });
    expect(response).toMatchObject({
      model: "primary-model",
      text: "Yes, in medium.",
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    });
  });
});

describe("wire logging", () => {
  const respond = () =>
    new Response(JSON.stringify({ id: "msg_1", stop_reason: "end_turn" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  afterEach(() => vi.unstubAllGlobals());

  it("never lets the credential reach the log", async () => {
    const events: ModelLogEvent[] = [];
    vi.stubGlobal("fetch", async () => respond());

    await wireLoggingFetch((event) => events.push(event))(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": "sk-ant-SUPER-SECRET",
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: "claude-haiku-4-5" }),
      },
    );

    // The blunt assertion is the one that matters: the secret appears nowhere.
    expect(JSON.stringify(events)).not.toContain("sk-ant-SUPER-SECRET");

    const request = events.find((event) => event.direction === "wire-request");
    expect(request?.headers["x-api-key"]).toBe("«redacted»");
    expect(request?.body).toEqual({ model: "claude-haiku-4-5" });

    const response = events.find(
      (event) => event.direction === "wire-response",
    );
    expect(response?.status).toBe(200);
    expect(response?.body).toEqual({ id: "msg_1", stop_reason: "end_turn" });
  });

  it("leaves the body readable, since the SDK still has to parse it", async () => {
    vi.stubGlobal("fetch", async () => respond());

    const result = await wireLoggingFetch(() => {})(
      "https://api.anthropic.com/v1/messages",
      { method: "POST" },
    );

    await expect(result.json()).resolves.toEqual({
      id: "msg_1",
      stop_reason: "end_turn",
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
