import { Router } from "express";
import {
  clearSessionCookie,
  hashPassword,
  isValidEmail,
  isValidPassword,
  requireAuth,
  setSessionCookie,
  verifyPassword,
} from "../auth.js";
import { createUser, findUserByEmail, findUserById } from "../db.js";
import { asyncHandler } from "./asyncHandler.js";

export const authRouter = Router();

authRouter.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body ?? {};

    if (!email || !isValidEmail(String(email))) {
      res.status(400).json({ error: "E-mail inválido." });
      return;
    }
    if (!isValidPassword(password)) {
      res.status(400).json({ error: "A senha deve ter pelo menos 8 caracteres." });
      return;
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      res.status(409).json({ error: "Já existe uma conta com esse e-mail." });
      return;
    }

    const passwordHash = await hashPassword(password);
    const user = await createUser(email, passwordHash);
    setSessionCookie(res, user.id);
    res.status(201).json({ user });
  })
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      res.status(400).json({ error: "E-mail e senha são obrigatórios." });
      return;
    }

    const user = await findUserByEmail(String(email));
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      res.status(401).json({ error: "E-mail ou senha incorretos." });
      return;
    }

    setSessionCookie(res, user.id);
    res.json({ user: { id: user.id, email: user.email, createdAt: user.createdAt } });
  })
);

authRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await findUserById(req.userId as string);
    if (!user) {
      res.status(401).json({ error: "Não autenticado." });
      return;
    }
    res.json({ user });
  })
);
