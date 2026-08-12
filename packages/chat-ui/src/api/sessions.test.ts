import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMessages, listSessions } from "./sessions";

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listSessions", () => {
  it("unwraps the sessions array", async () => {
    const sessions = [
      {
        id: "s1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:01:00.000Z",
        preview: "hello",
        turnCount: 2,
      },
    ];
    stubFetch(json({ sessions }));

    await expect(listSessions()).resolves.toEqual(sessions);
  });

  it("rejects on a non-2xx response", async () => {
    stubFetch(json({ error: "boom" }, 500));
    await expect(listSessions()).rejects.toThrow(/500/);
  });
});

describe("fetchMessages", () => {
  it("unwraps the messages array", async () => {
    const messages = [{ id: "m1", role: "user", content: "hello" }];
    stubFetch(json({ sessionId: "s1", messages }));

    await expect(fetchMessages("s1")).resolves.toEqual(messages);
  });

  it("encodes the session id into the path", async () => {
    const fetchMock = stubFetch(json({ sessionId: "a/b", messages: [] }));

    await fetchMessages("a/b");

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/sessions/a%2Fb/");
  });

  it("rejects on a missing session", async () => {
    stubFetch(json({ error: "session not found" }, 404));
    await expect(fetchMessages("nope")).rejects.toThrow(/404/);
  });
});
