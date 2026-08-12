import { describe, expect, it } from "vitest";
import { parseSseStream } from "./sse";

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const events = [];
  for await (const event of parseSseStream(stream)) events.push(event);
  return events;
}

describe("parseSseStream", () => {
  it("parses events", async () => {
    const events = await collect(
      streamOf(
        'event: start\ndata: {"sessionId":"s1"}\n\n',
        'event: delta\ndata: {"text":"RESPONSE"}\n\n',
      ),
    );

    expect(events).toEqual([
      { event: "start", data: { sessionId: "s1" } },
      { event: "delta", data: { text: "RESPONSE" } },
    ]);
  });

  it("reassembles events split across chunks", async () => {
    const events = await collect(
      streamOf('event: del', 'ta\ndata: {"te', 'xt":"hi"}\n\n'),
    );

    expect(events).toEqual([{ event: "delta", data: { text: "hi" } }]);
  });

  it("handles several events in one chunk", async () => {
    const events = await collect(
      streamOf('event: a\ndata: 1\n\nevent: b\ndata: 2\n\n'),
    );

    expect(events.map((e) => e.event)).toEqual(["a", "b"]);
  });

  it("emits a trailing event with no blank line", async () => {
    const events = await collect(streamOf('event: done\ndata: {"ok":true}'));

    expect(events).toEqual([{ event: "done", data: { ok: true } }]);
  });

  it("ignores comments and keep-alives", async () => {
    const events = await collect(
      streamOf(': keep-alive\n\nevent: delta\ndata: {"text":"x"}\n\n'),
    );

    expect(events).toEqual([{ event: "delta", data: { text: "x" } }]);
  });
});
