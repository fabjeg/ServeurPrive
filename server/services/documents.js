// Logique documentaire partagée entre l'API REST et les tools MCP.
import { del, put } from "@vercel/blob";
import { connectDb } from "../lib/db.js";
import { env } from "../lib/env.js";
import { Document } from "../models/Document.js";

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function listDocuments(ownerId, { category, tag, q, from, to, limit = 200 } = {}) {
  await connectDb();
  const filter = { ownerId };
  if (category) filter.category = category.toLowerCase();
  if (tag) filter.tags = tag;
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ filename: rx }, { tags: rx }, { category: rx }];
  }
  if (from || to) {
    filter.uploadedAt = {};
    if (from) filter.uploadedAt.$gte = new Date(from);
    if (to) filter.uploadedAt.$lte = new Date(to);
  }
  return Document.find(filter).sort({ uploadedAt: -1 }).limit(Math.min(limit, 500));
}

export async function getDocument(ownerId, id) {
  await connectDb();
  if (!/^[0-9a-fA-F]{24}$/.test(id)) return null;
  return Document.findOne({ _id: id, ownerId });
}

export async function registerDocument(ownerId, meta) {
  await connectDb();
  // Upsert par blobPath : l'enregistrement peut arriver deux fois
  // (callback onUploadCompleted + confirmation explicite du client).
  return Document.findOneAndUpdate(
    { blobPath: meta.blobPath, ownerId },
    { $setOnInsert: { ...meta, ownerId, uploadedAt: new Date() } },
    { upsert: true, new: true }
  );
}

// Dépôt côté serveur (tool MCP add_document) : mêmes règles que l'upload web —
// blob privé, chemin documents/<owner>/ + suffixe aléatoire, métadonnées en Mongo.
// Réservé aux petits fichiers : ici le contenu transite par la fonction serverless.
export async function createDocumentFromBuffer(
  ownerId,
  { filename, mimetype, category, tags, buffer, source, sourceUrl, description }
) {
  const blob = await put(`documents/${ownerId}/${filename}`, buffer, {
    access: "private",
    addRandomSuffix: true,
    contentType: mimetype,
    token: env.blobToken,
  });
  return registerDocument(ownerId, {
    filename,
    mimetype,
    category: category || "divers",
    tags: Array.isArray(tags) ? tags.filter(Boolean) : [],
    size: buffer.length,
    source: source || "web",
    sourceUrl: sourceUrl || "",
    description: description || "",
    blobPath: blob.pathname,
    blobUrl: blob.url,
  });
}

// Mise à jour des métadonnées uniquement. Le blob n'est jamais déplacé : son
// chemin porte un suffixe aléatoire et le nom affiché/téléchargé vient de
// `filename` (Content-Disposition du proxy), pas du chemin de stockage.
export async function updateDocument(ownerId, id, { filename, category, tags, description }) {
  const doc = await getDocument(ownerId, id);
  if (!doc) return null;
  if (filename !== undefined) doc.filename = filename;
  if (category !== undefined) doc.category = category;
  if (tags !== undefined) doc.tags = tags.filter(Boolean);
  if (description !== undefined) doc.description = description;
  await doc.save();
  return doc;
}

export async function deleteDocument(ownerId, id) {
  const doc = await getDocument(ownerId, id);
  if (!doc) return false;
  await del(doc.blobUrl, { token: env.blobToken });
  await doc.deleteOne();
  return true;
}

export async function listCategories(ownerId) {
  await connectDb();
  return Document.aggregate([
    { $match: { ownerId } },
    { $group: { _id: "$category", count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
}

// Récupère le contenu binaire d'un blob privé, côté serveur uniquement,
// via le jeton BLOB_READ_WRITE_TOKEN. Jamais d'URL blob exposée au client.
export async function fetchBlobResponse(doc) {
  return fetch(doc.blobUrl, {
    headers: { authorization: `Bearer ${env.blobToken}` },
  });
}
