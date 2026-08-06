import { config } from "./config.js";
import { getRoute, listAllRoutes, recordError, recordPriceCheck } from "./db.js";
import { scrapeCheapestFare } from "./scraper/googleFlights.js";
import { sendWhatsappMessage } from "./whatsapp.js";

const DELAY_BETWEEN_ROUTES_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatPrice(price: number, currency: string): string {
  return currency === "BRL"
    ? `R$ ${price.toLocaleString("pt-BR")}`
    : `${currency} ${price}`;
}

async function checkRoute(routeId: string): Promise<void> {
  const state = await getRoute(routeId);
  if (!state) return;

  const { route } = state;
  try {
    const fare = await scrapeCheapestFare(route);
    const result = await recordPriceCheck(route.id, fare.price, fare.currency, fare.url);
    if (!result) return;

    const label = route.label || `${route.origin} -> ${route.destination}`;
    console.log(
      `[${new Date().toLocaleString("pt-BR")}] ${label}: ${formatPrice(fare.price, fare.currency)}` +
        (result.check.isNewLow ? " (NOVO MENOR PREÇO)" : "")
    );

    if (result.check.isNewLow) {
      const message =
        `✈️ Novo menor preço para ${label}!\n` +
        `${route.origin} -> ${route.destination} em ${route.departDate}` +
        (route.tripType === "roundtrip" && route.returnDate
          ? ` (volta ${route.returnDate})`
          : " (só ida)") +
        `\nPreço: ${formatPrice(fare.price, fare.currency)}` +
        `\n${fare.url}`;
      // Erro ao enviar WhatsApp não deve ser tratado como falha da checagem
      // de preço em si (que já foi salva com sucesso acima).
      try {
        await sendWhatsappMessage(message, route.whatsappNumber);
      } catch (whatsappErr) {
        console.error(
          `Erro ao enviar WhatsApp para rota ${route.origin} -> ${route.destination}:`,
          whatsappErr instanceof Error ? whatsappErr.message : whatsappErr
        );
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Erro ao checar rota ${route.origin} -> ${route.destination}:`, message);
    await recordError(route.id, message);
  }
}

export async function runCheckCycle(): Promise<void> {
  const routes = await listAllRoutes();
  for (const state of routes) {
    await checkRoute(state.route.id);
    await sleep(DELAY_BETWEEN_ROUTES_MS);
  }
}

export function startScheduler(): void {
  const intervalMs = config.checkIntervalMinutes * 60 * 1000;
  console.log(`Agendador iniciado: checagem a cada ${config.checkIntervalMinutes} minutos.`);

  runCheckCycle().catch((err) => console.error("Erro no ciclo de checagem:", err));
  setInterval(() => {
    runCheckCycle().catch((err) => console.error("Erro no ciclo de checagem:", err));
  }, intervalMs);
}

export { checkRoute };
