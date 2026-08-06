import { Router } from "express";
import { addRoute, getRoute, listRoutes, removeRoute } from "../db.js";
import { checkRoute } from "../scheduler.js";

export const apiRouter = Router();

apiRouter.get("/routes", (_req, res) => {
  res.json(listRoutes());
});

apiRouter.post("/routes", (req, res) => {
  const { label, origin, destination, departDate, returnDate, tripType } = req.body ?? {};

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

  const state = addRoute({
    label: label || `${origin} -> ${destination}`,
    origin: String(origin).toUpperCase(),
    destination: String(destination).toUpperCase(),
    tripType,
    departDate,
    returnDate: tripType === "roundtrip" ? returnDate : undefined,
  });

  res.status(201).json(state);
});

apiRouter.delete("/routes/:id", (req, res) => {
  const removed = removeRoute(req.params.id);
  if (!removed) {
    res.status(404).json({ error: "Rota não encontrada." });
    return;
  }
  res.status(204).end();
});

apiRouter.post("/routes/:id/check", async (req, res) => {
  const state = getRoute(req.params.id);
  if (!state) {
    res.status(404).json({ error: "Rota não encontrada." });
    return;
  }

  await checkRoute(req.params.id);
  res.json(getRoute(req.params.id));
});
