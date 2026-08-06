import { execSync } from "node:child_process";

// No Vercel só o dashboard roda (o scraper fica no worker local), então não
// faz sentido baixar o Chromium inteiro do Playwright durante o build lá.
if (process.env.VERCEL) {
  console.log("Build no Vercel detectado: pulando download do Chromium do Playwright.");
  process.exit(0);
}

execSync("npx playwright install chromium", { stdio: "inherit" });
