// Connexion Mongoose avec cache global : en serverless, le conteneur peut être
// réutilisé entre invocations — on garde la promesse de connexion pour éviter
// de rouvrir une connexion Atlas à chaque cold start tiède.
import mongoose from "mongoose";
import { env } from "./env.js";

const globalCache = globalThis;
if (!globalCache.__frigoMongoose) {
  globalCache.__frigoMongoose = { conn: null, promise: null };
}
const cached = globalCache.__frigoMongoose;

export async function connectDb() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose
      .connect(env.mongodbUri, {
        bufferCommands: false,
        maxPoolSize: 5,
        serverSelectionTimeoutMS: 8000,
      })
      .then((m) => m);
  }
  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null; // permettre une nouvelle tentative à la requête suivante
    throw err;
  }
  return cached.conn;
}
