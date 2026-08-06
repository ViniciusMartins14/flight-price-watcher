import type { FlightRoute } from "../types.js";

/**
 * Constrói a URL de resultados do Google Voos (formato "tfs=") reproduzindo
 * o mesmo protocolo binário (protobuf) que o próprio Google Voos gera ao
 * fazer uma busca pela interface. Diferente da busca por linguagem natural
 * (`?q=...`), essa URL é estável: sempre abre direto nos resultados, tanto
 * para o scraper quanto para quem clicar no link depois.
 */

function varint(n: number | bigint): Buffer {
  const bytes: number[] = [];
  let v = BigInt(n);
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v !== 0n) b |= 0x80;
    bytes.push(b);
  } while (v !== 0n);
  return Buffer.from(bytes);
}

function tag(fieldNumber: number, wireType: number): Buffer {
  return varint((fieldNumber << 3) | wireType);
}

function lenDelim(fieldNumber: number, content: Buffer): Buffer {
  return Buffer.concat([tag(fieldNumber, 2), varint(content.length), content]);
}

function varintField(fieldNumber: number, value: number): Buffer {
  return Buffer.concat([tag(fieldNumber, 0), varint(value)]);
}

function airport(code: string): Buffer {
  return Buffer.concat([varintField(1, 1), lenDelim(2, Buffer.from(code, "ascii"))]);
}

function flightDataLeg(date: string, origin: string, destination: string): Buffer {
  return Buffer.concat([
    lenDelim(2, Buffer.from(date, "ascii")),
    lenDelim(13, airport(origin)),
    lenDelim(14, airport(destination)),
  ]);
}

// Representa o valor -1 (sem limite) em varint de 64 bits, como o Google Voos envia.
const NO_LIMIT_VARINT = Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]);

interface Leg {
  date: string;
  origin: string;
  destination: string;
}

function buildTfs(legs: Leg[], tripTypeCode: 1 | 2): string {
  const parts: Buffer[] = [
    varintField(1, 28),
    varintField(2, 2),
    ...legs.map((leg) => lenDelim(3, flightDataLeg(leg.date, leg.origin, leg.destination))),
    varintField(8, 1), // 1 adulto
    varintField(9, 1), // classe econômica
    varintField(14, 1),
    lenDelim(16, Buffer.concat([tag(1, 0), NO_LIMIT_VARINT])),
    varintField(19, tripTypeCode), // 1 = ida e volta, 2 = só ida
  ];
  return Buffer.concat(parts).toString("base64url");
}

export function buildSearchUrl(route: FlightRoute): string {
  const isRoundtrip = route.tripType === "roundtrip" && !!route.returnDate;

  const legs: Leg[] = isRoundtrip
    ? [
        { date: route.departDate, origin: route.origin, destination: route.destination },
        { date: route.returnDate as string, origin: route.destination, destination: route.origin },
      ]
    : [{ date: route.departDate, origin: route.origin, destination: route.destination }];

  const tfs = buildTfs(legs, isRoundtrip ? 1 : 2);
  const params = new URLSearchParams({ tfs, hl: "pt-BR", gl: "BR", curr: "BRL" });
  return `https://www.google.com/travel/flights/search?${params.toString()}`;
}
