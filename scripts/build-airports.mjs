import { readFileSync, writeFileSync, unlinkSync } from "node:fs";

const raw = readFileSync("scripts/airports-raw.csv", "utf-8");

// Parser simples de CSV que respeita campos entre aspas com vírgulas dentro.
function parseCsvLine(line) {
  const fields = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

const lines = raw.split("\n").filter(Boolean);
const header = parseCsvLine(lines[0]);
const idx = Object.fromEntries(header.map((h, i) => [h, i]));

const airports = [];
for (let i = 1; i < lines.length; i++) {
  const fields = parseCsvLine(lines[i]);
  const type = fields[idx.type];
  const iata = fields[idx.iata_code]?.trim();
  if (!iata) continue;
  if (type !== "large_airport" && type !== "medium_airport") continue;

  airports.push({
    iata,
    name: fields[idx.name],
    city: fields[idx.municipality] || "",
    country: fields[idx.iso_country] || "",
    large: type === "large_airport",
  });
}

// Remove duplicatas de código IATA (mantém a primeira ocorrência).
const seen = new Set();
const deduped = airports.filter((a) => {
  if (seen.has(a.iata)) return false;
  seen.add(a.iata);
  return true;
});

writeFileSync("src/airports.json", JSON.stringify(deduped));
console.log(`Aeroportos incluídos: ${deduped.length}`);

unlinkSync("scripts/airports-raw.csv");
