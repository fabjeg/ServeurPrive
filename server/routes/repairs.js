// Routes dépannages — toutes derrière requireAuth. `space` obligatoire sur
// chaque route (query en lecture, body en écriture), même gabarit que
// routes/folders.js.
import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { createRepair, deleteRepair, listRepairs, updateRepair } from "../services/repairs.js";

export const repairsRouter = Router();
repairsRouter.use(requireAuth);

function parseSpace(value) {
  return value === "pro" || value === "perso" ? value : null;
}

const SPACE_ERROR = { error: "Paramètre space requis (pro ou perso)." };

repairsRouter.get("/", async (req, res, next) => {
  try {
    const space = parseSpace(req.query.space);
    if (!space) return res.status(400).json(SPACE_ERROR);
    const repairs = await listRepairs(req.ownerId, space, {
      folderId: req.query.folderId,
      q: req.query.q,
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ repairs });
  } catch (err) {
    next(err);
  }
});

repairsRouter.post("/", async (req, res, next) => {
  try {
    const space = parseSpace(req.body?.space);
    if (!space) return res.status(400).json(SPACE_ERROR);
    const { symptom } = req.body || {};
    if (!symptom || !String(symptom).trim()) {
      return res.status(400).json({ error: "Symptôme requis." });
    }
    const repair = await createRepair(req.ownerId, space, req.body || {});
    res.status(201).json({ repair: repair.toClient() });
  } catch (err) {
    next(err);
  }
});

repairsRouter.patch("/:id", async (req, res, next) => {
  try {
    const space = parseSpace(req.body?.space);
    if (!space) return res.status(400).json(SPACE_ERROR);
    const repair = await updateRepair(req.ownerId, req.params.id, space, req.body || {});
    if (!repair) return res.status(404).json({ error: "Dépannage introuvable." });
    res.json({ repair: repair.toClient() });
  } catch (err) {
    next(err);
  }
});

repairsRouter.delete("/:id", async (req, res, next) => {
  try {
    const space = parseSpace(req.query.space);
    if (!space) return res.status(400).json(SPACE_ERROR);
    const deleted = await deleteRepair(req.ownerId, req.params.id, space);
    if (!deleted) return res.status(404).json({ error: "Dépannage introuvable." });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
