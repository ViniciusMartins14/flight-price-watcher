import { randomUUID } from "node:crypto";
import { getDb } from "./mongo.js";
import type { ComboResult, FlightRoute, PriceCheck, RouteState, User } from "./types.js";

const MAX_HISTORY_PER_ROUTE = 100;

interface RouteDoc {
  _id: string;
  userId: string;
  label: string;
  origin: string;
  destination: string;
  tripType: FlightRoute["tripType"];
  departDate: string;
  returnDate?: string;
  whatsappNumber?: string;
  combineStops?: boolean;
  arriveBy?: string;
  returnArriveBy?: string;
  tryThreeLegs?: boolean;
  createdAt: string;
  lowestPrice?: number;
  lowestPriceAt?: string;
  lastError?: string;
  checking?: boolean;
  checkingSince?: string;
}

const CHECKING_STALE_MS = 10 * 60 * 1000; // 10min — se a função for encerrada no meio (ex: timeout na Vercel), o "checking" não fica travado pra sempre

function isCheckingStale(checkingSince: string | undefined): boolean {
  if (!checkingSince) return false;
  return Date.now() - new Date(checkingSince).getTime() > CHECKING_STALE_MS;
}

interface PriceCheckDoc extends PriceCheck {
  routeId: string;
}

interface UserDoc {
  _id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

async function routesCollection() {
  const db = await getDb();
  return db.collection<RouteDoc>("routes");
}

async function priceChecksCollection() {
  const db = await getDb();
  return db.collection<PriceCheckDoc>("priceChecks");
}

async function usersCollection() {
  const db = await getDb();
  return db.collection<UserDoc>("users");
}

function toFlightRoute(doc: RouteDoc): FlightRoute {
  return {
    id: doc._id,
    userId: doc.userId,
    label: doc.label,
    origin: doc.origin,
    destination: doc.destination,
    tripType: doc.tripType,
    departDate: doc.departDate,
    returnDate: doc.returnDate,
    whatsappNumber: doc.whatsappNumber,
    combineStops: doc.combineStops,
    arriveBy: doc.arriveBy,
    returnArriveBy: doc.returnArriveBy,
    tryThreeLegs: doc.tryThreeLegs,
    createdAt: doc.createdAt,
  };
}

function toUser(doc: UserDoc): User {
  return { id: doc._id, email: doc.email, createdAt: doc.createdAt };
}

async function buildRouteState(doc: RouteDoc): Promise<RouteState> {
  const checks = await priceChecksCollection();
  const history = await checks
    .find({ routeId: doc._id }, { projection: { _id: 0, routeId: 0 } })
    .sort({ checkedAt: -1 })
    .limit(MAX_HISTORY_PER_ROUTE)
    .toArray();

  return {
    route: toFlightRoute(doc),
    lowestPrice: doc.lowestPrice,
    lowestPriceAt: doc.lowestPriceAt,
    history,
    lastError: doc.lastError,
    checking: (doc.checking ?? false) && !isCheckingStale(doc.checkingSince),
  };
}

/** Todas as rotas de todos os usuários — usado pelo worker local (scraper + WhatsApp). */
export async function listAllRoutes(): Promise<RouteState[]> {
  const routes = await routesCollection();
  const docs = await routes.find().sort({ createdAt: 1 }).toArray();
  return Promise.all(docs.map(buildRouteState));
}

/** Só as rotas do usuário informado — usado pelo dashboard/API autenticada. */
export async function listRoutesForUser(userId: string): Promise<RouteState[]> {
  const routes = await routesCollection();
  const docs = await routes.find({ userId }).sort({ createdAt: 1 }).toArray();
  return Promise.all(docs.map(buildRouteState));
}

export async function getRoute(id: string): Promise<RouteState | undefined> {
  const routes = await routesCollection();
  const doc = await routes.findOne({ _id: id });
  return doc ? buildRouteState(doc) : undefined;
}

export async function addRoute(
  input: Omit<FlightRoute, "id" | "createdAt">
): Promise<RouteState> {
  const routes = await routesCollection();
  const doc: RouteDoc = {
    _id: randomUUID(),
    userId: input.userId,
    label: input.label,
    origin: input.origin,
    destination: input.destination,
    tripType: input.tripType,
    departDate: input.departDate,
    returnDate: input.returnDate,
    whatsappNumber: input.whatsappNumber,
    combineStops: input.combineStops,
    arriveBy: input.arriveBy,
    returnArriveBy: input.returnArriveBy,
    tryThreeLegs: input.tryThreeLegs,
    createdAt: new Date().toISOString(),
  };
  await routes.insertOne(doc);
  return buildRouteState(doc);
}

export async function removeRoute(id: string, userId: string): Promise<boolean> {
  const routes = await routesCollection();
  const checks = await priceChecksCollection();
  const result = await routes.deleteOne({ _id: id, userId });
  if (result.deletedCount > 0) {
    await checks.deleteMany({ routeId: id });
  }
  return result.deletedCount > 0;
}

export async function recordPriceCheck(
  routeId: string,
  price: number,
  currency: string,
  url: string,
  combo?: ComboResult
): Promise<{ state: RouteState; check: PriceCheck } | undefined> {
  const routes = await routesCollection();
  const doc = await routes.findOne({ _id: routeId });
  if (!doc) return undefined;

  // Se a tarifa combinada (2 trechos) ficou mais barata que o voo direto,
  // ela que conta como "o preço" dessa checagem pra fins de menor preço
  // e alerta — o direto continua registrado em price/url pra referência.
  const effectivePrice = combo && combo.totalPrice < price ? combo.totalPrice : price;

  const isNewLow = doc.lowestPrice === undefined || effectivePrice < doc.lowestPrice;
  const check: PriceCheck = {
    price,
    currency,
    checkedAt: new Date().toISOString(),
    isNewLow,
    url,
    combo,
  };

  const checks = await priceChecksCollection();
  await checks.insertOne({ ...check, routeId });

  const oldestKept = await checks
    .find({ routeId })
    .sort({ checkedAt: -1 })
    .skip(MAX_HISTORY_PER_ROUTE)
    .limit(1)
    .toArray();
  if (oldestKept.length > 0) {
    await checks.deleteMany({ routeId, checkedAt: { $lt: oldestKept[0].checkedAt } });
  }

  const update: Partial<RouteDoc> = { lastError: undefined };
  if (isNewLow) {
    update.lowestPrice = effectivePrice;
    update.lowestPriceAt = check.checkedAt;
  }
  await routes.updateOne({ _id: routeId }, { $set: update });

  const updatedDoc = await routes.findOne({ _id: routeId });
  const state = await buildRouteState(updatedDoc as RouteDoc);
  return { state, check };
}

export async function recordError(routeId: string, message: string): Promise<void> {
  const routes = await routesCollection();
  await routes.updateOne({ _id: routeId }, { $set: { lastError: message } });
}

export async function setChecking(routeId: string, checking: boolean): Promise<void> {
  const routes = await routesCollection();
  await routes.updateOne(
    { _id: routeId },
    checking
      ? { $set: { checking: true, checkingSince: new Date().toISOString() } }
      : { $set: { checking: false }, $unset: { checkingSince: "" } }
  );
}

export async function createUser(email: string, passwordHash: string): Promise<User> {
  const users = await usersCollection();
  const doc: UserDoc = {
    _id: randomUUID(),
    email: email.toLowerCase(),
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  await users.insertOne(doc);
  return toUser(doc);
}

export async function findUserByEmail(
  email: string
): Promise<(User & { passwordHash: string }) | undefined> {
  const users = await usersCollection();
  const doc = await users.findOne({ email: email.toLowerCase() });
  return doc ? { ...toUser(doc), passwordHash: doc.passwordHash } : undefined;
}

export async function findUserById(id: string): Promise<User | undefined> {
  const users = await usersCollection();
  const doc = await users.findOne({ _id: id });
  return doc ? toUser(doc) : undefined;
}
