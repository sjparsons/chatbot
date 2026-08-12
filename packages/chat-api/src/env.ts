import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Finds the nearest `.env.local` by walking up from this file.
 *
 * Not a fixed number of `..` hops: a git worktree lives under
 * `.claude/worktrees/<name>/`, so the repo root is a different distance away
 * depending on where the process was started from. Walking up finds the
 * worktree's own file if it has one and otherwise falls through to the main
 * checkout's, which is what makes one `.env.local` serve every worktree.
 *
 * Stops at the home directory so it can never wander into an unrelated file
 * further up the filesystem. `ENV_FILE` overrides the search outright.
 */
function findEnvFile(): string | null {
  const override = process.env.ENV_FILE;
  if (override) return existsSync(override) ? resolve(override) : null;

  const stopAt = dirname(homedir());
  let directory = here;

  while (directory !== stopAt) {
    const candidate = resolve(directory, ".env.local");
    if (existsSync(candidate)) return candidate;

    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  return null;
}

/**
 * Path that was loaded, or null. Exported so the boot log can name it — with a
 * file this far up the tree, "which one did it read" is worth not guessing.
 *
 * Real environment variables win: `loadEnvFile` does not overwrite anything
 * already set, so `ANTHROPIC_API_KEY=… npm run dev` still overrides the file.
 */
export const envFile = findEnvFile();

if (envFile) process.loadEnvFile(envFile);
