import qrcodeTerminal from "qrcode-terminal";
import { chromium } from "playwright";
import pkg from "whatsapp-web.js";
import { config } from "./config.js";

const { Client, LocalAuth } = pkg;

let client: InstanceType<typeof Client> | undefined;
let isReady = false;
let resolveReady: () => void;
const readyPromise = new Promise<void>((resolve) => {
  resolveReady = resolve;
});

export function initWhatsapp(): void {
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth" }),
    // Reaproveita o Chromium que o Playwright já baixa via postinstall,
    // evitando um segundo download de navegador só para o whatsapp-web.js.
    puppeteer: { headless: true, executablePath: chromium.executablePath() },
  });

  client.on("qr", (qr) => {
    console.log("\nEscaneie o QR code abaixo no WhatsApp (Aparelhos conectados > Conectar um aparelho):\n");
    qrcodeTerminal.generate(qr, { small: true });
  });

  client.on("ready", () => {
    console.log("WhatsApp conectado.");
    isReady = true;
    resolveReady();
  });

  client.on("auth_failure", (msg) => {
    console.error("Falha na autenticação do WhatsApp:", msg);
  });

  client.on("disconnected", (reason) => {
    console.error("WhatsApp desconectado:", reason);
  });

  client.initialize().catch((err) => {
    console.error("Erro ao inicializar o WhatsApp:", err);
  });
}

export function waitForWhatsappReady(): Promise<void> {
  return readyPromise;
}

function toChatId(number: string): string {
  const digits = number.replace(/\D/g, "");
  return `${digits}@c.us`;
}

export async function sendWhatsappMessage(message: string): Promise<void> {
  if (!client || !isReady) {
    console.warn("WhatsApp ainda não conectado; pulando envio de mensagem.");
    return;
  }
  if (!config.whatsappTargetNumber) {
    console.warn("WHATSAPP_TARGET_NUMBER não configurado; pulando envio de mensagem.");
    return;
  }
  const chatId = toChatId(config.whatsappTargetNumber);
  await client.sendMessage(chatId, message);
}
