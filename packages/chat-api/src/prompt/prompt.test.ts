import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSystemPrompt, systemPrompt, versionOf } from "./index.js";

/** Writes a prompt file and loads it, the way a prompt edit would. */
function loadText(text: string) {
  const file = join(mkdtempSync(join(tmpdir(), "prompt-")), "system.md");
  writeFileSync(file, text, "utf8");
  return loadSystemPrompt(file);
}

describe("system prompt", () => {
  it("ships an artifact with a version", () => {
    expect(systemPrompt.text.length).toBeGreaterThan(0);
    expect(systemPrompt.version).toMatch(/^[0-9a-f]{12}$/);
  });

  it("versions the text that is sent, not the file", () => {
    // The file's trailing newline never reaches the model, so it must not
    // reach the version either.
    expect(loadText("be helpful\n")).toEqual(loadText("be helpful"));
  });

  it("changes the version when the prompt changes", () => {
    const before = loadText("be helpful");
    const after = loadText("be helpful and brief");

    expect(after.version).not.toBe(before.version);
  });

  it("derives the version from the content, so it cannot be forgotten", () => {
    expect(loadText("be helpful").version).toBe(versionOf("be helpful"));
  });
});
