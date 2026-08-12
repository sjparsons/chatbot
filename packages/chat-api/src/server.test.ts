import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
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

  beforeEach(async () => {
    db = openDatabase(":memory:");
    repository = new Repository(db);
    const app = createApp({ repository, corsOrigins: ["*"] });

    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });

    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
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

  it("404s an unknown session", async () => {
    const response = await fetch(`${baseUrl}/sessions/nope/messages`);
    expect(response.status).toBe(404);
  });
});
