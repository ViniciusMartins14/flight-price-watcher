import dns from "node:dns";
import { MongoClient, type Db } from "mongodb";
import { config } from "./config.js";

// Algumas redes/VPNs configuram um resolvedor DNS local (ex: 127.0.0.1) que
// não suporta consultas SRV, usadas pela connection string "mongodb+srv://".
// Forçar um DNS público evita "querySrv ECONNREFUSED" nesses casos.
if (dns.getServers().some((server) => server === "127.0.0.1" || server === "::1")) {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
}

// Guarda a conexão num escopo de módulo para ser reaproveitada entre
// invocações de função serverless "quentes" no Vercel, em vez de abrir
// uma conexão nova a cada requisição.
let clientPromise: Promise<MongoClient> | undefined;

function getClientPromise(): Promise<MongoClient> {
  if (!clientPromise) {
    const client = new MongoClient(config.mongodbUri);
    clientPromise = client.connect();
  }
  return clientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await getClientPromise();
  return client.db(config.mongodbDbName);
}
