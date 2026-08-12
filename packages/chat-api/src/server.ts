import express, { type Express } from "express";
import cors from "cors";
import type { Repository } from "./db/repository.js";
import { chatRouter } from "./routes/chat.js";
import { sessionsRouter } from "./routes/sessions.js";

export interface ServerOptions {
  repository: Repository;
  corsOrigins: string[];
}

export function createApp({ repository, corsOrigins }: ServerOptions): Express {
  const app = express();

  app.use(cors({ origin: corsOrigins }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(sessionsRouter(repository));
  app.use(chatRouter(repository));

  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  return app;
}
