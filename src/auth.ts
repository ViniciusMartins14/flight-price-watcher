import bcrypt from "bcryptjs";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "./config.js";

export const SESSION_COOKIE_NAME = "session";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

function getJwtSecret(): string {
  if (!config.jwtSecret) {
    throw new Error(
      "JWT_SECRET não configurado. Defina essa variável de ambiente antes de usar autenticação."
    );
  }
  return config.jwtSecret;
}

export function signSessionToken(userId: string): string {
  return jwt.sign({ sub: userId }, getJwtSecret(), { expiresIn: "30d" });
}

export function verifySessionToken(token: string): string | undefined {
  try {
    const payload = jwt.verify(token, getJwtSecret()) as { sub?: string };
    return payload.sub;
  } catch {
    return undefined;
  }
}

export function setSessionCookie(res: Response, userId: string): void {
  const token = signSessionToken(userId);
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  const userId = token ? verifySessionToken(token) : undefined;
  if (!userId) {
    res.status(401).json({ error: "Não autenticado." });
    return;
  }
  req.userId = userId;
  next();
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

export function isValidPassword(password: string): boolean {
  return typeof password === "string" && password.length >= 8;
}
