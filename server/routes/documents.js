// Routes documentaires — TOUTES derrière requireAuth, y compris listing et
// téléchargement. Le client ne voit jamais d'URL Blob : consultation via proxy.
// `space` est forcé à "pro" ici (constante, jamais dérivée du client) — app
// mono-espace, voir server/services/documents.js pour le champ `space`
// conservé dans le schéma (toujours "pro" désormais).
import { Router } from "express";
import { Readable } from "node:stream";
import { requireAuth } from "../lib/auth.js";
import {
  applyDetectedMetadata,
  createScanDocument,
  deleteDocument,
  extractDocumentText,
  fetchBlobResponse,
  getDocument,
  listCategories,
  listDocuments,
  registerDocument,
  searchDocumentsFullText,
  updateDocument,
} from "../services/documents.js";
import { resolveFolderId } from "../services/folders.js";

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

// Listing avec filtres catégorie / tag / recherche / dates.
documentsRouter.get("/", async (req, res, next) => {
  try {
    const space = "pro";
    const { category, tag, q, from, to, folder } = req.query;
    const docs = await listDocuments(req.ownerId, { space, category, tag, q, from, to, folder });
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ documents: docs.map((d) => d.toClient()) });
  } catch (err) {
    next(err);
  }
});

// Recherche full-text (index Mongo sur filename/tags/extractedText), avec
// extrait de contexte par résultat — voir searchDocumentsFullText().
documentsRouter.get("/search", async (req, res, next) => {
  try {
    const space = "pro";
    const results = await searchDocumentsFullText(req.ownerId, space, req.query.q);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

documentsRouter.get("/categories", async (req, res, next) => {
  try {
    const space = "pro";
    const categories = await listCategories(req.ownerId, space);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      categories: categories.map((c) => ({ name: c._id, count: c.count })),
    });
  } catch (err) {
    next(err);
  }
});

// Confirmation post-upload : enregistre les métadonnées en Mongo.
documentsRouter.post("/", async (req, res, next) => {
  try {
    const space = "pro";
    const { filename, mimetype, category, tags, size, blobPath, blobUrl, folderId } =
      req.body || {};
    if (!filename || !blobPath || !blobUrl) {
      return res.status(400).json({ error: "Métadonnées incomplètes." });
    }
    if (!blobPath.startsWith(`documents/${req.ownerId}/`)) {
      return res.status(400).json({ error: "Chemin de blob non autorisé." });
    }
    const doc = await registerDocument(req.ownerId, {
      space,
      filename,
      mimetype: mimetype || "application/octet-stream",
      category: category || "divers",
      tags: Array.isArray(tags) ? tags.filter(Boolean) : [],
      size: Number(size) || 0,
      source: "web",
      // Un folderId inconnu, étranger ou d'un autre espace est simplement ignoré (null).
      folderId: await resolveFolderId(req.ownerId, space, folderId),
      blobPath,
      blobUrl,
    });
    res.status(201).json({ document: doc.toClient() });
  } catch (err) {
    next(err);
  }
});

// Extraction automatique des informations clés (modèle, type, version, tags)
// puis classement : dossier créé/retrouvé d'après le modèle détecté, catégorie
// et tags complétés. Les choix explicites de l'utilisateur ne sont jamais
// écrasés (dossier déjà choisi, catégorie autre que « divers »).
documentsRouter.post("/:id/analyze", async (req, res, next) => {
  try {
    const space = "pro";
    const doc = await getDocument(req.ownerId, req.params.id, space);
    if (!doc) return res.status(404).json({ error: "Document introuvable." });

    const extracted = await extractDocumentText(doc);
    if (!extracted.ok) return res.json({ analyzed: false, reason: extracted.reason });

    const detected = await applyDetectedMetadata(req.ownerId, space, doc, extracted.text);
    if (!detected) return res.json({ analyzed: false, reason: "Analyse impossible." });
    await doc.save();

    res.json({ analyzed: true, detected, document: doc.toClient() });
  } catch (err) {
    next(err);
  }
});

// Crée le document final d'un scan multi-photos : les pages sont déjà
// uploadées en Blob individuellement (voir UploadPanel.jsx) — cette route ne
// fait qu'enregistrer le document (placeholder image, ocrStatus "pending") et
// répond immédiatement ; l'assemblage en PDF searchable (OCR + pdf-lib) tourne
// en arrière-plan (createScanDocument → processScanDocument, fire-and-forget
// via waitUntil, même pattern que le traitement post-upload standard).
documentsRouter.post("/scan", async (req, res, next) => {
  try {
    const space = "pro";
    const { filename, category, tags, folderId, pages } = req.body || {};
    if (!filename || !Array.isArray(pages) || !pages.length) {
      return res.status(400).json({ error: "Métadonnées de scan incomplètes." });
    }
    for (const p of pages) {
      if (!p.blobPath || !p.blobUrl || !p.blobPath.startsWith(`documents/${req.ownerId}/`)) {
        return res.status(400).json({ error: "Chemin de blob non autorisé." });
      }
    }
    const doc = await createScanDocument(req.ownerId, {
      space,
      filename,
      category: category || "divers",
      tags: Array.isArray(tags) ? tags.filter(Boolean) : [],
      folderId: await resolveFolderId(req.ownerId, space, folderId),
      pages,
    });
    res.status(201).json({ document: doc.toClient() });
  } catch (err) {
    next(err);
  }
});

documentsRouter.get("/:id", async (req, res, next) => {
  try {
    const space = "pro";
    const doc = await getDocument(req.ownerId, req.params.id, space);
    if (!doc) return res.status(404).json({ error: "Document introuvable." });
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ document: doc.toClient() });
  } catch (err) {
    next(err);
  }
});

// Mise à jour des métadonnées (dont rattachement à un dossier).
documentsRouter.patch("/:id", async (req, res, next) => {
  try {
    const space = "pro";
    const { filename, category, tags, description, folderId } = req.body || {};
    const doc = await updateDocument(req.ownerId, req.params.id, space, {
      filename,
      category,
      tags: Array.isArray(tags) ? tags.filter(Boolean) : undefined,
      description,
      // folderId : absent = inchangé, null/"" = détacher, sinon dossier validé.
      folderId:
        folderId === undefined ? undefined : await resolveFolderId(req.ownerId, space, folderId),
    });
    if (!doc) return res.status(404).json({ error: "Document introuvable." });
    res.json({ document: doc.toClient() });
  } catch (err) {
    next(err);
  }
});

// Proxy de consultation/téléchargement : session vérifiée → blob récupéré
// côté serveur via BLOB_READ_WRITE_TOKEN → flux streamé au client.
documentsRouter.get("/:id/file", async (req, res, next) => {
  try {
    const space = "pro";
    const doc = await getDocument(req.ownerId, req.params.id, space);
    if (!doc) return res.status(404).json({ error: "Document introuvable." });

    const blobRes = await fetchBlobResponse(doc);
    if (!blobRes.ok || !blobRes.body) {
      return res.status(502).json({ error: "Blob inaccessible." });
    }

    const disposition = req.query.download === "1" ? "attachment" : "inline";
    res.status(200);
    res.setHeader("Content-Type", doc.mimetype);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader(
      "Content-Disposition",
      `${disposition}; filename*=UTF-8''${encodeURIComponent(doc.filename)}`
    );
    const length = blobRes.headers.get("content-length");
    if (length) res.setHeader("Content-Length", length);

    Readable.fromWeb(blobRes.body).pipe(res);
  } catch (err) {
    next(err);
  }
});

documentsRouter.delete("/:id", async (req, res, next) => {
  try {
    const space = "pro";
    const deleted = await deleteDocument(req.ownerId, req.params.id, space);
    if (!deleted) return res.status(404).json({ error: "Document introuvable." });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
