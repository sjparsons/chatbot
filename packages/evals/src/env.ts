import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Finds the nearest `.env.local` by walking up from this file, so `npm run
 * eval` picks up a key the same way `npm run dev` does.
 *
 * Deliberately a copy of `chat-api/src/env.ts` rather than an import. The eval
 * harness scores the service over HTTP; making it depend on the service's
 * package to read a dotenv file would be a coupling in the wrong direction for
 * twenty lines.
 *
 * The judge is why this is needed at all — the harness talks to chat-api
 * without credentials, but grades its replies with a model of its own.
 */
function findEnvFile(): string | null {
  const override = process.env.ENV_FILE;
  if (override) return existsSync(override) ? resolve(override) : null;

  const stopAt = dirname(homedir());
  let directory = dirname(fileURLToPath(import.meta.url));

  while (directory !== stopAt) {
    const candidate = resolve(directory, ".env.local");
    if (existsSync(candidate)) return candidate;

    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  return null;
}

/** Path that was loaded, or null. Real environment variables still win. */
export const envFile = findEnvFile();

if (envFile) process.loadEnvFile(envFile);
