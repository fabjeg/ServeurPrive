// Routes documentaires — TOUTES derrière requireAuth, y compris listing et
// téléchargement. Le client ne voit jamais d'URL Blob : consultation via proxy.
import { Router } from "express";
import { Readable } from "node:stream";
import { requireAuth } from "../lib/auth.js";
import {
  deleteDocument,
  extractDocumentText,
  fetchBlobResponse,
  getDocument,
  listCategories,
  listDocuments,
  registerDocument,
  updateDocument,
} from "../services/documents.js";
import { getOrCreateFolder, listFolders, resolveFolderId } from "../services/folders.js";
import { analyzeDocumentText } from "../services/analyze.js";

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

// Listing avec filtres catégorie / tag / recherche / dates.
documentsRouter.get("/", async (req, res, next) => {
  try {
    const { category, tag, q, from, to, folder } = req.query;
    const docs = await listDocuments(req.ownerId, { category, tag, q, from, to, folder });
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
    const { filename, mimetype, category, tags, size, blobPath, blobUrl, folderId } =
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
      // Un folderId inconnu ou étranger est simplement ignoré (null).
      folderId: await resolveFolderId(req.ownerId, folderId),
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
    const doc = await getDocument(req.ownerId, req.params.id);
    if (!doc) return res.status(404).json({ error: "Document introuvable." });

    const extracted = await extractDocumentText(doc);
    if (!extracted.ok) return res.json({ analyzed: false, reason: extracted.reason });

    const [{ folders }, categories] = await Promise.all([
      listFolders(req.ownerId),
      listCategories(req.ownerId),
    ]);
    const detected = await analyzeDocumentText({
      filename: doc.filename,
      text: extracted.text,
      existingFolders: folders.map((f) => f.name),
      existingCategories: categories.map((c) => c._id),
    });
    if (!detected) return res.json({ analyzed: false, reason: "Analyse impossible." });

    if (detected.model && !doc.folderId) {
      const folder = await getOrCreateFolder(req.ownerId, detected.model);
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
    await doc.save();

    res.json({ analyzed: true, detected, document: doc.toClient() });
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

// Mise à jour des métadonnées (dont rattachement à un dossier).
documentsRouter.patch("/:id", async (req, res, next) => {
  try {
    const { filename, category, tags, description, folderId } = req.body || {};
    const doc = await updateDocument(req.ownerId, req.params.id, {
      filename,
      category,
      tags: Array.isArray(tags) ? tags.filter(Boolean) : undefined,
      description,
      // folderId : absent = inchangé, null/"" = détacher, sinon dossier validé.
      folderId:
        folderId === undefined ? undefined : await resolveFolderId(req.ownerId, folderId),
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
