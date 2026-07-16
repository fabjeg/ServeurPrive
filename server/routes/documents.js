// Routes documentaires — TOUTES derrière requireAuth, y compris listing et
// téléchargement. Le client ne voit jamais d'URL Blob : consultation via proxy.
import { Router } from "express";
import { Readable } from "node:stream";
import { requireAuth } from "../lib/auth.js";
import {
  deleteDocument,
  fetchBlobResponse,
  getDocument,
  listCategories,
  listDocuments,
  registerDocument,
} from "../services/documents.js";

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

// Listing avec filtres catégorie / tag / recherche / dates.
documentsRouter.get("/", async (req, res, next) => {
  try {
    const { category, tag, q, from, to } = req.query;
    const docs = await listDocuments(req.ownerId, { category, tag, q, from, to });
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ documents: docs.map((d) => d.toClient()) });
  } catch (err) {
    next(err);
  }
});

documentsRouter.get("/categories", async (req, res, next) => {
  try {
    const categories = await listCategories(req.ownerId);
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
    const { filename, mimetype, category, tags, size, blobPath, blobUrl } =
      req.body || {};
    if (!filename || !blobPath || !blobUrl) {
      return res.status(400).json({ error: "Métadonnées incomplètes." });
    }
    if (!blobPath.startsWith(`documents/${req.ownerId}/`)) {
      return res.status(400).json({ error: "Chemin de blob non autorisé." });
    }
    const doc = await registerDocument(req.ownerId, {
      filename,
      mimetype: mimetype || "application/octet-stream",
      category: category || "divers",
      tags: Array.isArray(tags) ? tags.filter(Boolean) : [],
      size: Number(size) || 0,
      source: "web",
      blobPath,
      blobUrl,
    });
    res.status(201).json({ document: doc.toClient() });
  } catch (err) {
    next(err);
  }
});

documentsRouter.get("/:id", async (req, res, next) => {
  try {
    const doc = await getDocument(req.ownerId, req.params.id);
    if (!doc) return res.status(404).json({ error: "Document introuvable." });
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ document: doc.toClient() });
  } catch (err) {
    next(err);
  }
});

// Proxy de consultation/téléchargement : session vérifiée → blob récupéré
// côté serveur via BLOB_READ_WRITE_TOKEN → flux streamé au client.
documentsRouter.get("/:id/file", async (req, res, next) => {
  try {
    const doc = await getDocument(req.ownerId, req.params.id);
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
    const deleted = await deleteDocument(req.ownerId, req.params.id);
    if (!deleted) return res.status(404).json({ error: "Document introuvable." });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
