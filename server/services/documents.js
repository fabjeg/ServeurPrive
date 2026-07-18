// Logique documentaire partagée entre l'API REST et les tools MCP.
import { del, put } from "@vercel/blob";
import { waitUntil } from "@vercel/functions";
import { connectDb } from "../lib/db.js";
import { env } from "../lib/env.js";
import { Document } from "../models/Document.js";
import { generateSummary } from "./summarize.js";

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function listDocuments(
  ownerId,
  { category, tag, q, from, to, folder, limit = 200 } = {}
) {
  await connectDb();
  const filter = { ownerId };
  if (category) filter.category = category.toLowerCase();
  // folder : "none" = documents non classés, sinon id de dossier.
  if (folder === "none") filter.folderId = null;
  else if (folder && /^[0-9a-fA-F]{24}$/.test(folder)) filter.folderId = folder;
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
  // rawResult permet de distinguer une vraie création (upserted) d'une
  // confirmation en double, pour ne déclencher le résumé automatique qu'une fois.
  const result = await Document.findOneAndUpdate(
    { blobPath: meta.blobPath, ownerId },
    { $setOnInsert: { ...meta, ownerId, uploadedAt: new Date() } },
    { upsert: true, new: true, includeResultMetadata: true }
  );
  const doc = result.value;
  const isNewDocument = !result.lastErrorObject?.updatedExisting;
  if (isNewDocument) {
    // Fire-and-forget : ne bloque jamais la réponse HTTP, n'échoue jamais l'upload.
    // Sur Vercel, la fonction peut être gelée dès la réponse envoyée — waitUntil()
    // dit au runtime d'attendre la fin de cette promesse avant de geler l'instance.
    // Hors contexte Vercel (server/local.js, script node natif), waitUntil() ne
    // jette pas : elle ne fait juste rien (pas de runtime à qui déléguer l'attente),
    // et la promesse continue de s'exécuter normalement en fire-and-forget —
    // donc un seul appel couvre les deux environnements sans branche conditionnelle.
    const summaryPromise = generateSummary(doc).catch((err) =>
      console.error("Résumé automatique — erreur inattendue :", err)
    );
    waitUntil(summaryPromise);
  }
  return doc;
}

// Dépôt côté serveur (tool MCP add_document) : mêmes règles que l'upload web —
// blob privé, chemin documents/<owner>/ + suffixe aléatoire, métadonnées en Mongo.
// Réservé aux petits fichiers : ici le contenu transite par la fonction serverless.
export async function createDocumentFromBuffer(
  ownerId,
  { filename, mimetype, category, tags, buffer, source, sourceUrl, description, folderId }
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
    folderId: folderId || null,
    blobPath: blob.pathname,
    blobUrl: blob.url,
  });
}

// Mise à jour des métadonnées uniquement. Le blob n'est jamais déplacé : son
// chemin porte un suffixe aléatoire et le nom affiché/téléchargé vient de
// `filename` (Content-Disposition du proxy), pas du chemin de stockage.
export async function updateDocument(
  ownerId,
  id,
  { filename, category, tags, description, folderId }
) {
  const doc = await getDocument(ownerId, id);
  if (!doc) return null;
  if (filename !== undefined) doc.filename = filename;
  if (category !== undefined) doc.category = category;
  if (tags !== undefined) doc.tags = tags.filter(Boolean);
  if (description !== undefined) doc.description = description;
  // folderId : null pour détacher, ObjectId (déjà validé par l'appelant) sinon.
  if (folderId !== undefined) doc.folderId = folderId;
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

// Texte exploitable d'un document (chatbot). PDF via pdf-parse (classe
// PDFParse, destroy obligatoire), text/* tel quel ; les autres formats ne
// sont pas extractibles côté serveur.
const EXTRACT_MAX_BYTES = 20 * 1024 * 1024;
const EXTRACT_MAX_CHARS = 40000;

export async function extractDocumentText(doc) {
  if (doc.size > EXTRACT_MAX_BYTES) {
    return { ok: false, reason: "Fichier trop volumineux pour l'extraction." };
  }
  const blobRes = await fetchBlobResponse(doc);
  if (!blobRes.ok) return { ok: false, reason: "Contenu inaccessible dans le stockage." };

  if (doc.mimetype === "application/pdf") {
    const { PDFParse } = await import("pdf-parse");
    let parser;
    try {
      parser = new PDFParse({ data: new Uint8Array(await blobRes.arrayBuffer()) });
      const parsed = await parser.getText();
      const text = (parsed.text || "").trim();
      if (!text) {
        return { ok: false, reason: "PDF sans couche texte (scan) — non extractible sans OCR." };
      }
      const truncated = text.length > EXTRACT_MAX_CHARS;
      return {
        ok: true,
        pages: parsed.total,
        truncated,
        text: truncated ? text.slice(0, EXTRACT_MAX_CHARS) : text,
      };
    } catch (err) {
      console.error("Extraction PDF échouée :", err?.message || err);
      return { ok: false, reason: "PDF illisible — extraction impossible." };
    } finally {
      await parser?.destroy().catch(() => {});
    }
  }

  if (/^(text\/|application\/(json|xml|javascript|x-yaml|csv))/.test(doc.mimetype)) {
    const text = (await blobRes.text()).trim();
    const truncated = text.length > EXTRACT_MAX_CHARS;
    return { ok: true, truncated, text: truncated ? text.slice(0, EXTRACT_MAX_CHARS) : text };
  }

  return { ok: false, reason: `Format ${doc.mimetype} non extractible en texte.` };
}
