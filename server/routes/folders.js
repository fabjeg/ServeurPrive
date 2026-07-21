// Routes dossiers (modèles de frigo) — toutes derrière requireAuth.
// `space` forcé à "pro" (constante, jamais dérivée du client) — app
// mono-espace, voir routes/documents.js.
import { Router } from "express";
import { Readable } from "node:stream";
import { requireAuth } from "../lib/auth.js";
import { env } from "../lib/env.js";
import {
  createFolder,
  deleteFolder,
  getFolder,
  getFolderDetail,
  listFolders,
  removeFolderLogo,
  setFolderLogo,
  updateFolder,
} from "../services/folders.js";

export const foldersRouter = Router();
foldersRouter.use(requireAuth);

function parseParentId(value) {
  if (value === undefined || value === "") return { ok: true, parentId: null };
  if (!/^[0-9a-fA-F]{24}$/.test(value)) return { ok: false };
  return { ok: true, parentId: value };
}

foldersRouter.get("/", async (req, res, next) => {
  try {
    const space = "pro";
    const parsed = parseParentId(req.query.parentId);
    if (!parsed.ok) return res.status(400).json({ error: "parentId invalide." });
    const result = await listFolders(req.ownerId, space, { parentId: parsed.parentId });
    res.setHeader("Cache-Control", "private, no-store");
    res.json(result);
  } catch (err) {
    next(err);
  }
});

foldersRouter.post("/", async (req, res, next) => {
  try {
    const space = "pro";
    const { name, description, parentId, hidden } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "Nom de dossier requis." });
    }
    const folder = await createFolder(req.ownerId, space, { name, description, parentId, hidden });
    res.status(201).json({ folder: folder.toClient() });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: "Un dossier porte déjà ce nom à ce niveau." });
    }
    if (err.message?.includes("parent")) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

foldersRouter.get("/:id", async (req, res, next) => {
  try {
    const space = "pro";
    const detail = await getFolderDetail(req.ownerId, req.params.id, space);
    if (!detail) return res.status(404).json({ error: "Dossier introuvable." });
    res.setHeader("Cache-Control", "private, no-store");
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

foldersRouter.patch("/:id", async (req, res, next) => {
  try {
    const space = "pro";
    const { name, description, parentId, specs, hidden } = req.body || {};
    const folder = await updateFolder(req.ownerId, req.params.id, space, {
      name,
      description,
      parentId,
      specs,
      hidden,
    });
    if (!folder) return res.status(404).json({ error: "Dossier introuvable." });
    res.json({ folder: folder.toClient() });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: "Un dossier porte déjà ce nom à ce niveau." });
    }
    if (err.message?.includes("parent")) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

foldersRouter.get("/:id/logo", async (req, res, next) => {
  try {
    const space = "pro";
    const folder = await getFolder(req.ownerId, req.params.id, space);
    if (!folder?.logo?.blobUrl) return res.status(404).json({ error: "Pas de logo." });

    const blobRes = await fetch(folder.logo.blobUrl, {
      headers: { authorization: `Bearer ${env.blobToken}` },
    });
    if (!blobRes.ok || !blobRes.body) return res.status(502).json({ error: "Blob inaccessible." });

    res.setHeader("Content-Type", folder.logo.mimetype || "application/octet-stream");
    res.setHeader("Cache-Control", "private, no-store");
    Readable.fromWeb(blobRes.body).pipe(res);
  } catch (err) {
    next(err);
  }
});

foldersRouter.post("/:id/logo", async (req, res, next) => {
  try {
    const space = "pro";
    const { data, mimetype } = req.body || {};
    if (!data || !mimetype) {
      return res.status(400).json({ error: "data (base64) et mimetype requis." });
    }
    if (!LOGO_ALLOWED_MIME.includes(mimetype)) {
      return res.status(400).json({ error: "Format non autorisé (png, jpeg, webp ou svg)." });
    }
    const buffer = Buffer.from(data, "base64");
    if (buffer.length > LOGO_MAX_BYTES) {
      return res.status(413).json({ error: "Logo trop volumineux (2 Mo max)." });
    }
    const folder = await setFolderLogo(req.ownerId, req.params.id, space, {
      buffer: new Uint8Array(buffer),
      mimetype,
    });
    if (!folder) return res.status(404).json({ error: "Dossier introuvable." });
    res.json({ folder: folder.toClient() });
  } catch (err) {
    next(err);
  }
});

foldersRouter.delete("/:id/logo", async (req, res, next) => {
  try {
    const space = "pro";
    const folder = await removeFolderLogo(req.ownerId, req.params.id, space);
    if (!folder) return res.status(404).json({ error: "Dossier introuvable." });
    res.json({ folder: folder.toClient() });
  } catch (err) {
    next(err);
  }
});

// Supprime le dossier (et ses modèles enfants le cas échéant) ; les documents sont détachés.
foldersRouter.delete("/:id", async (req, res, next) => {
  try {
    const space = "pro";
    const deleted = await deleteFolder(req.ownerId, req.params.id, space);
    if (!deleted) return res.status(404).json({ error: "Dossier introuvable." });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
