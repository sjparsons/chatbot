import { Router } from "express";
import type { Repository } from "../db/repository.js";

export function sessionsRouter(repository: Repository): Router {
  const router = Router();

  router.post("/sessions", (_req, res) => {
    const session = repository.createSession();
    res.status(201).json({ id: session.id, createdAt: session.created_at });
  });

  router.get("/sessions/:id", (req, res) => {
    const session = repository.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    res.json({
      id: session.id,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
    });
  });

  /** Flattened transcript, for rehydrating the UI or eyeballing a session. */
  router.get("/sessions/:id/messages", (req, res) => {
    const session = repository.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }

    const messages = repository.listTurns(session.id).flatMap((turn) => [
      {
        id: turn.request.id,
        role: "user" as const,
        content: turn.request.content,
        createdAt: turn.request.created_at,
      },
      ...(turn.response && turn.response.status === "ok"
        ? [
            {
              id: turn.response.id,
              role: "assistant" as const,
              content: turn.response.content,
              createdAt: turn.response.created_at,
            },
          ]
        : []),
    ]);

    res.json({ sessionId: session.id, messages });
  });

  return router;
}
