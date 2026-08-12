import express, { type Express } from "express";
import cors from "cors";
import type { Gateway, SystemPrompt } from "@chatbot/model-gateway";
import type { Repository } from "./db/repository.js";
import { chatRouter } from "./routes/chat.js";
import { sessionsRouter } from "./routes/sessions.js";

export interface ServerOptions {
  repository: Repository;
  corsOrigins: string[];
  /**
   * Injected for the same reason the repository is: tests hand over a gateway
   * backed by the mock provider, so the suite never needs a key or a network.
   */
  gateway: Gateway;
  /**
   * Injected for the same reason: the prompt is an argument to the app, not
   * something the request path reaches out to the filesystem for.
   */
  systemPrompt: SystemPrompt;
}

export function createApp({
  repository,
  corsOrigins,
  gateway,
  systemPrompt,
}: ServerOptions): Express {
  const app = express();

  app.use(cors({ origin: corsOrigins }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(sessionsRouter(repository));
  app.use(chatRouter(repository, gateway, systemPrompt));

  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  return app;
}
