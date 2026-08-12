import { Router } from "express";
import { config } from "../config.js";
import { buildContext } from "../context.js";
import type { Repository } from "../db/repository.js";
import { generateResponse } from "../mock.js";
import { SseStream } from "../sse.js";

interface ChatBody {
  content?: unknown;
  sessionId?: unknown;
}

export function chatRouter(repository: Repository): Router {
  const router = Router();

  router.post("/chat", async (req, res) => {
    const body = req.body as ChatBody;
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const sessionId =
      typeof body.sessionId === "string" ? body.sessionId : null;

    if (!content) {
      res.status(400).json({ error: "content is required" });
      return;
    }

    const session = repository.ensureSession(sessionId);
    const request = repository.createRequest(session.id, content);

    // The request is already logged, so it comes back as the last turn — the
    // one with no response yet — and becomes the trailing user message.
    const messages = buildContext(
      repository.listRecentTurns(session.id, config.contextWindowTurns),
    );

    const stream = new SseStream(res);
    const startedAt = Date.now();

    // The client going away is normal — abandon the stream but still record
    // the turn, so a dropped connection is visible in the log rather than
    // silently missing.
    //
    // This listens on `res`, not `req`: express.json() drains the request
    // stream before the handler runs, so `req` emits "close" immediately and
    // would flag every stream as aborted. `res` emits "close" when the socket
    // goes away, which is only an abort if we hadn't finished writing.
    let aborted = false;
    res.on("close", () => {
      if (res.writableEnded) return;
      aborted = true;
      stream.markClosed();
    });

    stream.send("start", {
      sessionId: session.id,
      requestId: request.id,
    });

    let text = "";

    try {
      for await (const delta of generateResponse(messages)) {
        if (aborted) break;
        text += delta;
        stream.send("delta", { text: delta });
      }

      if (aborted) {
        repository.createResponse({
          requestId: request.id,
          sessionId: session.id,
          content: text,
          status: "error",
          error: "client disconnected",
          latencyMs: Date.now() - startedAt,
        });
        return;
      }

      const response = repository.createResponse({
        requestId: request.id,
        sessionId: session.id,
        content: text,
        status: "ok",
        latencyMs: Date.now() - startedAt,
      });

      stream.send("done", {
        responseId: response.id,
        latencyMs: response.latency_ms,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      repository.createResponse({
        requestId: request.id,
        sessionId: session.id,
        content: text,
        status: "error",
        error: message,
        latencyMs: Date.now() - startedAt,
      });

      stream.send("error", { message });
    } finally {
      stream.close();
    }
  });

  return router;
}
