import { startServer } from "./server.js";
import { startWorker } from "./worker.js";

/**
 * Entrypoint de desenvolvimento local: sobe o dashboard (server.ts) e o
 * worker (whatsapp + scheduler) juntos no mesmo processo, pra facilitar
 * testar tudo de uma vez na sua máquina. Em produção, o dashboard roda
 * separado no Vercel e só o worker roda localmente (veja run-worker.ts).
 */
async function main() {
  startServer();
  await startWorker();
}

main().catch((err) => {
  console.error("Erro fatal ao iniciar a aplicação:", err);
  process.exit(1);
});
