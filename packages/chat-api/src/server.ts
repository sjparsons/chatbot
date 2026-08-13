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
  /**
   * Reported by `/health` so a caller can attribute behaviour to a model
   * without reading this process's boot log. The configured alias, not the
   * dated id the provider returns — no call has been made yet.
   */
  modelId: string;
}

export function createApp({
  repository,
  corsOrigins,
  gateway,
  systemPrompt,
  modelId,
}: ServerOptions): Express {
  const app = express();

  app.use(cors({ origin: corsOrigins }));
  app.use(express.json({ limit: "1mb" }));

  // Prompt version and model are here for the eval harness: it scores a server
  // it does not configure, so the run has to ask what it is talking to rather
  // than assume its own environment matches.
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      prompt: systemPrompt.version,
      model: modelId,
    });
  });

  app.use(sessionsRouter(repository));
  app.use(chatRouter(repository, gateway, systemPrompt));

  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  return app;
}
