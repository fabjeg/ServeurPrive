// Routes dossiers (modèles de frigo) — toutes derrière requireAuth.
// `space` obligatoire sur chaque route (query en lecture, body en écriture),
// même garantie de cloisonnement que routes/documents.js. Les dossiers sont
// un concept pro-only côté UI, mais la route reste générique.
import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import {
  createFolder,
  deleteFolder,
  getFolderDetail,
  listFolders,
  updateFolder,
} from "../services/folders.js";

export const foldersRouter = Router();
foldersRouter.use(requireAuth);

function parseSpace(value) {
  return value === "pro" || value === "perso" ? value : null;
}

const SPACE_ERROR = { error: "Paramètre space requis (pro ou perso)." };

function parseParentId(value) {
  if (value === undefined || value === "") return { ok: true, parentId: null };
  if (!/^[0-9a-fA-F]{24}$/.test(value)) return { ok: false };
  return { ok: true, parentId: value };
}

foldersRouter.get("/", async (req, res, next) => {
  try {
    const space = parseSpace(req.query.space);
    if (!space) return res.status(400).json(SPACE_ERROR);
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
    const space = parseSpace(req.body?.space);
    if (!space) return res.status(400).json(SPACE_ERROR);
    const { name, description, parentId } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "Nom de dossier requis." });
    }
    const folder = await createFolder(req.ownerId, space, { name, description, parentId });
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
    const space = parseSpace(req.query.space);
    if (!space) return res.status(400).json(SPACE_ERROR);
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
    const space = parseSpace(req.body?.space);
    if (!space) return res.status(400).json(SPACE_ERROR);
    const { name, description, parentId, specs } = req.body || {};
    const folder = await updateFolder(req.ownerId, req.params.id, space, {
      name,
      description,
      parentId,
      specs,
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

// Supprime le dossier (et ses modèles enfants le cas échéant) ; les documents sont détachés.
foldersRouter.delete("/:id", async (req, res, next) => {
  try {
    const space = parseSpace(req.query.space);
    if (!space) return res.status(400).json(SPACE_ERROR);
    const deleted = await deleteFolder(req.ownerId, req.params.id, space);
    if (!deleted) return res.status(404).json({ error: "Dossier introuvable." });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
