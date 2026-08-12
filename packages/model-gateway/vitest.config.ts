import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Keep the mock instant so the suite doesn't pay the artificial delay.
    env: {
      MOCK_DELAY_MIN_MS: "0",
      MOCK_DELAY_MAX_MS: "0",
    },
  },
});
