import { startScheduler } from "./scheduler.js";
import { startServer } from "./server.js";
import { initWhatsapp, waitForWhatsappReady } from "./whatsapp.js";

const WHATSAPP_READY_TIMEOUT_MS = 2 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  startServer();

  initWhatsapp();
  console.log("Aguardando conexão com o WhatsApp (escaneie o QR code se solicitado)...");
  const timedOut = await Promise.race([
    waitForWhatsappReady().then(() => false),
    sleep(WHATSAPP_READY_TIMEOUT_MS).then(() => true),
  ]);
  if (timedOut) {
    console.warn(
      "WhatsApp não conectou a tempo; seguindo sem notificações até a conexão ser concluída."
    );
  }

  startScheduler();
}

main().catch((err) => {
  console.error("Erro fatal ao iniciar a aplicação:", err);
  process.exit(1);
});
