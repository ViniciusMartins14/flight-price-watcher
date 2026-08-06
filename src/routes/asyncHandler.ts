import type { NextFunction, Request, RequestHandler, Response } from "express";

// Express 4 não captura rejeições de handlers async sozinho; sem isso, um
// erro (ex: instabilidade momentânea de conexão com o MongoDB) derruba o
// processo inteiro em vez de responder com um erro HTTP.
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
