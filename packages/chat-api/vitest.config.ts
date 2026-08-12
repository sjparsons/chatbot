import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the sibling workspace from source, so the suite doesn't need
      // the gateway built first.
      "@chatbot/model-gateway": fileURLToPath(
        new URL("../model-gateway/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    env: {
      // No network and no credentials in the suite; keep the mock instant and
      // its payload log out of the test output.
      MODEL_PROVIDER: "mock",
      MODEL_LOG_PAYLOADS: "0",
      MOCK_DELAY_MIN_MS: "0",
      MOCK_DELAY_MAX_MS: "0",
    },
  },
});
