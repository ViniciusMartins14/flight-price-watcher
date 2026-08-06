import { randomUUID } from "node:crypto";
import { getDb } from "./mongo.js";
import type { FlightRoute, PriceCheck, RouteState } from "./types.js";

const MAX_HISTORY_PER_ROUTE = 100;

interface RouteDoc {
  _id: string;
  label: string;
  origin: string;
  destination: string;
  tripType: FlightRoute["tripType"];
  departDate: string;
  returnDate?: string;
  whatsappNumber?: string;
  createdAt: string;
  lowestPrice?: number;
  lowestPriceAt?: string;
  lastError?: string;
}

interface PriceCheckDoc extends PriceCheck {
  routeId: string;
}

async function routesCollection() {
  const db = await getDb();
  return db.collection<RouteDoc>("routes");
}

async function priceChecksCollection() {
  const db = await getDb();
  return db.collection<PriceCheckDoc>("priceChecks");
}

function toFlightRoute(doc: RouteDoc): FlightRoute {
  return {
    id: doc._id,
    label: doc.label,
    origin: doc.origin,
    destination: doc.destination,
    tripType: doc.tripType,
    departDate: doc.departDate,
    returnDate: doc.returnDate,
    whatsappNumber: doc.whatsappNumber,
    createdAt: doc.createdAt,
  };
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
  };
}

export async function listRoutes(): Promise<RouteState[]> {
  const routes = await routesCollection();
  const docs = await routes.find().sort({ createdAt: 1 }).toArray();
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
    label: input.label,
    origin: input.origin,
    destination: input.destination,
    tripType: input.tripType,
    departDate: input.departDate,
    returnDate: input.returnDate,
    whatsappNumber: input.whatsappNumber,
    createdAt: new Date().toISOString(),
  };
  await routes.insertOne(doc);
  return buildRouteState(doc);
}

export async function removeRoute(id: string): Promise<boolean> {
  const routes = await routesCollection();
  const checks = await priceChecksCollection();
  const result = await routes.deleteOne({ _id: id });
  await checks.deleteMany({ routeId: id });
  return result.deletedCount > 0;
}

export async function recordPriceCheck(
  routeId: string,
  price: number,
  currency: string,
  url: string
): Promise<{ state: RouteState; check: PriceCheck } | undefined> {
  const routes = await routesCollection();
  const doc = await routes.findOne({ _id: routeId });
  if (!doc) return undefined;

  const isNewLow = doc.lowestPrice === undefined || price < doc.lowestPrice;
  const check: PriceCheck = {
    price,
    currency,
    checkedAt: new Date().toISOString(),
    isNewLow,
    url,
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
    update.lowestPrice = price;
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
