import { Router } from "express";
import { resolveAirportCode, searchAirports } from "../airports.js";
import { requireAuth } from "../auth.js";
import { addRoute, getRoute, listRoutesForUser, removeRoute } from "../db.js";
import { checkRoute } from "../scheduler.js";
import { MAX_ARRIVE_BY_DAYS } from "../scraper/comboSearch.js";
import { asyncHandler } from "./asyncHandler.js";

export const apiRouter = Router();

apiRouter.use(requireAuth);

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

    if (combineStops && tripType !== "oneway") {
      res.status(400).json({
        error: "Buscar tarifa combinada só é suportado para rotas só de ida, por enquanto.",
      });
      return;
    }

    let cleanedArriveBy: string | undefined;
    if (arriveBy) {
      if (!combineStops) {
        res.status(400).json({
          error: "arriveBy só faz sentido com combineStops ativado.",
        });
        return;
      }
      const maxDate = new Date(`${departDate}T00:00:00`);
      maxDate.setDate(maxDate.getDate() + MAX_ARRIVE_BY_DAYS);
      const arriveByDate = new Date(`${arriveBy}T00:00:00`);
      if (arriveByDate < new Date(`${departDate}T00:00:00`)) {
        res.status(400).json({
          error: "arriveBy não pode ser antes da data de ida.",
        });
        return;
      }
      if (arriveByDate > maxDate) {
        res.status(400).json({
          error: `arriveBy não pode ser mais de ${MAX_ARRIVE_BY_DAYS} dias depois da data de ida.`,
        });
        return;
      }
      cleanedArriveBy = arriveBy;
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
    const state = await getRoute(req.params.id);
    if (!state || state.route.userId !== req.userId) {
      res.status(404).json({ error: "Rota não encontrada." });
      return;
    }

    await checkRoute(req.params.id);
    res.json(await getRoute(req.params.id));
  })
);

apiRouter.use(
  (err: unknown, _req: unknown, res: import("express").Response, _next: (err?: unknown) => void) => {
    console.error("Erro na API:", err);
    res.status(500).json({ error: "Erro interno do servidor." });
  }
);
