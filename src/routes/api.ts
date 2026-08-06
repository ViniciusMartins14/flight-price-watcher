import { Router, type Request, type RequestHandler, type Response } from "express";
import { addRoute, getRoute, listRoutes, removeRoute } from "../db.js";
import { checkRoute } from "../scheduler.js";

export const apiRouter = Router();

// Express 4 não captura rejeições de handlers async sozinho; sem isso, um
// erro (ex: instabilidade momentânea de conexão com o MongoDB) derruba o
// processo inteiro em vez de responder com um erro HTTP.
function asyncHandler(
  handler: (req: Request, res: Response) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

apiRouter.get(
  "/routes",
  asyncHandler(async (_req, res) => {
    res.json(await listRoutes());
  })
);

apiRouter.post(
  "/routes",
  asyncHandler(async (req, res) => {
    const { label, origin, destination, departDate, returnDate, tripType, whatsappNumber } =
      req.body ?? {};

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
      label: label || `${origin} -> ${destination}`,
      origin: String(origin).toUpperCase(),
      destination: String(destination).toUpperCase(),
      tripType,
      departDate,
      returnDate: tripType === "roundtrip" ? returnDate : undefined,
      whatsappNumber: cleanedWhatsappNumber,
    });

    res.status(201).json(state);
  })
);

apiRouter.delete(
  "/routes/:id",
  asyncHandler(async (req, res) => {
    const removed = await removeRoute(req.params.id);
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
    if (!state) {
      res.status(404).json({ error: "Rota não encontrada." });
      return;
    }

    await checkRoute(req.params.id);
    res.json(await getRoute(req.params.id));
  })
);

apiRouter.use((err: unknown, _req: Request, res: Response, _next: (err?: unknown) => void) => {
  console.error("Erro na API:", err);
  res.status(500).json({ error: "Erro interno do servidor." });
});
