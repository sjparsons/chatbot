import { describe, expect, it } from "vitest";
import { buildContext } from "./context.js";
import type { ResponseRow, TurnRow } from "./db/repository.js";

function turn(
  content: string,
  reply?: string | null,
  status: ResponseRow["status"] = "ok",
): TurnRow {
  return {
    request: {
      id: `req-${content}`,
      session_id: "s",
      content,
      created_at: "2026-08-12T00:00:00.000Z",
    },
    response:
      reply === undefined
        ? null
        : {
            id: `res-${content}`,
            request_id: `req-${content}`,
            session_id: "s",
            content: reply ?? "",
            status,
            error: null,
            latency_ms: 1,
            created_at: "2026-08-12T00:00:01.000Z",
          },
  };
}

describe("buildContext", () => {
  it("returns nothing for an empty transcript", () => {
    expect(buildContext([])).toEqual([]);
  });

  it("ends with the unanswered turn as the user message", () => {
    expect(buildContext([turn("hello")])).toEqual([
      { role: "user", content: "hello" },
    ]);
  });

  it("alternates user and assistant across turns", () => {
    const messages = buildContext([turn("one", "first"), turn("two")]);

    expect(messages).toEqual([
      { role: "user", content: "one" },
      { role: "assistant", content: "first" },
      { role: "user", content: "two" },
    ]);
  });

  it("drops an earlier turn whose response failed", () => {
    const messages = buildContext([
      turn("one", "first"),
      turn("dropped", "", "error"),
      turn("three"),
    ]);

    expect(messages).toEqual([
      { role: "user", content: "one" },
      { role: "assistant", content: "first" },
      { role: "user", content: "three" },
    ]);
  });

  it("drops an earlier turn that succeeded but produced nothing", () => {
    const messages = buildContext([turn("empty", ""), turn("next")]);

    expect(messages).toEqual([{ role: "user", content: "next" }]);
  });
});
