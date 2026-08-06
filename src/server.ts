import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { apiRouter } from "./routes/api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createServer() {
  const app = express();
  app.use(express.json());
  app.use("/api", apiRouter);
  app.use(express.static(path.join(__dirname, "..", "public")));
  return app;
}

export function startServer(): void {
  const app = createServer();
  app.listen(config.port, () => {
    console.log(`Dashboard disponível em http://localhost:${config.port}`);
  });
}
