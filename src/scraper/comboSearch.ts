import { findNearestAirports } from "../airports.js";
import type { ComboLeg, ComboResult, FlightRoute } from "../types.js";
import { scrapeFlightOptions } from "./googleFlights.js";
import { buildSearchUrl } from "./googleFlightsUrl.js";
import type { FlightOption } from "./parseFlightRow.js";

const MIN_CONNECTION_MS = 90 * 60 * 1000; // 1h30 — tempo mínimo realista pra trocar de voo
const MAX_TIGHT_CONNECTION_MS = 12 * 60 * 60 * 1000; // 12h — acima disso não é conexão, é uma parada longa
const CANDIDATE_COUNT = 3;

// Grandes hubs de longo curso com voo direto conhecido a partir do Brasil —
// usados como escala extra na busca de 3 trechos (origem -> hub -> perto do
// destino -> destino), pra quando não há rota boa direto até os aeroportos
// perto do destino final.
const HUB_AIRPORTS = ["LIS", "MAD", "FCO", "IST"];
const HUB_CANDIDATE_COUNT = 2; // aeroportos perto do destino testados na busca de 3 trechos (menos que os 3 da de 2 trechos, pra não multiplicar demais o tempo)

export const MAX_ARRIVE_BY_DAYS = 7; // limite pra não explodir o número de buscas

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function endOfDay(dateStr: string): number {
  return new Date(`${dateStr}T23:59:59`).getTime();
}

// Todas as datas entre `from` e `to` (inclusive), limitado a MAX_ARRIVE_BY_DAYS
// dias pra não gerar buscas demais.
function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  let cursor = from;
  for (let i = 0; i <= MAX_ARRIVE_BY_DAYS && cursor <= to; i++) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function oneWayRoute(
  base: FlightRoute,
  origin: string,
  destination: string,
  departDate: string
): FlightRoute {
  return { ...base, origin, destination, departDate, tripType: "oneway", returnDate: undefined };
}

/** Verifica se o intervalo entre duas pernas é uma conexão válida. */
function isValidConnection(
  arriveAtMs: number,
  departAtMs: number,
  finalArriveAtMs: number | undefined,
  maxArriveAtMs: number | undefined
): boolean {
  const connectionMs = departAtMs - arriveAtMs;
  if (connectionMs < MIN_CONNECTION_MS) return false;

  if (maxArriveAtMs === undefined) {
    return connectionMs <= MAX_TIGHT_CONNECTION_MS;
  }
  return finalArriveAtMs === undefined || finalArriveAtMs <= maxArriveAtMs;
}

/**
 * Busca de tarifa combinada com 1 conexão: origem -> aeroporto próximo do
 * destino -> destino. Sem `route.arriveBy`, só aceita conexão apertada
 * (1h30-12h no mesmo dia). Com `route.arriveBy`, aceita ficar dias na
 * cidade de conexão (stopover), contanto que chegue no destino até essa
 * data.
 */
async function findBestOneStopCombo(route: FlightRoute): Promise<ComboResult | undefined> {
  const candidates = findNearestAirports(route.destination, CANDIDATE_COUNT).filter(
    (a) => a.iata !== route.origin && a.iata !== route.destination
  );

  let best: ComboResult | undefined;
  const maxArriveAtMs = route.arriveBy ? endOfDay(route.arriveBy) : undefined;

  for (const candidate of candidates) {
    const leg1Route = oneWayRoute(route, route.origin, candidate.iata, route.departDate);

    let leg1Options: FlightOption[];
    try {
      leg1Options = await scrapeFlightOptions(leg1Route);
    } catch {
      continue;
    }

    const arrivalDates = [...new Set(leg1Options.map((o) => o.arriveAt.slice(0, 10)))];
    const earliestArrival = arrivalDates.sort()[0];
    const leg2SearchDates = route.arriveBy ? dateRange(earliestArrival, route.arriveBy) : arrivalDates;

    const leg2Options: FlightOption[] = [];
    const leg2UrlByDate = new Map<string, string>();
    for (const date of leg2SearchDates) {
      const leg2Route = oneWayRoute(route, candidate.iata, route.destination, date);
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
        const finalArriveAtMs = new Date(leg2.arriveAt).getTime();
        if (!isValidConnection(arriveAtMs, departAtMs, finalArriveAtMs, maxArriveAtMs)) continue;

        const totalPrice = leg1.price + leg2.price;
        if (!best || totalPrice < best.totalPrice) {
          best = {
            legs: [
              { from: route.origin, to: candidate.iata, ...leg1, url: leg1Url },
              {
                from: candidate.iata,
                to: route.destination,
                ...leg2,
                url: leg2UrlByDate.get(leg2.departAt.slice(0, 10)) ?? leg1Url,
              },
            ],
            totalPrice,
            currency: leg1.currency,
          };
        }
      }
    }
  }

  return best;
}

/**
 * Busca de tarifa combinada com 2 conexões: origem -> hub de longo curso ->
 * aeroporto próximo do destino -> destino. Só considera conexão apertada
 * (1h30-12h) nas duas trocas — não combina com a janela de stopover do
 * `arriveBy`, pra manter o número de buscas administrável.
 */
async function findBestTwoStopCombo(route: FlightRoute): Promise<ComboResult | undefined> {
  const candidates = findNearestAirports(route.destination, HUB_CANDIDATE_COUNT).filter(
    (a) => a.iata !== route.origin && a.iata !== route.destination
  );

  let best: ComboResult | undefined;

  for (const hub of HUB_AIRPORTS) {
    if (hub === route.origin || hub === route.destination) continue;

    const legARoute = oneWayRoute(route, route.origin, hub, route.departDate);
    let legAOptions: FlightOption[];
    try {
      legAOptions = await scrapeFlightOptions(legARoute);
    } catch {
      continue;
    }
    const legAUrl = buildSearchUrl(legARoute);
    const legAArrivalDates = [...new Set(legAOptions.map((o) => o.arriveAt.slice(0, 10)))];

    for (const candidate of candidates) {
      if (candidate.iata === hub) continue;

      const legBUrlByDate = new Map<string, string>();
      const legBOptions: FlightOption[] = [];
      for (const date of legAArrivalDates) {
        const legBRoute = oneWayRoute(route, hub, candidate.iata, date);
        legBUrlByDate.set(date, buildSearchUrl(legBRoute));
        try {
          legBOptions.push(...(await scrapeFlightOptions(legBRoute)));
        } catch {
          // sem voo do hub pro candidato nessa data, tudo bem
        }
      }
      if (legBOptions.length === 0) continue;

      const legBArrivalDates = [...new Set(legBOptions.map((o) => o.arriveAt.slice(0, 10)))];

      const legCUrlByDate = new Map<string, string>();
      const legCOptions: FlightOption[] = [];
      for (const date of legBArrivalDates) {
        const legCRoute = oneWayRoute(route, candidate.iata, route.destination, date);
        legCUrlByDate.set(date, buildSearchUrl(legCRoute));
        try {
          legCOptions.push(...(await scrapeFlightOptions(legCRoute)));
        } catch {
          // sem voo do candidato pro destino nessa data, tudo bem
        }
      }
      if (legCOptions.length === 0) continue;

      for (const legA of legAOptions) {
        const legAArriveMs = new Date(legA.arriveAt).getTime();
        for (const legB of legBOptions) {
          const legBDepartMs = new Date(legB.departAt).getTime();
          if (!isValidConnection(legAArriveMs, legBDepartMs, undefined, undefined)) continue;

          const legBArriveMs = new Date(legB.arriveAt).getTime();
          for (const legC of legCOptions) {
            const legCDepartMs = new Date(legC.departAt).getTime();
            if (!isValidConnection(legBArriveMs, legCDepartMs, undefined, undefined)) continue;

            const totalPrice = legA.price + legB.price + legC.price;
            if (!best || totalPrice < best.totalPrice) {
              best = {
                legs: [
                  { from: route.origin, to: hub, ...legA, url: legAUrl },
                  {
                    from: hub,
                    to: candidate.iata,
                    ...legB,
                    url: legBUrlByDate.get(legB.departAt.slice(0, 10)) ?? legAUrl,
                  },
                  {
                    from: candidate.iata,
                    to: route.destination,
                    ...legC,
                    url: legCUrlByDate.get(legC.departAt.slice(0, 10)) ?? legAUrl,
                  },
                ],
                totalPrice,
                currency: legA.currency,
              };
            }
          }
        }
      }
    }
  }

  return best;
}

/**
 * Procura uma "tarifa combinada": em vez de um voo direto origem -> destino,
 * busca voos separados que juntos podem sair mais barato. Sempre tenta 1
 * conexão (origem -> perto do destino -> destino); se `route.tryThreeLegs`
 * estiver ativado, também tenta 2 conexões via um hub de longo curso — bem
 * mais lento, então só ativa se a de 1 conexão não bastar.
 *
 * Retorna undefined se nenhuma combinação viável for encontrada.
 */
export async function findBestCombo(route: FlightRoute): Promise<ComboResult | undefined> {
  const oneStop = await findBestOneStopCombo(route);

  if (!route.tryThreeLegs) return oneStop;

  const twoStop = await findBestTwoStopCombo(route);
  if (!twoStop) return oneStop;
  if (!oneStop) return twoStop;
  return twoStop.totalPrice < oneStop.totalPrice ? twoStop : oneStop;
}
