import express from "express";
import path from "node:path";
import { config } from "./config.js";
import { apiRouter } from "./routes/api.js";

export function createServer() {
  const app = express();
  app.use(express.json());
  app.use("/api", apiRouter);
  // process.cwd() (não __dirname) porque no Vercel o arquivo roda empacotado
  // a partir da raiz do projeto, onde a pasta public/ está.
  app.use(express.static(path.join(process.cwd(), "public")));
  return app;
}

export function startServer(): void {
  const app = createServer();
  app.listen(config.port, () => {
    console.log(`Dashboard disponível em http://localhost:${config.port}`);
  });
}
