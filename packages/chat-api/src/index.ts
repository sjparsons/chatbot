import { createGateway, loadConfig } from "@chatbot/model-gateway";
import { config, envFile } from "./config.js";
import { openDatabase } from "./db/index.js";
import { Repository } from "./db/repository.js";
import { systemPrompt } from "./prompt/index.js";
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
  systemPrompt,
  // The mock ignores the model ids, so naming one on /health would mislead a
  // caller into attributing a score to a model that never ran.
  modelId: modelConfig.provider === "mock" ? "mock" : modelConfig.model,
});

const server = app.listen(config.port, () => {
  console.log(`chat-api listening on http://localhost:${config.port}`);
  console.log(`env file: ${envFile ?? "none (using the environment as-is)"}`);
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
  // Printed once here and on every request line below: if those two ever
  // disagree, the prompt changed on disk while the process was up.
  console.log(`prompt: system ${systemPrompt.version}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
