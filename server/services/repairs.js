// Logique dépannages (historique de pannes), même forme que services/folders.js.
// Pro-only côté UI/assistant, mais `space` reste exigé partout en défense en
// profondeur (même garantie de cloisonnement que documents.js/folders.js).
import { waitUntil } from "@vercel/functions";
import { connectDb } from "../lib/db.js";
import { cosineSimilarity, embedText } from "../lib/embeddings.js";
import { Folder } from "../models/Folder.js";
import { Repair } from "../models/Repair.js";
import { resolveFolderId } from "./folders.js";

function requireSpace(space) {
  if (space !== "pro" && space !== "perso") {
    throw new Error(`space invalide ou manquant : ${space}`);
  }
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const isObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(String(id || ""));

// Best-effort, comme services/documents.js:embedDocument — ne bloque jamais
// createRepair/updateRepair, lancé via waitUntil pour ne pas ralentir la
// réponse du formulaire (voir server/services/documents.js pour le même
// pattern côté documents).
async function embedRepair(repairId) {
  try {
    await connectDb();
    const repair = await Repair.findById(repairId);
    if (!repair) return;
    const text = [repair.symptom, repair.diagnosis, repair.solution, repair.faultCodes.join(" ")]
      .filter(Boolean)
      .join(" — ");
    if (!text.trim()) return;
    const embedding = await embedText(text);
    if (embedding.length) {
      await Repair.findByIdAndUpdate(repairId, { embedding }).catch(() => {});
    }
  } catch (err) {
    console.error(`Embedding échoué pour le dépannage ${repairId} :`, err?.message || err);
  }
}

// Même principe que semanticSearchDocuments : similarité cosinus app-level,
// combinée (pas remplacée) avec listRepairs (regex) côté appelants.
export async function semanticSearchRepairs(ownerId, space, query, { folderId, limit = 10 } = {}) {
  requireSpace(space);
  if (!query || !String(query).trim()) return [];
  await connectDb();
  const queryEmbedding = await embedText(query).catch(() => []);
  if (!queryEmbedding.length) return [];
  const filter = { ownerId, space, embedding: { $ne: [] } };
  if (folderId && isObjectId(folderId)) filter.folderId = folderId;
  const repairs = await Repair.find(filter);
  const folderIds = [...new Set(repairs.filter((r) => r.folderId).map((r) => r.folderId.toString()))];
  const folders = folderIds.length ? await Folder.find({ _id: { $in: folderIds } }) : [];
  const namesById = new Map(folders.map((f) => [f._id.toString(), f.name]));
  return repairs
    .map((r) => ({ repair: r, score: cosineSimilarity(queryEmbedding, r.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ repair: r }) => ({
      ...r.toClient(),
      folderName: r.folderId ? namesById.get(r.folderId.toString()) || null : null,
    }));
}

export async function listRepairs(ownerId, space, { folderId, q, limit = 50 } = {}) {
  requireSpace(space);
  await connectDb();
  const filter = { ownerId, space };
  if (folderId && isObjectId(folderId)) filter.folderId = folderId;
  if (q) {
    const rx = new RegExp(escapeRegex(String(q).trim()), "i");
    filter.$or = [{ symptom: rx }, { diagnosis: rx }, { solution: rx }, { faultCodes: rx }];
  }
  const repairs = await Repair.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 200));

  const folderIds = [...new Set(repairs.filter((r) => r.folderId).map((r) => r.folderId.toString()))];
  const folders = folderIds.length
    ? await Folder.find({ _id: { $in: folderIds } })
    : [];
  const namesById = new Map(folders.map((f) => [f._id.toString(), f.name]));

  return repairs.map((r) => ({
    ...r.toClient(),
    folderName: r.folderId ? namesById.get(r.folderId.toString()) || null : null,
  }));
}

export async function getRepair(ownerId, id, space) {
  requireSpace(space);
  await connectDb();
  if (!isObjectId(id)) return null;
  return Repair.findOne({ _id: id, ownerId, space });
}

export async function createRepair(
  ownerId,
  space,
  { folderId, symptom, diagnosis, solution, faultCodes, partsUsed, resolved, source }
) {
  requireSpace(space);
  await connectDb();
  const resolvedFolderId = folderId ? await resolveFolderId(ownerId, space, folderId) : null;
  const repair = await Repair.create({
    ownerId,
    space,
    folderId: resolvedFolderId,
    symptom,
    diagnosis: diagnosis || "",
    solution: solution || "",
    faultCodes: (faultCodes || []).map((c) => String(c).trim()).filter(Boolean),
    partsUsed: (partsUsed || []).map((p) => String(p).trim()).filter(Boolean),
    resolved: resolved !== undefined ? resolved : true,
    source: source === "jarvis" ? "jarvis" : "manual",
  });
  waitUntil(embedRepair(repair._id));
  return repair;
}

export async function updateRepair(ownerId, id, space, patch) {
  const repair = await getRepair(ownerId, id, space);
  if (!repair) return null;
  const { folderId, symptom, diagnosis, solution, faultCodes, partsUsed, resolved } = patch;
  if (folderId !== undefined) {
    repair.folderId = folderId ? await resolveFolderId(ownerId, space, folderId) : null;
  }
  if (symptom !== undefined) repair.symptom = symptom;
  if (diagnosis !== undefined) repair.diagnosis = diagnosis;
  if (solution !== undefined) repair.solution = solution;
  if (faultCodes !== undefined) {
    repair.faultCodes = faultCodes.map((c) => String(c).trim()).filter(Boolean);
  }
  if (partsUsed !== undefined) {
    repair.partsUsed = partsUsed.map((p) => String(p).trim()).filter(Boolean);
  }
  if (resolved !== undefined) repair.resolved = resolved;
  await repair.save();
  waitUntil(embedRepair(repair._id));
  return repair;
}

export async function deleteRepair(ownerId, id, space) {
  const repair = await getRepair(ownerId, id, space);
  if (!repair) return false;
  await repair.deleteOne();
  return true;
}
