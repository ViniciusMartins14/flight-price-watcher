import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";
import type { Database, FlightRoute, PriceCheck, RouteState } from "./types.js";

const MAX_HISTORY_PER_ROUTE = 100;

function ensureDbFile(): void {
  const dir = dirname(config.dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(config.dbPath)) {
    const empty: Database = { routes: [] };
    writeFileSync(config.dbPath, JSON.stringify(empty, null, 2), "utf-8");
  }
}

function load(): Database {
  ensureDbFile();
  const raw = readFileSync(config.dbPath, "utf-8");
  return JSON.parse(raw) as Database;
}

function save(db: Database): void {
  writeFileSync(config.dbPath, JSON.stringify(db, null, 2), "utf-8");
}

export function listRoutes(): RouteState[] {
  return load().routes;
}

export function getRoute(id: string): RouteState | undefined {
  return load().routes.find((r) => r.route.id === id);
}

export function addRoute(input: Omit<FlightRoute, "id" | "createdAt">): RouteState {
  const db = load();
  const route: FlightRoute = {
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const state: RouteState = { route, history: [] };
  db.routes.push(state);
  save(db);
  return state;
}

export function removeRoute(id: string): boolean {
  const db = load();
  const before = db.routes.length;
  db.routes = db.routes.filter((r) => r.route.id !== id);
  save(db);
  return db.routes.length < before;
}

export function recordPriceCheck(
  routeId: string,
  price: number,
  currency: string,
  url: string
): { state: RouteState; check: PriceCheck } | undefined {
  const db = load();
  const state = db.routes.find((r) => r.route.id === routeId);
  if (!state) return undefined;

  const isNewLow = state.lowestPrice === undefined || price < state.lowestPrice;
  const check: PriceCheck = {
    price,
    currency,
    checkedAt: new Date().toISOString(),
    isNewLow,
    url,
  };

  if (isNewLow) {
    state.lowestPrice = price;
    state.lowestPriceAt = check.checkedAt;
  }

  state.history.unshift(check);
  if (state.history.length > MAX_HISTORY_PER_ROUTE) {
    state.history.length = MAX_HISTORY_PER_ROUTE;
  }
  state.lastError = undefined;

  save(db);
  return { state, check };
}

export function recordError(routeId: string, message: string): void {
  const db = load();
  const state = db.routes.find((r) => r.route.id === routeId);
  if (!state) return;
  state.lastError = message;
  save(db);
}
