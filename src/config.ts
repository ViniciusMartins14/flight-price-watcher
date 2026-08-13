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
  mongodbUri: process.env.MONGODB_URI ?? "",
  mongodbDbName: process.env.MONGODB_DB_NAME ?? "flight_price_watcher",
  jwtSecret: process.env.JWT_SECRET ?? "",
  isProduction: process.env.NODE_ENV === "production" || !!process.env.VERCEL,
  // No Vercel o Chromium do Playwright não é baixado no build (ver
  // scripts/postinstall.mjs); o scraper usa @sparticuz/chromium nesse caso.
  isVercel: !!process.env.VERCEL,
};

export function assertMongoConfigured(): void {
  required("MONGODB_URI", config.mongodbUri || undefined);
}

export function assertJwtConfigured(): void {
  required("JWT_SECRET", config.jwtSecret || undefined);
}

export function assertWhatsappConfigured(): void {
  required("WHATSAPP_TARGET_NUMBER", config.whatsappTargetNumber || undefined);
}
