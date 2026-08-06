import airportsData from "./airports.json";

export interface Airport {
  iata: string;
  name: string;
  city: string;
  country: string;
  large: boolean;
}

const airports = airportsData as Airport[];
const byIata = new Map(airports.map((a) => [a.iata.toUpperCase(), a]));

// A base de aeroportos usa nomes de cidade em inglês. Sem isso, buscar por
// "Roma", "Londres" ou "Nova York" (nomes comuns em português) não bate com
// nada, mesmo existindo o aeroporto — só funcionava digitando o nome em
// inglês ou o código IATA.
const CITY_ALIASES: Record<string, string> = {
  roma: "rome",
  londres: "london",
  "nova york": "new york",
  "nova iorque": "new york",
  moscou: "moscow",
  moscovo: "moscow",
  praga: "prague",
  viena: "vienna",
  varsovia: "warsaw",
  copenhague: "copenhagen",
  genebra: "geneva",
  munique: "munich",
  colonia: "cologne",
  haia: "the hague",
  bruxelas: "brussels",
  atenas: "athens",
  pequim: "beijing",
  toquio: "tokyo",
  seul: "seoul",
  bangcoc: "bangkok",
  "cidade do mexico": "mexico city",
  "nova deli": "new delhi",
  meca: "mecca",
  florenca: "florence",
  veneza: "venice",
  napoles: "naples",
  turim: "turin",
  milao: "milan",
  zurique: "zurich",
  estocolmo: "stockholm",
  helsinque: "helsinki",
  lisboa: "lisbon",
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // remove acentos
}

function applyAlias(query: string): string {
  const normalized = normalize(query);
  return CITY_ALIASES[normalized] ?? normalized;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Casa "rome" com "Rome-Fiumicino" mas NÃO com "Aerodrome" (que contém
// "rome" como substring, sem ser a palavra "rome" de fato).
function hasWholeWordMatch(haystack: string, term: string): boolean {
  if (!term) return false;
  return new RegExp(`\\b${escapeRegex(term)}\\b`, "i").test(haystack);
}

// Quando várias opções batem igual (ex: "Rome" existe nos EUA e na Itália),
// prioriza o aeroporto de maior porte — normalmente é o que a pessoa quer.
function pickBest(candidates: Airport[]): Airport | undefined {
  if (candidates.length === 0) return undefined;
  return candidates.find((a) => a.large) ?? candidates[0];
}

function sortByLarge(candidates: Airport[]): Airport[] {
  return [...candidates].sort((a, b) => Number(b.large) - Number(a.large));
}

/**
 * Resolve o que a pessoa digitou (código IATA, nome de cidade em português
 * ou inglês, ou nome do aeroporto) para um código IATA válido. Sem isso, a
 * URL de busca do Google Voos fica quebrada quando alguém digita, por
 * exemplo, "Malta" ou "Roma" em vez do código (MLA, FCO).
 */
export function resolveAirportCode(query: string): Airport | undefined {
  const trimmed = query.trim();
  if (!trimmed) return undefined;

  const upper = trimmed.toUpperCase();
  if (upper.length === 3 && byIata.has(upper)) {
    return byIata.get(upper);
  }

  const term = applyAlias(trimmed);

  const exactCity = pickBest(airports.filter((a) => normalize(a.city) === term));
  if (exactCity) return exactCity;

  const cityStartsWith = pickBest(airports.filter((a) => normalize(a.city).startsWith(term)));
  if (cityStartsWith) return cityStartsWith;

  const nameWholeWord = pickBest(
    airports.filter((a) => hasWholeWordMatch(normalize(a.name), term))
  );
  if (nameWholeWord) return nameWholeWord;

  const cityContains = pickBest(airports.filter((a) => normalize(a.city).includes(term)));
  if (cityContains) return cityContains;

  return undefined;
}

export function searchAirports(query: string, limit = 8): Airport[] {
  const term = applyAlias(query.trim());
  if (term.length < 2) return [];

  // Junta em ordem de relevância (código/cidade exata primeiro) em vez de
  // parar nos primeiros N resultados encontrados na ordem bruta do
  // dataset, que podia enterrar o aeroporto certo atrás de coincidências
  // fracas (ex: nome de aeroporto que só contém a palavra por acaso).
  const exact: Airport[] = [];
  const cityPrefix: Airport[] = [];
  const nameWord: Airport[] = [];
  const cityContains: Airport[] = [];

  for (const airport of airports) {
    const city = normalize(airport.city);
    const name = normalize(airport.name);

    if (airport.iata.toLowerCase() === term || city === term) {
      exact.push(airport);
    } else if (city.startsWith(term)) {
      cityPrefix.push(airport);
    } else if (hasWholeWordMatch(name, term)) {
      nameWord.push(airport);
    } else if (city.includes(term)) {
      cityContains.push(airport);
    }
  }

  return [
    ...sortByLarge(exact),
    ...sortByLarge(cityPrefix),
    ...sortByLarge(nameWord),
    ...sortByLarge(cityContains),
  ].slice(0, limit);
}
