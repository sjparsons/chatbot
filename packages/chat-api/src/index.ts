import { config } from "./config.js";
import { openDatabase } from "./db/index.js";
import { Repository } from "./db/repository.js";
import { createApp } from "./server.js";

const db = openDatabase(config.databaseUrl);
const repository = new Repository(db);
const app = createApp({ repository, corsOrigins: config.corsOrigins });

const server = app.listen(config.port, () => {
  console.log(`chat-api listening on http://localhost:${config.port}`);
  console.log(`database: ${config.databaseUrl}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
