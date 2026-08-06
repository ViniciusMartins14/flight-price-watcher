import { startWorker } from "./worker.js";

startWorker().catch((err) => {
  console.error("Erro fatal ao iniciar o worker:", err);
  process.exit(1);
});
