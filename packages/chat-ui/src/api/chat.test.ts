import { afterEach, describe, expect, it, vi } from "vitest";
import { sendMessage } from "./chat";

function sseResponse(body: string, init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    ...init,
  });
}

const okStream = [
  'event: start\ndata: {"sessionId":"s1","requestId":"r1"}\n\n',
  'event: delta\ndata: {"text":"RESPONSE"}\n\n',
  'event: done\ndata: {"responseId":"x1","latencyMs":800}\n\n',
].join("");

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendMessage", () => {
  it("returns the accumulated content and session id", async () => {
    stubFetch(sseResponse(okStream));

    await expect(
      sendMessage({ content: "hello", sessionId: null }),
    ).resolves.toEqual({ sessionId: "s1", content: "RESPONSE" });
  });

  it("posts the message and session id", async () => {
    const fetchMock = stubFetch(sseResponse(okStream));

    await sendMessage({ content: "hello", sessionId: "existing" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      content: "hello",
      sessionId: "existing",
    });
  });

  it("invokes the handlers", async () => {
    stubFetch(sseResponse(okStream));

    const onStart = vi.fn();
    const onDelta = vi.fn();

    await sendMessage({ content: "hello", sessionId: null }, { onStart, onDelta });

    expect(onStart).toHaveBeenCalledWith({ sessionId: "s1", requestId: "r1" });
    expect(onDelta).toHaveBeenCalledWith("RESPONSE");
  });

  it("accumulates multiple deltas", async () => {
    stubFetch(
      sseResponse(
        'event: start\ndata: {"sessionId":"s1","requestId":"r1"}\n\n' +
          'event: delta\ndata: {"text":"RES"}\n\n' +
          'event: delta\ndata: {"text":"PONSE"}\n\n' +
          'event: done\ndata: {"responseId":"x1","latencyMs":10}\n\n',
      ),
    );

    const result = await sendMessage({ content: "hello", sessionId: null });
    expect(result.content).toBe("RESPONSE");
  });

  it("rejects on an error event", async () => {
    stubFetch(
      sseResponse(
        'event: start\ndata: {"sessionId":"s1","requestId":"r1"}\n\n' +
          'event: error\ndata: {"message":"boom"}\n\n',
      ),
    );

    await expect(
      sendMessage({ content: "hello", sessionId: null }),
    ).rejects.toThrow("boom");
  });

  it("rejects when the stream ends without a done event", async () => {
    stubFetch(
      sseResponse('event: start\ndata: {"sessionId":"s1","requestId":"r1"}\n\n'),
    );

    await expect(
      sendMessage({ content: "hello", sessionId: null }),
    ).rejects.toThrow(/ended before completing/);
  });

  it("rejects on a non-2xx response", async () => {
    stubFetch(new Response("bad request", { status: 400 }));

    await expect(
      sendMessage({ content: "", sessionId: null }),
    ).rejects.toThrow(/400/);
  });
});
