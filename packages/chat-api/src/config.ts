// Must come first: it populates process.env, which this module reads below.
import { envFile } from "./env.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Which `.env.local` was picked up, if any. Re-exported for the boot log. */
export { envFile };

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: int(process.env.PORT, 3001),

  /** Origins allowed to call this service directly from the browser. */
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173").split(","),

  /** SQLite file. ":memory:" is used by the tests. */
  databaseUrl:
    process.env.DATABASE_URL ?? resolve(here, "..", "data", "chat.sqlite"),

  /**
   * How many turns of transcript go into the model's context, the turn being
   * answered included. Last N verbatim; summarizing older ones comes later.
   */
  contextWindowTurns: int(process.env.CONTEXT_WINDOW_TURNS, 10),
};
