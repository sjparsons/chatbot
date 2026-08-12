import { describe, expect, it } from "vitest";
import { sendMessage } from "./chat";

describe("sendMessage", () => {
  it("returns the mock response", async () => {
    await expect(sendMessage("hello")).resolves.toBe("RESPONSE");
  });
});
