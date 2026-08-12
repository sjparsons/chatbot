import { APIError, APIUserAbortError } from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig, type GatewayConfig } from "./config.js";
import { GatewayError } from "./errors.js";
import type { ModelLogEvent } from "./logging.js";
import {
  createAnthropicProvider,
  type ModelClient,
  type ModelStreamEvent,
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

/** An array for a clean turn; a generator to fail partway through one. */
type Responder = (model: string) => Iterable<ModelStreamEvent>;

/**
 * A client whose `stream` yields the responder's events one at a time. The
 * responder runs *inside* the generator so a thrown error surfaces while
 * iterating, which is where the SDK surfaces its own.
 */
function fakeClient(respond: Responder): { client: ModelClient; calls: Call[] } {
  const calls: Call[] = [];

  return {
    calls,
    client: {
      messages: {
        stream(params) {
          calls.push({
            model: params.model,
            maxTokens: params.max_tokens,
            messages: params.messages,
            system: params.system,
          });

          return (async function* () {
            yield* respond(params.model);
          })();
        },
      },
    },
  };
}

/** The event sequence a real streamed turn produces, one delta per chunk. */
function textStream(
  chunks: string[],
  { stopReason = "end_turn" }: { stopReason?: string | null } = {},
): ModelStreamEvent[] {
  return [
    { type: "message_start", message: { usage: { input_tokens: 10 } } },
    { type: "content_block_start" },
    ...chunks.map((text) => ({
      type: "content_block_delta",
      delta: { type: "text_delta", text },
    })),
    { type: "content_block_stop" },
    {
      type: "message_delta",
      delta: { stop_reason: stopReason },
      usage: { output_tokens: 5 },
    },
    { type: "message_stop" },
  ];
}

async function collect(stream: AsyncGenerator<string>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

async function drain(stream: AsyncGenerator<string>): Promise<string> {
  return (await collect(stream)).join("");
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
    const { client, calls } = fakeClient(() =>
      textStream(["Yes, in medium."]),
    );
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
    const { client, calls } = fakeClient(() => textStream(["Yes, in medium."]));
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
    const { client, calls } = fakeClient(() => textStream(["Yes."]));
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
      return textStream(["Yes."]);
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

  it("yields one chunk per text delta rather than the assembled reply", async () => {
    const { client } = fakeClient(() =>
      textStream(["Yes, ", "in ", "medium."]),
    );
    const gateway = createAnthropicProvider(testConfig(), { client });

    expect(await collect(gateway.generate(messages))).toEqual([
      "Yes, ",
      "in ",
      "medium.",
    ]);
  });

  it("ignores deltas that are not prose", async () => {
    const { client } = fakeClient(() => [
      { type: "message_start", message: { usage: { input_tokens: 10 } } },
      // Thinking and tool-input deltas ride the same event as text and would
      // otherwise be concatenated straight into the reply.
      { type: "content_block_delta", delta: { type: "thinking_delta" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "Yes" } },
      {
        type: "content_block_delta",
        delta: { type: "input_json_delta" },
      },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
    ]);
    const gateway = createAnthropicProvider(testConfig(), { client });

    expect(await drain(gateway.generate(messages))).toBe("Yes");
  });

  it("maps a refusal, which arrives as a successful empty stream", async () => {
    const { client, calls } = fakeClient(() =>
      textStream([], { stopReason: "refusal" }),
    );
    const gateway = createAnthropicProvider(testConfig(), { client });

    const error = await captureError(gateway.generate(messages));

    expect(error.code).toBe("refusal");
    expect(error.retryable).toBe(false);
    // A refusal is a decision, not a fault — the fallback must not be tried.
    expect(calls).toHaveLength(1);
  });

  it("errors rather than yielding nothing when the response has no text", async () => {
    const { client } = fakeClient(() => textStream([]));
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
      return textStream(["Yes, in medium."]);
    });
    const gateway = createAnthropicProvider(testConfig(), { client });

    expect(await drain(gateway.generate(messages))).toBe("Yes, in medium.");
    expect(calls.map((call) => call.model)).toEqual([
      "primary-model",
      "fallback-model",
    ]);
  });

  it("does not fall back once the reply has started streaming", async () => {
    // Streaming narrows the window: a second model cannot continue a sentence
    // the reader is already looking at, so a mid-stream failure is final.
    const { client, calls } = fakeClient(function* (model) {
      if (model !== "primary-model") {
        yield* textStream(["should never be reached"]);
        return;
      }
      yield {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Yes, " },
      };
      throw APIError.generate(529, undefined, "Overloaded", new Headers());
    });
    const gateway = createAnthropicProvider(testConfig(), { client });

    const delivered: string[] = [];
    const stream = gateway.generate(messages);

    await expect(
      (async () => {
        for await (const chunk of stream) delivered.push(chunk);
      })(),
    ).rejects.toMatchObject({ code: "overloaded" });

    expect(delivered).toEqual(["Yes, "]);
    expect(calls.map((call) => call.model)).toEqual(["primary-model"]);
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

  it("logs the message array sent and the reassembled text returned", async () => {
    const events: ModelLogEvent[] = [];
    const { client } = fakeClient(() => textStream(["Yes, ", "in medium."]));
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
      // The log still records the whole reply, not the chunking — that is what
      // makes it comparable with a non-streamed turn.
      text: "Yes, in medium.",
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
      // The number streaming exists to move: how long until anything showed up.
      firstTokenMs: expect.any(Number),
    });
  });

  it("logs no time-to-first-token when the reply carried no text", async () => {
    const events: ModelLogEvent[] = [];
    const { client } = fakeClient(() =>
      textStream([], { stopReason: "refusal" }),
    );
    const gateway = createAnthropicProvider(testConfig(), {
      client,
      logger: (event) => events.push(event),
    });

    await captureError(gateway.generate(messages));

    expect(
      events.find((event) => event.direction === "response"),
    ).toMatchObject({ firstTokenMs: null });
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

  it("logs a streaming body as frames without holding the response back", async () => {
    const events: ModelLogEvent[] = [];
    const encoder = new TextEncoder();

    // A body that never closes: draining it before returning — what the
    // non-streaming path does — would hang this test rather than fail it,
    // which is exactly the failure mode this guards.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('event: content_block_delta\ndata: {"x":1}\n\n'),
        );
      },
    });

    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(body, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );

    const response = await wireLoggingFetch((event) => events.push(event))(
      "https://api.anthropic.com/v1/messages",
      { method: "POST" },
    );

    // The body of a stream is logged frame by frame, not as one blob.
    expect(
      events.find((event) => event.direction === "wire-response")?.body,
    ).toBeNull();

    await vi.waitFor(() => {
      const chunk = events.find((event) => event.direction === "wire-chunk");
      expect(chunk?.text).toContain("content_block_delta");
    });

    // And the SDK's own copy is untouched by the logging.
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain(
      "content_block_delta",
    );
    // Not awaited: cancelling one half of a clone of a body that never closes
    // does not settle, and the stream is in memory — there is nothing to free.
    void reader.cancel();
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
  const mockGateway = () =>
    createGateway({
      config: {
        provider: "mock",
        logPayloads: false,
        mockDelayMinMs: 0,
        mockDelayMaxMs: 0,
        mockChunkDelayMs: 0,
      },
    });

  it("uses the mock provider when configured, and echoes the previous turn", async () => {
    const chunks = await collect(mockGateway().generate(messages));
    const text = chunks.join("");

    expect(text).toContain("3 messages in context");
    expect(text).toContain("do you sell blue shirts?");
  });

  it("streams the mock reply in pieces, so the transport is exercised keyless", async () => {
    const chunks = await collect(mockGateway().generate(messages));

    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk has to be appendable as-is: the client concatenates them and
    // nothing re-inserts the whitespace between words.
    expect(chunks.join("")).toContain("messages in context");
  });
});
