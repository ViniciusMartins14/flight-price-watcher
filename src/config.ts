import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  checkIntervalMinutes: Number(process.env.CHECK_INTERVAL_MINUTES ?? 20),
  whatsappTargetNumber: process.env.WHATSAPP_TARGET_NUMBER ?? "",
  headlessScraper: (process.env.SCRAPER_HEADLESS ?? "true") !== "false",
  dbPath: process.env.DB_PATH ?? "data/db.json",
};

export function assertWhatsappConfigured(): void {
  required("WHATSAPP_TARGET_NUMBER", config.whatsappTargetNumber || undefined);
}
