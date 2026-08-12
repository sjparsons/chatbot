import { Router } from "express";
import { GatewayError, type Gateway } from "@chatbot/model-gateway";
import { config } from "../config.js";
import { buildContext } from "../context.js";
import type { Repository } from "../db/repository.js";
import { SseStream } from "../sse.js";

interface ChatBody {
  content?: unknown;
  sessionId?: unknown;
}

/**
 * What the browser is told when a turn fails.
 *
 * Provider errors can carry request ids and internal detail, so the client gets
 * the category and the turn log keeps the original message.
 */
function clientMessage(error: unknown): string {
  if (!(error instanceof GatewayError)) return "something went wrong";

  switch (error.code) {
    case "refusal":
      return "the assistant declined to answer that";
    case "timeout":
      return "the assistant took too long to respond";
    case "rate_limit":
    case "overloaded":
      return "the assistant is busy — try again in a moment";
    case "auth":
    case "invalid_request":
      return "the assistant is misconfigured";
    default:
      return "the assistant is unavailable";
  }
}

export function chatRouter(repository: Repository, gateway: Gateway): Router {
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
    const controller = new AbortController();
    res.on("close", () => {
      if (res.writableEnded) return;
      aborted = true;
      stream.markClosed();
      // Cancel the provider call too — otherwise an abandoned turn keeps
      // generating, and paying, with nobody listening.
      controller.abort();
    });

    stream.send("start", {
      sessionId: session.id,
      requestId: request.id,
    });

    let text = "";

    try {
      for await (const delta of gateway.generate(messages, {
        signal: controller.signal,
      })) {
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
      // Aborting the provider call surfaces here as a thrown error rather than
      // the loop ending, so a disconnect is not logged as a provider fault.
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

      const detail = error instanceof Error ? error.message : String(error);
      console.error(`chat turn failed (request ${request.id}):`, error);

      repository.createResponse({
        requestId: request.id,
        sessionId: session.id,
        content: text,
        status: "error",
        error: detail,
        latencyMs: Date.now() - startedAt,
      });

      stream.send("error", { message: clientMessage(error) });
    } finally {
      stream.close();
    }
  });

  return router;
}
