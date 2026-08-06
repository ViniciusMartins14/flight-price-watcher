import { config } from "./config.js";
import { getRoute, listAllRoutes, recordError, recordPriceCheck } from "./db.js";
import { findBestCombo } from "./scraper/comboSearch.js";
import { scrapeCheapestFare } from "./scraper/googleFlights.js";
import type { ComboResult } from "./types.js";
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

function formatComboLeg(leg: ComboResult["leg1"]): string {
  const depart = new Date(leg.departAt);
  const arrive = new Date(leg.arriveAt);
  const fmt = (d: Date) =>
    d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return `${fmt(depart)} → ${fmt(arrive)}: ${formatPrice(leg.price, leg.currency)}\n${leg.url}`;
}

async function checkRoute(routeId: string): Promise<void> {
  const state = await getRoute(routeId);
  if (!state) return;

  const { route } = state;
  try {
    const fare = await scrapeCheapestFare(route);

    let combo: ComboResult | undefined;
    if (route.combineStops && route.tripType === "oneway") {
      try {
        combo = await findBestCombo(route);
      } catch (comboErr) {
        // Falha na busca combinada não deve impedir o registro do preço
        // direto, que já foi encontrado com sucesso.
        console.error(
          `Erro ao buscar tarifa combinada para ${route.origin} -> ${route.destination}:`,
          comboErr instanceof Error ? comboErr.message : comboErr
        );
      }
    }

    const result = await recordPriceCheck(route.id, fare.price, fare.currency, fare.url, combo);
    if (!result) return;

    const label = route.label || `${route.origin} -> ${route.destination}`;
    const comboIsCheaper = combo !== undefined && combo.totalPrice < fare.price;
    const effectivePrice = comboIsCheaper ? combo!.totalPrice : fare.price;

    console.log(
      `[${new Date().toLocaleString("pt-BR")}] ${label}: ${formatPrice(fare.price, fare.currency)}` +
        (comboIsCheaper
          ? ` (combinada via ${combo!.via}: ${formatPrice(effectivePrice, combo!.currency)})`
          : "") +
        (result.check.isNewLow ? " (NOVO MENOR PREÇO)" : "")
    );

    if (result.check.isNewLow) {
      const routeDescription =
        `${route.origin} -> ${route.destination} em ${route.departDate}` +
        (route.tripType === "roundtrip" && route.returnDate ? ` (volta ${route.returnDate})` : " (só ida)");

      const message = comboIsCheaper
        ? `✈️ Novo menor preço para ${label} (tarifa combinada, 2 passagens separadas)!\n` +
          `${routeDescription}\n` +
          `Total: ${formatPrice(effectivePrice, combo!.currency)} (direto sairia ${formatPrice(fare.price, fare.currency)})\n\n` +
          `Trecho 1 (${route.origin} → ${combo!.via}):\n${formatComboLeg(combo!.leg1)}\n\n` +
          `Trecho 2 (${combo!.via} → ${route.destination}):\n${formatComboLeg(combo!.leg2)}\n\n` +
          `⚠️ São 2 bilhetes separados: confira o tempo de conexão, recolha e despache a bagagem de novo, e não há proteção se um voo atrasar e você perder o outro.`
        : `✈️ Novo menor preço para ${label}!\n` +
          `${routeDescription}\n` +
          `Preço: ${formatPrice(fare.price, fare.currency)}\n` +
          `${fare.url}`;

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
