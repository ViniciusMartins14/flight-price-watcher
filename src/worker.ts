import { startScheduler } from "./scheduler.js";
import { initWhatsapp, waitForWhatsappReady } from "./whatsapp.js";

const WHATSAPP_READY_TIMEOUT_MS = 2 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Roda só a parte que precisa ficar num processo sempre ligado na sua
 * máquina: conexão com o WhatsApp e o agendador de checagem de preços.
 * O dashboard (server.ts) pode rodar separado, inclusive no Vercel,
 * já que os dois lados compartilham o mesmo MongoDB.
 */
export async function startWorker(): Promise<void> {
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
