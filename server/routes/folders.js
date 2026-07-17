// Routes dossiers (modèles de frigo) + interventions — toutes derrière requireAuth.
import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import {
  createFolder,
  createIntervention,
  deleteFolder,
  deleteIntervention,
  getFolderDetail,
  listFolders,
  updateFolder,
  updateIntervention,
} from "../services/folders.js";

export const foldersRouter = Router();
foldersRouter.use(requireAuth);

foldersRouter.get("/", async (req, res, next) => {
  try {
    const result = await listFolders(req.ownerId);
    res.setHeader("Cache-Control", "private, no-store");
    res.json(result);
  } catch (err) {
    next(err);
  }
});

foldersRouter.post("/", async (req, res, next) => {
  try {
    const { name, description } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "Nom de dossier requis." });
    }
    const folder = await createFolder(req.ownerId, { name, description });
    res.status(201).json({ folder: folder.toClient() });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: "Un dossier porte déjà ce nom." });
    }
    next(err);
  }
});

foldersRouter.get("/:id", async (req, res, next) => {
  try {
    const detail = await getFolderDetail(req.ownerId, req.params.id);
    if (!detail) return res.status(404).json({ error: "Dossier introuvable." });
    res.setHeader("Cache-Control", "private, no-store");
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

foldersRouter.patch("/:id", async (req, res, next) => {
  try {
    const { name, description } = req.body || {};
    const folder = await updateFolder(req.ownerId, req.params.id, { name, description });
    if (!folder) return res.status(404).json({ error: "Dossier introuvable." });
    res.json({ folder: folder.toClient() });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: "Un dossier porte déjà ce nom." });
    }
    next(err);
  }
});

// Supprime le dossier et ses interventions ; les documents sont détachés.
foldersRouter.delete("/:id", async (req, res, next) => {
  try {
    const deleted = await deleteFolder(req.ownerId, req.params.id);
    if (!deleted) return res.status(404).json({ error: "Dossier introuvable." });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

foldersRouter.post("/:id/interventions", async (req, res, next) => {
  try {
    const { title, note, durationMinutes, steps } = req.body || {};
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: "Titre d'intervention requis." });
    }
    const intervention = await createIntervention(req.ownerId, req.params.id, {
      title,
      note,
      durationMinutes,
      steps,
    });
    if (!intervention) return res.status(404).json({ error: "Dossier introuvable." });
    res.status(201).json({ intervention: intervention.toClient() });
  } catch (err) {
    next(err);
  }
});

foldersRouter.patch("/:id/interventions/:iid", async (req, res, next) => {
  try {
    const { title, note, durationMinutes, steps } = req.body || {};
    const intervention = await updateIntervention(req.ownerId, req.params.iid, {
      title,
      note,
      durationMinutes,
      steps,
    });
    if (!intervention) return res.status(404).json({ error: "Intervention introuvable." });
    res.json({ intervention: intervention.toClient() });
  } catch (err) {
    next(err);
  }
});

foldersRouter.delete("/:id/interventions/:iid", async (req, res, next) => {
  try {
    const deleted = await deleteIntervention(req.ownerId, req.params.iid);
    if (!deleted) return res.status(404).json({ error: "Intervention introuvable." });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
