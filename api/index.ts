import { createServer } from "../src/server.js";

// Entrypoint serverless do Vercel: expõe o mesmo app Express usado
// localmente (server.ts). O worker (whatsapp + scraper) NÃO roda aqui,
// só na sua máquina (veja src/run-worker.ts) — os dois lados compartilham
// o mesmo MongoDB.
export default createServer();
