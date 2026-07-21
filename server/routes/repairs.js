// Routes dépannages — toutes derrière requireAuth. `space` forcé à "pro"
// (constante, jamais dérivée du client) — app mono-espace, voir
// routes/documents.js.
import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { createRepair, deleteRepair, listRepairs, updateRepair } from "../services/repairs.js";

export const repairsRouter = Router();
repairsRouter.use(requireAuth);

repairsRouter.get("/", async (req, res, next) => {
  try {
    const space = "pro";
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
    const space = "pro";
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
    const space = "pro";
    const repair = await updateRepair(req.ownerId, req.params.id, space, req.body || {});
    if (!repair) return res.status(404).json({ error: "Dépannage introuvable." });
    res.json({ repair: repair.toClient() });
  } catch (err) {
    next(err);
  }
});

repairsRouter.delete("/:id", async (req, res, next) => {
  try {
    const space = "pro";
    const deleted = await deleteRepair(req.ownerId, req.params.id, space);
    if (!deleted) return res.status(404).json({ error: "Dépannage introuvable." });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
