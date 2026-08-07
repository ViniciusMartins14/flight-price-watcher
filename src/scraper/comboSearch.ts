import { findNearestAirports } from "../airports.js";
import type { ComboLeg, ComboResult, FlightRoute } from "../types.js";
import { scrapeCheapestFare, scrapeFlightOptions, type ScrapedFare } from "./googleFlights.js";
import { buildSearchUrl } from "./googleFlightsUrl.js";
import type { FlightOption } from "./parseFlightRow.js";

const MIN_CONNECTION_MS = 90 * 60 * 1000; // 1h30 — tempo mínimo realista pra trocar de voo
const MAX_TIGHT_CONNECTION_MS = 12 * 60 * 60 * 1000; // 12h — teto usado só quando NÃO há arriveBy
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

// Datas em que buscar o próximo trecho, a partir das datas de chegada do
// trecho anterior. Sem data-alvo de chegada, só essas mesmas datas (conexão
// apertada no mesmo dia). Com data-alvo, cobre toda a janela até lá — a
// pessoa topa esperar mais tempo (inclusive dias) nesse ponto da viagem.
function nextLegSearchDates(arrivalDates: string[], arriveBy: string | undefined): string[] {
  if (!arriveBy) return arrivalDates;
  const earliest = [...arrivalDates].sort()[0];
  return dateRange(earliest, arriveBy);
}

// Só o mínimo pra trocar de voo — sem teto, usado quando a pessoa topa
// esperar mais tempo (conexão longa/stopover).
function hasMinimumConnection(arriveAtMs: number, departAtMs: number): boolean {
  return departAtMs - arriveAtMs >= MIN_CONNECTION_MS;
}

// Conexão apertada de verdade: mínimo pra trocar de voo, sem passar de 12h.
function isTightConnection(arriveAtMs: number, departAtMs: number): boolean {
  const connectionMs = departAtMs - arriveAtMs;
  return connectionMs >= MIN_CONNECTION_MS && connectionMs <= MAX_TIGHT_CONNECTION_MS;
}

/**
 * Verifica se a troca entre duas pernas é válida. `isFinalLeg` indica se a
 * perna que está chegando é a chegada de verdade no destino final da busca
 * (não uma escala intermediária) — só nesse caso a data-alvo de chegada
 * (`maxArriveAtMs`) é conferida.
 */
function isValidConnection(
  arriveAtMs: number,
  departAtMs: number,
  finalArriveAtMs: number | undefined,
  maxArriveAtMs: number | undefined,
  isFinalLeg: boolean
): boolean {
  if (maxArriveAtMs === undefined) {
    return isTightConnection(arriveAtMs, departAtMs);
  }
  if (!hasMinimumConnection(arriveAtMs, departAtMs)) return false;
  if (!isFinalLeg) return true;
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
    const leg2SearchDates = nextLegSearchDates(arrivalDates, route.arriveBy);

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
        if (!isValidConnection(arriveAtMs, departAtMs, finalArriveAtMs, maxArriveAtMs, true)) continue;

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
 * aeroporto próximo do destino -> destino. Segue a mesma regra do
 * `route.arriveBy` da busca de 1 conexão: sem data-alvo, exige conexão
 * apertada (1h30-12h) nas duas trocas; com data-alvo, aceita esperar dias
 * em qualquer uma das escalas, contanto que a chegada final no destino
 * fique dentro da data desejada.
 */
async function findBestTwoStopCombo(route: FlightRoute): Promise<ComboResult | undefined> {
  const candidates = findNearestAirports(route.destination, HUB_CANDIDATE_COUNT).filter(
    (a) => a.iata !== route.origin && a.iata !== route.destination
  );

  let best: ComboResult | undefined;
  const maxArriveAtMs = route.arriveBy ? endOfDay(route.arriveBy) : undefined;

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
    const legBSearchDates = nextLegSearchDates(legAArrivalDates, route.arriveBy);

    for (const candidate of candidates) {
      if (candidate.iata === hub) continue;

      const legBUrlByDate = new Map<string, string>();
      const legBOptions: FlightOption[] = [];
      for (const date of legBSearchDates) {
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
      const legCSearchDates = nextLegSearchDates(legBArrivalDates, route.arriveBy);

      const legCUrlByDate = new Map<string, string>();
      const legCOptions: FlightOption[] = [];
      for (const date of legCSearchDates) {
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
          if (!isValidConnection(legAArriveMs, legBDepartMs, undefined, maxArriveAtMs, false)) continue;

          const legBArriveMs = new Date(legB.arriveAt).getTime();
          for (const legC of legCOptions) {
            const legCDepartMs = new Date(legC.departAt).getTime();
            const legCArriveMs = new Date(legC.arriveAt).getTime();
            if (!isValidConnection(legBArriveMs, legCDepartMs, legCArriveMs, maxArriveAtMs, true)) continue;

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
 * Busca de tarifa combinada pra uma perna só de ida: tenta 1 conexão
 * (origem -> perto do destino -> destino) e, se `route.tryThreeLegs`
 * estiver ativado, também 2 conexões via um hub de longo curso — bem
 * mais lento, então só ativa se a de 1 conexão não bastar.
 */
async function findBestOneWayCombo(route: FlightRoute): Promise<ComboResult | undefined> {
  const oneStop = await findBestOneStopCombo(route);

  if (!route.tryThreeLegs) return oneStop;

  const twoStop = await findBestTwoStopCombo(route);
  if (!twoStop) return oneStop;
  if (!oneStop) return twoStop;
  return twoStop.totalPrice < oneStop.totalPrice ? twoStop : oneStop;
}

function fareAsLeg(from: string, to: string, fare: ScrapedFare): ComboLeg {
  return {
    from,
    to,
    price: fare.price,
    currency: fare.currency,
    departAt: fare.departAt,
    arriveAt: fare.arriveAt,
    url: fare.url,
  };
}

/**
 * Pra ida e volta, trata cada sentido como uma busca independente: acha a
 * melhor opção (direta ou combinada) pra ida, a melhor opção pra volta, e
 * soma os dois totais. `arriveBy` limita a ida; `returnArriveBy` limita a
 * volta — são datas diferentes, então não dá pra reaproveitar o mesmo
 * campo. Roda ida e volta em paralelo pra não dobrar o tempo de espera.
 */
async function findBestRoundTripCombo(route: FlightRoute): Promise<ComboResult | undefined> {
  if (!route.returnDate) return undefined;

  const outboundRoute = oneWayRoute(route, route.origin, route.destination, route.departDate);
  const returnRoute = {
    ...oneWayRoute(route, route.destination, route.origin, route.returnDate),
    arriveBy: route.returnArriveBy,
  };

  const [outboundFareResult, returnFareResult, outboundCombo, returnCombo] = await Promise.all([
    scrapeCheapestFare(outboundRoute).catch(() => undefined),
    scrapeCheapestFare(returnRoute).catch(() => undefined),
    findBestOneWayCombo(outboundRoute),
    findBestOneWayCombo(returnRoute),
  ]);

  if (!outboundFareResult && !outboundCombo) return undefined;
  if (!returnFareResult && !returnCombo) return undefined;

  const outboundLegs =
    outboundCombo && (!outboundFareResult || outboundCombo.totalPrice < outboundFareResult.price)
      ? outboundCombo.legs
      : outboundFareResult
        ? [fareAsLeg(route.origin, route.destination, outboundFareResult)]
        : (outboundCombo as ComboResult).legs;

  const returnLegs =
    returnCombo && (!returnFareResult || returnCombo.totalPrice < returnFareResult.price)
      ? returnCombo.legs
      : returnFareResult
        ? [fareAsLeg(route.destination, route.origin, returnFareResult)]
        : (returnCombo as ComboResult).legs;

  const legs = [...outboundLegs, ...returnLegs];
  return {
    legs,
    totalPrice: legs.reduce((sum, leg) => sum + leg.price, 0),
    currency: legs[0]?.currency ?? "BRL",
  };
}

/**
 * Procura uma "tarifa combinada": em vez do voo/pacote direto, busca voos
 * separados que juntos podem sair mais barato. Pra ida e volta, faz isso
 * pros dois sentidos independentemente e soma.
 *
 * Retorna undefined se nenhuma combinação viável for encontrada.
 */
export async function findBestCombo(route: FlightRoute): Promise<ComboResult | undefined> {
  if (route.tripType === "roundtrip") {
    return findBestRoundTripCombo(route);
  }
  return findBestOneWayCombo(route);
}
