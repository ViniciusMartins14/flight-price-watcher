import { Router } from "express";
import { resolveAirportCode, searchAirports } from "../airports.js";
import { requireAuth } from "../auth.js";
import { config } from "../config.js";
import { addRoute, getRoute, listRoutesForUser, removeRoute, setChecking } from "../db.js";
import { checkRoute } from "../scheduler.js";
import { MAX_ARRIVE_BY_DAYS } from "../scraper/comboSearch.js";
import { asyncHandler } from "./asyncHandler.js";

export const apiRouter = Router();

apiRouter.use(requireAuth);

// Valida uma data-alvo de chegada (arriveBy/returnArriveBy) contra a data
// base do trecho a que ela se refere (departDate pra ida, returnDate pra
// volta). Retorna a mensagem de erro, ou undefined se estiver tudo certo.
function validateArriveByDate(value: string, baseDate: string, label: string): string | undefined {
  const base = new Date(`${baseDate}T00:00:00`);
  const target = new Date(`${value}T00:00:00`);
  if (target < base) {
    return `${label} não pode ser antes da data de partida desse trecho.`;
  }
  const maxDate = new Date(base);
  maxDate.setDate(maxDate.getDate() + MAX_ARRIVE_BY_DAYS);
  if (target > maxDate) {
    return `${label} não pode ser mais de ${MAX_ARRIVE_BY_DAYS} dias depois da partida desse trecho.`;
  }
  return undefined;
}

apiRouter.get("/airports", (req, res) => {
  const q = String(req.query.q ?? "");
  res.json(searchAirports(q));
});

apiRouter.get(
  "/routes",
  asyncHandler(async (req, res) => {
    res.json(await listRoutesForUser(req.userId as string));
  })
);

apiRouter.post(
  "/routes",
  asyncHandler(async (req, res) => {
    const {
      label,
      origin,
      destination,
      departDate,
      returnDate,
      tripType,
      whatsappNumber,
      combineStops,
      arriveBy,
      returnArriveBy,
      tryThreeLegs,
    } = req.body ?? {};

    if (!origin || !destination || !departDate) {
      res.status(400).json({ error: "origin, destination e departDate são obrigatórios." });
      return;
    }

    if (tripType !== "oneway" && tripType !== "roundtrip") {
      res.status(400).json({ error: "tripType deve ser 'oneway' ou 'roundtrip'." });
      return;
    }

    if (tripType === "roundtrip" && !returnDate) {
      res.status(400).json({ error: "returnDate é obrigatório quando tripType é 'roundtrip'." });
      return;
    }

    if (tryThreeLegs && !combineStops) {
      res.status(400).json({
        error: "tryThreeLegs só faz sentido com combineStops ativado.",
      });
      return;
    }

    if ((arriveBy || returnArriveBy) && !combineStops) {
      res.status(400).json({
        error: "arriveBy/returnArriveBy só fazem sentido com combineStops ativado.",
      });
      return;
    }

    if (returnArriveBy && tripType !== "roundtrip") {
      res.status(400).json({
        error: "returnArriveBy só faz sentido em rotas de ida e volta.",
      });
      return;
    }

    let cleanedArriveBy: string | undefined;
    if (arriveBy) {
      const error = validateArriveByDate(arriveBy, departDate, "arriveBy");
      if (error) {
        res.status(400).json({ error });
        return;
      }
      cleanedArriveBy = arriveBy;
    }

    let cleanedReturnArriveBy: string | undefined;
    if (returnArriveBy) {
      const error = validateArriveByDate(returnArriveBy, returnDate, "returnArriveBy");
      if (error) {
        res.status(400).json({ error });
        return;
      }
      cleanedReturnArriveBy = returnArriveBy;
    }

    const originAirport = resolveAirportCode(String(origin));
    if (!originAirport) {
      res.status(400).json({
        error: `Não encontramos um aeroporto para "${origin}". Tente o nome da cidade ou o código IATA (ex: GRU).`,
      });
      return;
    }

    const destinationAirport = resolveAirportCode(String(destination));
    if (!destinationAirport) {
      res.status(400).json({
        error: `Não encontramos um aeroporto para "${destination}". Tente o nome da cidade ou o código IATA (ex: LIS).`,
      });
      return;
    }

    let cleanedWhatsappNumber: string | undefined;
    if (whatsappNumber) {
      const digits = String(whatsappNumber).replace(/\D/g, "");
      if (digits.length < 10) {
        res.status(400).json({
          error:
            "whatsappNumber inválido. Use o formato internacional (código do país + DDD + número).",
        });
        return;
      }
      cleanedWhatsappNumber = digits;
    }

    const state = await addRoute({
      userId: req.userId as string,
      label: label || `${originAirport.iata} -> ${destinationAirport.iata}`,
      origin: originAirport.iata,
      destination: destinationAirport.iata,
      tripType,
      departDate,
      returnDate: tripType === "roundtrip" ? returnDate : undefined,
      whatsappNumber: cleanedWhatsappNumber,
      combineStops: Boolean(combineStops),
      arriveBy: cleanedArriveBy,
      returnArriveBy: cleanedReturnArriveBy,
      tryThreeLegs: Boolean(tryThreeLegs),
    });

    res.status(201).json(state);
  })
);

apiRouter.delete(
  "/routes/:id",
  asyncHandler(async (req, res) => {
    const removed = await removeRoute(req.params.id, req.userId as string);
    if (!removed) {
      res.status(404).json({ error: "Rota não encontrada." });
      return;
    }
    res.status(204).end();
  })
);

apiRouter.post(
  "/routes/:id/check",
  asyncHandler(async (req, res) => {
    const routeId = req.params.id;
    const state = await getRoute(routeId);
    if (!state || state.route.userId !== req.userId) {
      res.status(404).json({ error: "Rota não encontrada." });
      return;
    }

    // Dispara a checagem em background e responde na hora: buscas com
    // tarifa combinada podem demorar bastante (várias buscas sequenciais),
    // então não faz sentido travar a requisição esperando terminar. O
    // frontend acompanha o progresso via GET /routes, olhando o campo
    // `checking` de cada rota.
    await setChecking(routeId, true);
    const checkPromise = checkRoute(routeId).catch((err) => {
      console.error(`Erro ao checar rota ${routeId} em background:`, err);
    });

    // Na Vercel a função pode ser encerrada assim que a resposta é
    // enviada; waitUntil garante que a checagem continue rodando até o
    // fim mesmo depois do response.
    if (config.isVercel) {
      const { waitUntil } = await import("@vercel/functions");
      waitUntil(checkPromise);
    }

    res.status(202).json(await getRoute(routeId));
  })
);

apiRouter.use(
  (err: unknown, _req: unknown, res: import("express").Response, _next: (err?: unknown) => void) => {
    console.error("Erro na API:", err);
    res.status(500).json({ error: "Erro interno do servidor." });
  }
);
