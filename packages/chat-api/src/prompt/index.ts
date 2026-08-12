import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SystemPrompt } from "@chatbot/model-gateway";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Version id for a prompt: the first 12 hex characters of the SHA-256 of the
 * exact text sent to the model.
 *
 * Derived rather than hand-maintained on purpose. A number in a file is a
 * promise someone has to keep — edit the prompt, forget to bump it, and every
 * turn logged under the old id is now a lie, which is the one thing a version
 * exists to prevent. A hash cannot drift from its content. What it gives up is
 * ordering: two ids tell you the prompt changed, not which came first. Git
 * knows that, and the turn log has timestamps.
 *
 * 12 characters is short enough to read in a log line and long enough that a
 * collision is not a thing that happens.
 */
export function versionOf(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12);
}

/**
 * Loads the system prompt from disk and stamps it with its version.
 *
 * The text is trimmed *before* hashing, so the id covers exactly the bytes the
 * provider receives — not the file, which carries a trailing newline the model
 * never sees.
 *
 * Read at call time rather than module load so the eval harness (step 6) can
 * load a prompt without the process having booted around one.
 */
export function loadSystemPrompt(
  file = resolve(here, "system.md"),
): SystemPrompt {
  const text = readFileSync(file, "utf8").trim();
  return { version: versionOf(text), text };
}

/**
 * The prompt this service runs with. One artifact, loaded once at boot — a
 * turn is never answered against a prompt that changed underneath it, and the
 * version in the boot log is the version in every request log below it.
 */
export const systemPrompt: SystemPrompt = loadSystemPrompt();
