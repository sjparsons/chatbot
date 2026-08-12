import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  createGateway,
  GatewayError,
  type Gateway,
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
  const gateway: Gateway = {
    generate: (messages, options) => provider.generate(messages, options),
  };

  beforeEach(async () => {
    db = openDatabase(":memory:");
    repository = new Repository(db);
    const app = createApp({ repository, corsOrigins: ["*"], gateway });

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

  it("reports health", async () => {
    const response = await fetch(`${baseUrl}/health`);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
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

    expect(events.map((e) => e.event)).toEqual(["start", "delta", "done"]);
    expect(events[0]?.data.sessionId).toEqual(expect.any(String));
    expect(events[1]?.data.text).toBe("RESPONSE");
    expect(events[2]?.data.latencyMs).toEqual(expect.any(Number));
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

    expect(first[1]?.data.text).toBe("RESPONSE");

    const second = await readSse(await postChat({ content: "two", sessionId }));

    // The mock echoes what it was given, so this is the model demonstrably
    // seeing turn 1 while answering turn 2.
    expect(second[1]?.data.text).toBe(
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
