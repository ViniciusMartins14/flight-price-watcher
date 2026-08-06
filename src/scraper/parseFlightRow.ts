export interface FlightOption {
  price: number;
  currency: string;
  departAt: string; // ISO
  arriveAt: string; // ISO
}

const PRICE_RE = /(?:Pre[cç]o total a partir de|A partir de) ([\d.,]+) Reais brasileiros/;
const TIMES_RE =
  /às (\d{2}:\d{2}) do dia [^,]+,\s*(\w+)\s*(\d+) e chega no aeroporto .+? às (\d{2}:\d{2}) do dia [^,]+,\s*(\w+)\s*(\d+)\./;

const MONTHS = [
  "janeiro",
  "fevereiro",
  "marco",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

function monthIndex(name: string): number {
  const normalized = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  return MONTHS.indexOf(normalized);
}

function parsePriceBRL(text: string): number {
  const normalized = text.replace(/\./g, "").replace(",", ".");
  return parseFloat(normalized);
}

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

// A página só dá dia+mês (sem ano). Assume o ano da data buscada, e só pula
// pro ano seguinte se a data calculada ficar bem antes da data de busca —
// o caso de uma viagem que cruza a virada do ano (ex: busca em dezembro,
// voo cai em janeiro).
function buildDateTime(baseDate: Date, month: number, day: number, hour: number, minute: number): Date {
  const year = baseDate.getFullYear();
  const candidate = new Date(year, month, day, hour, minute);
  if (candidate.getTime() < baseDate.getTime() - FIVE_DAYS_MS) {
    return new Date(year + 1, month, day, hour, minute);
  }
  return candidate;
}

/**
 * Faz o parsing do aria-label de uma linha de voo do Google Voos, que já
 * vem com tudo que precisamos num só texto, ex:
 * "A partir de 5962 Reais brasileiros. Voo da Turkish Airlines com 1
 * parada. Sai do aeroporto ... às 04:10 do dia sábado, janeiro 2 e chega
 * no aeroporto ... às 08:30 do dia domingo, janeiro 3. Duração total: ..."
 */
export function parseFlightRowLabel(ariaLabel: string, baseDate: Date): FlightOption | undefined {
  const priceMatch = ariaLabel.match(PRICE_RE);
  const timesMatch = ariaLabel.match(TIMES_RE);
  if (!priceMatch || !timesMatch) return undefined;

  const price = parsePriceBRL(priceMatch[1]);
  if (!Number.isFinite(price) || price <= 0) return undefined;

  const [, depTime, depMonthName, depDay, arrTime, arrMonthName, arrDay] = timesMatch;
  const depMonth = monthIndex(depMonthName);
  const arrMonth = monthIndex(arrMonthName);
  if (depMonth === -1 || arrMonth === -1) return undefined;

  const [depHour, depMin] = depTime.split(":").map(Number);
  const [arrHour, arrMin] = arrTime.split(":").map(Number);

  const departAt = buildDateTime(baseDate, depMonth, Number(depDay), depHour, depMin);
  const arriveAt = buildDateTime(baseDate, arrMonth, Number(arrDay), arrHour, arrMin);

  return {
    price,
    currency: "BRL",
    departAt: departAt.toISOString(),
    arriveAt: arriveAt.toISOString(),
  };
}
