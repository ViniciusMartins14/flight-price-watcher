import { findNearestAirports } from "../airports.js";
import type { ComboResult, FlightRoute } from "../types.js";
import { scrapeFlightOptions } from "./googleFlights.js";
import { buildSearchUrl } from "./googleFlightsUrl.js";
import type { FlightOption } from "./parseFlightRow.js";

const MIN_CONNECTION_MS = 90 * 60 * 1000; // 1h30 — tempo mínimo realista pra trocar de voo
const MAX_CONNECTION_MS = 12 * 60 * 60 * 1000; // 12h — acima disso não é conexão, é uma parada longa
const CANDIDATE_COUNT = 3;

/**
 * Procura uma "tarifa combinada": em vez de um voo direto origem -> destino,
 * busca dois voos separados (origem -> aeroporto próximo do destino, e
 * desse aeroporto -> destino) que juntos podem sair mais barato. Só
 * considera combinações onde o segundo voo parte depois que o primeiro
 * chega, com um intervalo mínimo pra trocar de voo (isso são DUAS
 * passagens separadas — sem essa validação de horário, poderia sugerir
 * uma conexão fisicamente impossível de fazer).
 *
 * Retorna undefined se nenhuma combinação viável for encontrada.
 */
export async function findBestCombo(route: FlightRoute): Promise<ComboResult | undefined> {
  const candidates = findNearestAirports(route.destination, CANDIDATE_COUNT).filter(
    (a) => a.iata !== route.origin && a.iata !== route.destination
  );

  let best: ComboResult | undefined;

  for (const candidate of candidates) {
    const leg1Route: FlightRoute = {
      ...route,
      destination: candidate.iata,
      tripType: "oneway",
      returnDate: undefined,
    };

    let leg1Options: FlightOption[];
    try {
      leg1Options = await scrapeFlightOptions(leg1Route);
    } catch {
      // Esse aeroporto candidato não tem voo de ida a partir da origem —
      // tenta o próximo candidato em vez de falhar tudo.
      continue;
    }

    // O trecho 1 pode chegar em dias diferentes dependendo do voo (viagens
    // longas com escala às vezes levam 1-2 dias). Busca o trecho 2 em cada
    // data de chegada que realmente apareceu, em vez de assumir que os dois
    // trechos são no mesmo dia da busca original.
    const arrivalDates = [...new Set(leg1Options.map((o) => o.arriveAt.slice(0, 10)))];

    const leg2Options: FlightOption[] = [];
    const leg2UrlByDate = new Map<string, string>();
    for (const date of arrivalDates) {
      const leg2Route: FlightRoute = {
        ...route,
        origin: candidate.iata,
        departDate: date,
        tripType: "oneway",
        returnDate: undefined,
      };
      leg2UrlByDate.set(date, buildSearchUrl(leg2Route));
      try {
        leg2Options.push(...(await scrapeFlightOptions(leg2Route)));
      } catch {
        // sem voos do candidato pro destino nessa data específica, tudo bem
      }
    }

    if (leg2Options.length === 0) continue;

    const leg1Url = buildSearchUrl(leg1Route);

    for (const leg1 of leg1Options) {
      const arriveAtMs = new Date(leg1.arriveAt).getTime();
      for (const leg2 of leg2Options) {
        const departAtMs = new Date(leg2.departAt).getTime();
        const connectionMs = departAtMs - arriveAtMs;
        if (connectionMs < MIN_CONNECTION_MS || connectionMs > MAX_CONNECTION_MS) continue;

        const totalPrice = leg1.price + leg2.price;
        if (!best || totalPrice < best.totalPrice) {
          best = {
            via: candidate.iata,
            leg1: { ...leg1, url: leg1Url },
            leg2: { ...leg2, url: leg2UrlByDate.get(leg2.departAt.slice(0, 10)) ?? leg1Url },
            totalPrice,
            currency: leg1.currency,
          };
        }
      }
    }
  }

  return best;
}
