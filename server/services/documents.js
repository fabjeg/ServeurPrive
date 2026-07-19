// Logique documentaire partagée entre l'API REST et les tools MCP.
import { del, put } from "@vercel/blob";
import { waitUntil } from "@vercel/functions";
import { connectDb } from "../lib/db.js";
import { env } from "../lib/env.js";
import { Document } from "../models/Document.js";
import { extractContent, MAX_TEXT_CHARS } from "./extractContent.js";
import { generateSummary } from "./summarize.js";
import { analyzeDocumentText } from "./analyze.js";
import { getOrCreateFolder, listFolders } from "./folders.js";
import { ocrImage } from "./ocr.js";
import { buildSearchablePdf } from "./scanPdf.js";

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function requireSpace(space) {
  if (space !== "pro" && space !== "perso") {
    throw new Error(`space invalide ou manquant : ${space}`);
  }
}

export async function listDocuments(
  ownerId,
  { space, category, tag, q, from, to, folder, limit = 200 } = {}
) {
  requireSpace(space);
  await connectDb();
  const filter = { ownerId, space };
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

export async function getDocument(ownerId, id, space) {
  requireSpace(space);
  await connectDb();
  if (!/^[0-9a-fA-F]{24}$/.test(id)) return null;
  return Document.findOne({ _id: id, ownerId, space });
}

// Lookup SANS filtre space — réservé au MCP, pour distinguer « introuvable »
// de « existe mais dans l'autre espace » et répondre avec un message de
// refus explicite plutôt qu'un silence (voir server/mcp/index.js).
export async function getDocumentAnySpace(ownerId, id) {
  await connectDb();
  if (!/^[0-9a-fA-F]{24}$/.test(id)) return null;
  return Document.findOne({ _id: id, ownerId });
}

export async function registerDocument(ownerId, meta) {
  requireSpace(meta.space);
  await connectDb();
  // Upsert par blobPath : l'enregistrement peut arriver deux fois
  // (callback onUploadCompleted + confirmation explicite du client).
  // rawResult permet de distinguer une vraie création (upserted) d'une
  // confirmation en double, pour ne déclencher le traitement post-upload
  // (extraction + résumé) qu'une fois.
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
    const processPromise = processNewDocument(doc).catch((err) =>
      console.error("Traitement post-upload — erreur inattendue :", err)
    );
    waitUntil(processPromise);
  }
  return doc;
}

// Point d'entrée unique du traitement post-upload : extrait le contenu UNE
// fois (extractContent.js), l'indexe pour la recherche full-text
// (extractedText), puis génère le résumé Gemini à partir de ce même résultat
// — jamais deux extractions pour un même document. Best-effort comme
// generateSummary : ne relance jamais d'exception vers l'appelant.
export async function processNewDocument(doc) {
  let extracted;
  try {
    extracted = await extractContent(doc);
  } catch (err) {
    console.error("Extraction de contenu échouée :", err?.message || err);
    extracted = { kind: "unsupported" };
  }

  const extractedText = extracted.kind === "pdf" || extracted.kind === "text" ? extracted.text : "";
  if (extractedText) {
    await connectDb();
    await Document.findByIdAndUpdate(doc._id, { extractedText }).catch(() => {});
  }

  await generateSummary(doc, extracted);
}

// Classement automatique à partir d'un texte déjà extrait (pdf-parse ou OCR
// — analyzeDocumentText ne fait aucune distinction, voir services/analyze.js) :
// détecte modèle/catégorie/version/tags via Gemini puis les applique SANS
// jamais écraser un choix déjà fait par l'utilisateur (dossier déjà choisi,
// catégorie différente de "divers"). Partagé par la route POST /:id/analyze
// (PDF uploadés directement, texte déjà présent) et processScanDocument
// ci-dessous (photos scannées, texte OCR) — une seule implémentation.
export async function applyDetectedMetadata(ownerId, space, doc, text) {
  const [{ folders }, categories] = await Promise.all([
    listFolders(ownerId, space),
    listCategories(ownerId, space),
  ]);
  const detected = await analyzeDocumentText({
    filename: doc.filename,
    text,
    existingFolders: folders.map((f) => f.name),
    existingCategories: categories.map((c) => c._id),
  });
  if (!detected) return null;

  if (detected.model && !doc.folderId) {
    const folder = await getOrCreateFolder(ownerId, space, detected.model);
    doc.folderId = folder._id;
  }
  if (detected.category && (!doc.category || doc.category === "divers")) {
    doc.category = detected.category.toLowerCase();
  }
  const newTags = [...(detected.tags || []), ...(detected.version ? [detected.version] : [])]
    .map((t) => String(t).trim().toLowerCase())
    .filter(Boolean);
  doc.tags = [...new Set([...doc.tags, ...newTags])].slice(0, 12);
  if (detected.description && !doc.description) doc.description = detected.description;
  return detected;
}

// Crée le document d'un scan multi-photos : les pages sont déjà uploadées en
// Blob (images individuelles, cf. UploadPanel.jsx) au moment de l'appel — ce
// qui manque encore est l'assemblage en PDF searchable, fait en arrière-plan
// (processScanDocument) pour ne jamais bloquer la réponse HTTP dessus (OCR +
// génération PDF peuvent prendre plusieurs secondes par page). Le blob de la
// première page sert de placeholder le temps du traitement : le document est
// consultable (en image) dès sa création.
export async function createScanDocument(
  ownerId,
  { space, filename, category, tags, folderId, pages }
) {
  requireSpace(space);
  await connectDb();
  const first = pages[0];
  const doc = await Document.create({
    ownerId,
    space,
    filename,
    mimetype: "image/jpeg",
    category: category || "divers",
    tags: Array.isArray(tags) ? tags.filter(Boolean) : [],
    size: pages.reduce((sum, p) => sum + (p.size || 0), 0),
    source: "web",
    folderId: folderId || null,
    blobPath: first.blobPath,
    blobUrl: first.blobUrl,
    ocrStatus: "pending",
  });

  const processPromise = processScanDocument(doc, space, pages).catch((err) =>
    console.error("Traitement OCR du scan — erreur inattendue :", err)
  );
  waitUntil(processPromise);
  return doc;
}

// Traitement en arrière-plan d'un scan : OCR de chaque page → assemblage en
// un seul PDF searchable → remplacement du blob image par ce PDF → texte OCR
// réutilisé tel quel comme entrée d'applyDetectedMetadata (aucun second appel
// à extractDocumentText/pdf-parse sur le PDF fraîchement généré — le texte
// est déjà en main). Best-effort comme processNewDocument/generateSummary :
// ocrStatus passe à "failed" plutôt que de relancer une exception.
export async function processScanDocument(doc, space, pages) {
  try {
    const ocrPages = [];
    for (const page of pages) {
      const res = await fetch(page.blobUrl, {
        headers: { authorization: `Bearer ${env.blobToken}` },
      });
      if (!res.ok) throw new Error(`Page inaccessible dans le stockage (${page.blobPath}).`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const { text, words } = await ocrImage(buffer);
      ocrPages.push({ buffer, words, text });
    }

    const pdfBuffer = await buildSearchablePdf(ocrPages);
    const combinedText = ocrPages.map((p) => p.text).join("\n\n").trim();
    const truncatedText = combinedText.length > MAX_TEXT_CHARS
      ? combinedText.slice(0, MAX_TEXT_CHARS)
      : combinedText;

    const blob = await put(`documents/${doc.ownerId}/${doc.filename}`, pdfBuffer, {
      access: "private",
      addRandomSuffix: true,
      contentType: "application/pdf",
      token: env.blobToken,
    });

    await connectDb();
    await Promise.all(pages.map((p) => del(p.blobUrl, { token: env.blobToken }).catch(() => {})));

    doc.blobPath = blob.pathname;
    doc.blobUrl = blob.url;
    doc.mimetype = "application/pdf";
    doc.size = pdfBuffer.length;
    doc.extractedText = truncatedText;
    doc.ocrStatus = "done";

    if (combinedText) {
      await applyDetectedMetadata(doc.ownerId, space, doc, combinedText).catch((err) =>
        console.error("Classement automatique du scan échoué :", err?.message || err)
      );
    }
    await doc.save();

    await generateSummary(doc, {
      kind: combinedText ? "pdf" : "pdf_no_text",
      text: combinedText,
      pages: ocrPages.length,
    });
  } catch (err) {
    console.error(`Traitement OCR échoué pour le document ${doc._id} :`, err?.message || err);
    await connectDb();
    await Document.findByIdAndUpdate(doc._id, { ocrStatus: "failed" }).catch(() => {});
  }
}

// Dépôt côté serveur (tool MCP add_document) : mêmes règles que l'upload web —
// blob privé, chemin documents/<owner>/ + suffixe aléatoire, métadonnées en Mongo.
// Réservé aux petits fichiers : ici le contenu transite par la fonction serverless.
export async function createDocumentFromBuffer(
  ownerId,
  { filename, mimetype, category, tags, buffer, source, sourceUrl, description, folderId, space }
) {
  requireSpace(space);
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
    space,
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
  space,
  { filename, category, tags, description, folderId }
) {
  const doc = await getDocument(ownerId, id, space);
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

export async function deleteDocument(ownerId, id, space) {
  const doc = await getDocument(ownerId, id, space);
  if (!doc) return false;
  await del(doc.blobUrl, { token: env.blobToken });
  await doc.deleteOne();
  return true;
}

export async function listCategories(ownerId, space) {
  requireSpace(space);
  await connectDb();
  return Document.aggregate([
    { $match: { ownerId, space } },
    { $group: { _id: "$category", count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
}

// Recherche full-text (index Mongo sur filename/tags/extractedText, voir
// models/Document.js). Renvoie un extrait de contexte autour du premier
// terme trouvé pour chaque résultat, façon aperçu de résultat de recherche.
const SNIPPET_RADIUS = 150;

function buildSnippet(text, query) {
  if (!text) return "";
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const lower = text.toLowerCase();
  let idx = -1;
  for (const term of terms) {
    const i = lower.indexOf(term);
    if (i !== -1 && (idx === -1 || i < idx)) idx = i;
  }
  if (idx === -1) return text.slice(0, SNIPPET_RADIUS * 2).trim();
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(text.length, idx + SNIPPET_RADIUS);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

export async function searchDocumentsFullText(ownerId, space, q, limit = 25) {
  requireSpace(space);
  await connectDb();
  const query = String(q || "").trim();
  if (!query) return [];
  const docs = await Document.find(
    { ownerId, space, $text: { $search: query } },
    { score: { $meta: "textScore" } }
  )
    .sort({ score: { $meta: "textScore" } })
    .limit(Math.min(limit, 100));
  return docs.map((d) => ({
    ...d.toClient(),
    excerpt: buildSnippet(d.extractedText, query),
  }));
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
