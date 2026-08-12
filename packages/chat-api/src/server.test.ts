import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  createGateway,
  GatewayError,
  type Gateway,
  type GenerateOptions,
  type SystemPrompt,
} from "@chatbot/model-gateway";
import { openDatabase, type Db } from "./db/index.js";
import { Repository } from "./db/repository.js";
import { createApp } from "./server.js";

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

/** Reads an SSE response to completion and returns the parsed events. */
async function readSse(response: Response): Promise<SseEvent[]> {
  const body = response.body;
  if (!body) throw new Error("no response body");

  const text = await new Response(body).text();

  return text
    .split("\n\n")
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const lines = block.split("\n");
      const event = lines
        .find((line) => line.startsWith("event: "))
        ?.slice("event: ".length);
      const data = lines
        .find((line) => line.startsWith("data: "))
        ?.slice("data: ".length);

      if (!event || !data) throw new Error(`malformed SSE block: ${block}`);
      return { event, data: JSON.parse(data) as Record<string, unknown> };
    });
}

/** The reply as the client assembles it — deltas arrive in unknown pieces. */
function replyText(events: SseEvent[]): string {
  return events
    .filter((event) => event.event === "delta")
    .map((event) => String(event.data.text))
    .join("");
}

describe("chat-api", () => {
  let db: Db;
  let repository: Repository;
  let server: Server;
  let baseUrl: string;

  // Mock provider: no key, no network, and the reply echoes the context it was
  // handed. The app captures `gateway` at construction, so tests that need a
  // failing model swap `provider` rather than the reference the app holds.
  const mockProvider = () => createGateway({ config: { provider: "mock" } });
  let provider: Gateway = mockProvider();
  let lastOptions: GenerateOptions | undefined;
  const gateway: Gateway = {
    generate: (messages, options) => {
      lastOptions = options;
      return provider.generate(messages, options);
    },
  };

  // Not the real artifact: the assertions below would then turn on the prompt's
  // contents, and every edit to it would fail a transport test.
  const systemPrompt: SystemPrompt = {
    version: "testversion",
    text: "you are a test fixture",
  };

  beforeEach(async () => {
    db = openDatabase(":memory:");
    repository = new Repository(db);
    const app = createApp({
      repository,
      corsOrigins: ["*"],
      gateway,
      systemPrompt,
      modelId: "test-model",
    });

    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });

    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    provider = mockProvider();
    lastOptions = undefined;
  });

  function postChat(body: unknown): Promise<Response> {
    return fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
    });
  }

  // The eval harness stamps its results from this, so the prompt version and
  // model have to be what this process is actually running, not what the
  // caller's own environment says.
  it("reports health, naming the prompt and model it is running", async () => {
    const response = await fetch(`${baseUrl}/health`);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      prompt: "testversion",
      model: "test-model",
    });
  });

  it("rejects an empty message", async () => {
    const response = await postChat({ content: "   " });
    expect(response.status).toBe(400);
  });

  it("streams start, delta and done events", async () => {
    const response = await postChat({ content: "hello" });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const events = await readSse(response);

    expect(events[0]?.event).toBe("start");
    expect(events[0]?.data.sessionId).toEqual(expect.any(String));
    expect(events.slice(1, -1).map((e) => e.event)).toContain("delta");
    expect(replyText(events)).toBe("RESPONSE");
    expect(events.at(-1)?.event).toBe("done");
    expect(events.at(-1)?.data.latencyMs).toEqual(expect.any(Number));
  });

  it("forwards each chunk as its own delta event", async () => {
    // The provider streams; so does the transport. One delta per chunk is what
    // makes text appear progressively rather than all at once at the end.
    const events = await readSse(await postChat({ content: "one" }));
    const sessionId = events[0]?.data.sessionId as string;

    const second = await readSse(await postChat({ content: "two", sessionId }));

    expect(
      second.filter((event) => event.event === "delta").length,
    ).toBeGreaterThan(1);
  });

  it("sends the system prompt it was constructed with", async () => {
    await readSse(await postChat({ content: "hello" }));

    expect(lastOptions?.system).toEqual(systemPrompt);
  });

  it("records the turn in the database", async () => {
    const events = await readSse(await postChat({ content: "hello" }));
    const sessionId = events[0]?.data.sessionId as string;

    const turns = repository.listTurns(sessionId);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.request.content).toBe("hello");
    expect(turns[0]?.response?.content).toBe("RESPONSE");
    expect(turns[0]?.response?.status).toBe("ok");
  });

  it("appends to an existing session when given its id", async () => {
    const first = await readSse(await postChat({ content: "one" }));
    const sessionId = first[0]?.data.sessionId as string;

    const second = await readSse(await postChat({ content: "two", sessionId }));

    expect(second[0]?.data.sessionId).toBe(sessionId);
    expect(repository.listTurns(sessionId)).toHaveLength(2);
  });

  it("answers the second turn with the first turn in context", async () => {
    const first = await readSse(await postChat({ content: "one" }));
    const sessionId = first[0]?.data.sessionId as string;

    expect(replyText(first)).toBe("RESPONSE");

    const second = await readSse(await postChat({ content: "two", sessionId }));

    // The mock echoes what it was given, so this is the model demonstrably
    // seeing turn 1 while answering turn 2.
    expect(replyText(second)).toBe(
      'RESPONSE (3 messages in context, previous: "one")',
    );
  });

  it("windows the transcript to the most recent turns", () => {
    const session = repository.createSession();

    // Turns are ordered by created_at, so give each one its own second —
    // three real turns can't land in the same millisecond, but three
    // back-to-back inserts can.
    vi.useFakeTimers();
    try {
      ["one", "two", "three"].forEach((content, index) => {
        vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 0, index)));
        const request = repository.createRequest(session.id, content);
        repository.createResponse({
          requestId: request.id,
          sessionId: session.id,
          content: "ok",
          status: "ok",
          latencyMs: 1,
        });
      });
    } finally {
      vi.useRealTimers();
    }

    const turns = repository.listRecentTurns(session.id, 2);

    expect(turns.map((turn) => turn.request.content)).toEqual(["two", "three"]);
    expect(turns[0]?.response?.content).toBe("ok");
  });

  it("starts a fresh session when given an unknown id", async () => {
    const events = await readSse(
      await postChat({ content: "hello", sessionId: "does-not-exist" }),
    );

    expect(events[0]?.data.sessionId).not.toBe("does-not-exist");
  });

  it("surfaces a provider failure as an error event, not a hung stream", async () => {
    provider = {
      async *generate() {
        throw new GatewayError("overloaded", "provider error (529)", {
          model: "claude-haiku-4-5",
        });
      },
    };

    const events = await readSse(await postChat({ content: "hello" }));

    expect(events.map((e) => e.event)).toEqual(["start", "error"]);
    expect(events[1]?.data.message).toBe(
      "the assistant is busy — try again in a moment",
    );

    const sessionId = events[0]?.data.sessionId as string;
    const turns = repository.listTurns(sessionId);

    // The wire gets the category; the turn log keeps what actually happened.
    expect(turns[0]?.response?.status).toBe("error");
    expect(turns[0]?.response?.error).toBe("provider error (529)");
  });

  it("records the turn's provenance and cost from the provider response", async () => {
    // A stand-in for a real provider call: this is the shape the turn log's
    // new columns are fed from.
    provider = {
      async *generate(_messages, options) {
        options?.onMetadata?.({
          model: "claude-haiku-4-5-20251001",
          stopReason: "end_turn",
          providerRequestId: "req_abc123",
          usage: {
            inputTokens: 120,
            outputTokens: 34,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
          },
          costUsd: 0.00029,
        });
        yield "Yes, in medium.";
      },
    };

    const events = await readSse(await postChat({ content: "blue shirts?" }));
    const sessionId = events[0]?.data.sessionId as string;
    const response = repository.listTurns(sessionId)[0]?.response;

    // The whole of step 5: cost and provenance reconstructable from the row.
    expect(response).toMatchObject({
      status: "ok",
      model: "claude-haiku-4-5-20251001",
      prompt_version: "testversion",
      provider_request_id: "req_abc123",
      stop_reason: "end_turn",
      input_tokens: 120,
      output_tokens: 34,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cost_usd: 0.00029,
    });
  });

  it("keeps the provenance of a turn that failed after the model answered", async () => {
    // A refusal is billed. The reply is empty and the turn is an error, but
    // the tokens were spent and have to land in the log.
    provider = {
      // eslint-disable-next-line require-yield
      async *generate(_messages, options) {
        options?.onMetadata?.({
          model: "claude-haiku-4-5-20251001",
          stopReason: "refusal",
          providerRequestId: "req_refused",
          usage: {
            inputTokens: 90,
            outputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
          },
          costUsd: 0.00009,
        });
        throw new GatewayError("refusal", "the model declined to answer");
      },
    };

    const events = await readSse(await postChat({ content: "hello" }));
    const sessionId = events[0]?.data.sessionId as string;
    const response = repository.listTurns(sessionId)[0]?.response;

    expect(response).toMatchObject({
      status: "error",
      stop_reason: "refusal",
      provider_request_id: "req_refused",
      input_tokens: 90,
      cost_usd: 0.00009,
    });
  });

  it("logs the prompt version even when the model never answered", async () => {
    provider = {
      async *generate() {
        throw new GatewayError("timeout", "provider request timed out");
      },
    };

    const events = await readSse(await postChat({ content: "hello" }));
    const sessionId = events[0]?.data.sessionId as string;
    const response = repository.listTurns(sessionId)[0]?.response;

    // Known before the call, so it survives a call that never happened.
    expect(response?.prompt_version).toBe("testversion");
    // Nothing came back, so these are null rather than zero — "no response"
    // and "a response that used no tokens" are different facts.
    expect(response?.model).toBeNull();
    expect(response?.input_tokens).toBeNull();
    expect(response?.cost_usd).toBeNull();
  });

  it("reports a refusal as a declined answer", async () => {
    provider = {
      async *generate() {
        throw new GatewayError("refusal", "the model declined to answer");
      },
    };

    const events = await readSse(await postChat({ content: "hello" }));

    expect(events[1]?.data.message).toBe(
      "the assistant declined to answer that",
    );
  });

  it("serves the transcript over HTTP", async () => {
    const events = await readSse(await postChat({ content: "hello" }));
    const sessionId = events[0]?.data.sessionId as string;

    const response = await fetch(`${baseUrl}/sessions/${sessionId}/messages`);
    const body = (await response.json()) as {
      messages: { role: string; content: string }[];
    };

    expect(body.messages).toEqual([
      expect.objectContaining({ role: "user", content: "hello" }),
      expect.objectContaining({ role: "assistant", content: "RESPONSE" }),
    ]);
  });

  it("lists sessions newest first, with a preview and turn count", async () => {
    const first = await readSse(await postChat({ content: "older" }));
    const olderId = first[0]?.data.sessionId as string;
    await readSse(await postChat({ content: "second turn", sessionId: olderId }));

    const second = await readSse(await postChat({ content: "newer" }));
    const newerId = second[0]?.data.sessionId as string;

    const response = await fetch(`${baseUrl}/sessions`);
    const body = (await response.json()) as {
      sessions: { id: string; preview: string | null; turnCount: number }[];
    };

    expect(body.sessions.map((s) => s.id)).toEqual([newerId, olderId]);
    // Preview is the first thing said, not the most recent.
    expect(body.sessions[1]).toMatchObject({ preview: "older", turnCount: 2 });
    expect(body.sessions[0]).toMatchObject({ preview: "newer", turnCount: 1 });
  });

  it("lists a session that has no turns yet", async () => {
    const created = await fetch(`${baseUrl}/sessions`, { method: "POST" });
    const { id } = (await created.json()) as { id: string };

    const response = await fetch(`${baseUrl}/sessions`);
    const body = (await response.json()) as {
      sessions: { id: string; preview: string | null; turnCount: number }[];
    };

    expect(body.sessions).toEqual([
      expect.objectContaining({ id, preview: null, turnCount: 0 }),
    ]);
  });

  it("caps the number of sessions returned", async () => {
    await readSse(await postChat({ content: "one" }));
    await readSse(await postChat({ content: "two" }));

    const response = await fetch(`${baseUrl}/sessions?limit=1`);
    const body = (await response.json()) as { sessions: unknown[] };

    expect(body.sessions).toHaveLength(1);
  });

  it("404s an unknown session", async () => {
    const response = await fetch(`${baseUrl}/sessions/nope/messages`);
    expect(response.status).toBe(404);
  });
});
