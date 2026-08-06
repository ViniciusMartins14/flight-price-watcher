import { scrapeCheapestFare } from "./googleFlights.js";
import type { FlightRoute } from "../types.js";

const [, , origin, destination, departDate, returnDate] = process.argv;

if (!origin || !destination || !departDate) {
  console.error(
    "Uso: npm run test-scrape -- <ORIGEM> <DESTINO> <YYYY-MM-DD> [YYYY-MM-DD volta]"
  );
  process.exit(1);
}

const route: FlightRoute = {
  id: "test",
  userId: "test",
  label: "teste",
  origin,
  destination,
  tripType: returnDate ? "roundtrip" : "oneway",
  departDate,
  returnDate,
  createdAt: new Date().toISOString(),
};

console.log(`Buscando ${origin} -> ${destination} em ${departDate}...`);
const fare = await scrapeCheapestFare(route);
console.log(`Menor preço encontrado: ${fare.currency} ${fare.price}`);
console.log(`URL: ${fare.url}`);
