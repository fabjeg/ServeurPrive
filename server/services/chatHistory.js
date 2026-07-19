// Persistance de l'historique de conversation Jarvis — voir ChatMessage.js.
// Remplace le localStorage côté client : le serveur est la source de
// vérité, partagée entre appareils.
import { connectDb } from "../lib/db.js";
import { ChatMessage } from "../models/ChatMessage.js";

function requireSpace(space) {
  if (space !== "pro" && space !== "perso") {
    throw new Error(`space invalide ou manquant : ${space}`);
  }
}

export async function getHistory(ownerId, space, limit = 30) {
  requireSpace(space);
  await connectDb();
  const messages = await ChatMessage.find({ ownerId, space })
    .sort({ createdAt: -1 })
    .limit(limit);
  return messages.reverse().map((m) => m.toClient());
}

export async function appendMessage(ownerId, space, { role, text }) {
  requireSpace(space);
  if (!text || !String(text).trim()) return null;
  await connectDb();
  return ChatMessage.create({ ownerId, space, role, text });
}

export async function clearHistory(ownerId, space) {
  requireSpace(space);
  await connectDb();
  await ChatMessage.deleteMany({ ownerId, space });
}
