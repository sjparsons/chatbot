import { createGateway, loadConfig } from "@chatbot/model-gateway";
import { config } from "./config.js";
import { openDatabase } from "./db/index.js";
import { Repository } from "./db/repository.js";
import { createApp } from "./server.js";

const db = openDatabase(config.databaseUrl);
const repository = new Repository(db);

// Resolved once here so the boot log can state exactly which model turns will
// go to — with the payload log on, that is the header for everything below it.
const modelConfig = loadConfig();
const gateway = createGateway({ config: modelConfig });

const app = createApp({
  repository,
  corsOrigins: config.corsOrigins,
  gateway,
});

const server = app.listen(config.port, () => {
  console.log(`chat-api listening on http://localhost:${config.port}`);
  console.log(`database: ${config.databaseUrl}`);
  // The mock ignores the model ids, so printing them would only mislead.
  console.log(
    modelConfig.provider === "mock"
      ? "model: mock (no provider calls)"
      : `model: ${modelConfig.model}` +
          (modelConfig.fallbackModel
            ? ` (fallback ${modelConfig.fallbackModel})`
            : " (no fallback)"),
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
