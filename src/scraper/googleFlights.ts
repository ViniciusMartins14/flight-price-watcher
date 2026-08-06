import { chromium, type Page } from "playwright";
import { config } from "../config.js";
import type { FlightRoute } from "../types.js";
import { buildSearchUrl } from "./googleFlightsUrl.js";
import { parseFlightRowLabel, type FlightOption } from "./parseFlightRow.js";

export interface ScrapedFare {
  price: number;
  currency: string;
  url: string;
}

async function loadResultsPage(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

  // Espera até algum preço em R$ aparecer no texto da página, ou até dar timeout.
  await page
    .waitForFunction(() => /R\$\s?\d/.test(document.body.innerText), undefined, {
      timeout: 30000,
    })
    .catch(() => {
      // segue mesmo assim; a extração abaixo vai falhar com mensagem clara se não achar preços
    });

  // Por padrão o Google Voos abre na aba "Melhor opção" (custo-benefício).
  // Trocamos para a aba "Menores preços" antes de ler os valores, já que
  // essa troca só funciona com um clique real na página (não dá pra forçar
  // isso direto pela URL).
  await page
    .locator('[role="tab"]')
    .nth(1)
    .click({ timeout: 5000 })
    .then(() => page.waitForTimeout(1500))
    .catch(() => {
      // se a aba não existir (ex: sem resultados), segue com o que já carregou
    });

  // Expande a lista de voos, se houver um botão "Mostrar mais voos", para
  // não deixar de fora opções mais baratas que só aparecem após o clique.
  await page
    .getByText("Mostrar mais voos", { exact: false })
    .first()
    .click({ timeout: 5000 })
    .then(() => page.waitForTimeout(1000))
    .catch(() => {
      // botão pode não existir se já estiverem todos os voos visíveis
    });
}

async function extractFlightRowLabels(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('div[role="link"][aria-label*="Reais brasileiros"]')).map(
      (el) => el.getAttribute("aria-label") || ""
    )
  );
}

async function withResultsPage<T>(
  url: string,
  fn: (page: Page) => Promise<T>
): Promise<T> {
  const browser = await chromium.launch({ headless: config.headlessScraper });
  try {
    const context = await browser.newContext({
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
      viewport: { width: 1366, height: 900 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    await loadResultsPage(page, url);
    return await fn(page);
  } finally {
    await browser.close();
  }
}

/**
 * Faz scraping do Google Voos para uma rota e retorna todas as opções de
 * voo encontradas (preço + horário de partida/chegada), usadas para
 * montar buscas de tarifa combinada (dois trechos separados).
 */
export async function scrapeFlightOptions(route: FlightRoute): Promise<FlightOption[]> {
  const url = buildSearchUrl(route);
  const baseDate = new Date(`${route.departDate}T00:00:00`);

  return withResultsPage(url, async (page) => {
    const labels = await extractFlightRowLabels(page);
    const options = labels
      .map((label) => parseFlightRowLabel(label, baseDate))
      .filter((o): o is FlightOption => o !== undefined);

    if (options.length === 0) {
      throw new Error(
        "Nenhum preço encontrado na página do Google Voos. O layout pode ter mudado ou a busca foi bloqueada."
      );
    }

    return options;
  });
}

/**
 * Faz scraping do Google Voos para uma rota e retorna o menor preço
 * encontrado na página de resultados. Não usa a API oficial (não existe
 * uma gratuita); depende do texto renderizado (aria-label), não de classes
 * CSS, para resistir a mudanças de layout do Google.
 */
export async function scrapeCheapestFare(route: FlightRoute): Promise<ScrapedFare> {
  const options = await scrapeFlightOptions(route);
  const cheapest = Math.min(...options.map((o) => o.price));
  // Usa a URL original (sem o parâmetro de aba/ordenação que o clique adiciona),
  // já que esse parâmetro não tem efeito quando alguém abre o link do zero.
  return { price: cheapest, currency: "BRL", url: buildSearchUrl(route) };
}
