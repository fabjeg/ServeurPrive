// Logique dossiers (modèles de frigo) + interventions, partagée REST / MCP.
// Les dossiers sont un concept pro-only côté UI, mais toutes les fonctions
// qui touchent Folder/Document exigent `space` en défense en profondeur
// (même garantie de cloisonnement que server/services/documents.js).
import { connectDb } from "../lib/db.js";
import { Document } from "../models/Document.js";
import { Folder } from "../models/Folder.js";
import { Intervention } from "../models/Intervention.js";

const isObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(String(id || ""));

function requireSpace(space) {
  if (space !== "pro" && space !== "perso") {
    throw new Error(`space invalide ou manquant : ${space}`);
  }
}

export async function listFolders(ownerId, space) {
  requireSpace(space);
  await connectDb();
  const [folders, docCounts, intCounts, unfiled] = await Promise.all([
    Folder.find({ ownerId, space }).sort({ name: 1 }),
    Document.aggregate([
      { $match: { ownerId, space, folderId: { $ne: null } } },
      { $group: { _id: "$folderId", count: { $sum: 1 } } },
    ]),
    Intervention.aggregate([
      { $match: { ownerId } },
      { $group: { _id: "$folderId", count: { $sum: 1 } } },
    ]),
    Document.countDocuments({ ownerId, space, folderId: null }),
  ]);
  const docsBy = new Map(docCounts.map((c) => [c._id.toString(), c.count]));
  const intsBy = new Map(intCounts.map((c) => [c._id.toString(), c.count]));
  return {
    folders: folders.map((f) => ({
      ...f.toClient(),
      documentCount: docsBy.get(f._id.toString()) || 0,
      interventionCount: intsBy.get(f._id.toString()) || 0,
    })),
    unfiledCount: unfiled,
  };
}

export async function getFolder(ownerId, id, space) {
  requireSpace(space);
  await connectDb();
  if (!isObjectId(id)) return null;
  return Folder.findOne({ _id: id, ownerId, space });
}

export async function findFolderByName(ownerId, space, name) {
  requireSpace(space);
  await connectDb();
  return Folder.findOne({ ownerId, space, name: String(name).trim().toLowerCase() });
}

export async function createFolder(ownerId, space, { name, description }) {
  requireSpace(space);
  await connectDb();
  return Folder.create({ ownerId, space, name, description: description || "" });
}

// Pour MCP : rattacher un document à un dossier par nom, créé au besoin.
export async function getOrCreateFolder(ownerId, space, name) {
  requireSpace(space);
  await connectDb();
  return Folder.findOneAndUpdate(
    { ownerId, space, name: String(name).trim().toLowerCase() },
    { $setOnInsert: { ownerId, space, description: "", createdAt: new Date() } },
    { upsert: true, new: true, runValidators: true }
  );
}

export async function updateFolder(ownerId, id, space, { name, description }) {
  const folder = await getFolder(ownerId, id, space);
  if (!folder) return null;
  if (name !== undefined) folder.name = name;
  if (description !== undefined) folder.description = description;
  await folder.save();
  return folder;
}

// Suppression d'un dossier : les documents sont détachés (jamais supprimés),
// les interventions — qui n'existent que dans ce contexte — sont supprimées.
export async function deleteFolder(ownerId, id, space) {
  const folder = await getFolder(ownerId, id, space);
  if (!folder) return false;
  await Document.updateMany({ ownerId, space, folderId: folder._id }, { $set: { folderId: null } });
  await Intervention.deleteMany({ ownerId, folderId: folder._id });
  await folder.deleteOne();
  return true;
}

// Détail complet d'un dossier : documents, répartition par catégorie,
// interventions et durée moyenne — tout ce qu'affiche la page dossier.
export async function getFolderDetail(ownerId, id, space) {
  const folder = await getFolder(ownerId, id, space);
  if (!folder) return null;
  const [documents, interventions] = await Promise.all([
    Document.find({ ownerId, space, folderId: folder._id }).sort({ uploadedAt: -1 }),
    Intervention.find({ ownerId, folderId: folder._id }).sort({ title: 1 }),
  ]);
  const categories = {};
  for (const d of documents) categories[d.category] = (categories[d.category] || 0) + 1;
  const durations = interventions.filter((i) => i.durationMinutes > 0);
  const avgDurationMinutes = durations.length
    ? Math.round(durations.reduce((s, i) => s + i.durationMinutes, 0) / durations.length)
    : null;
  return {
    folder: folder.toClient(),
    documents: documents.map((d) => d.toClient()),
    interventions: interventions.map((i) => i.toClient()),
    stats: {
      documentCount: documents.length,
      categories: Object.entries(categories)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      avgDurationMinutes,
    },
  };
}

// Les interventions n'ont pas leur propre champ `space` : l'accès est déjà
// cadré en amont par le dossier parent (créé/récupéré via un `space` validé,
// voir createIntervention ci-dessous et les routes qui l'appellent).
export async function listInterventions(ownerId, folderId) {
  await connectDb();
  if (!isObjectId(folderId)) return [];
  return Intervention.find({ ownerId, folderId }).sort({ title: 1 });
}

export async function getIntervention(ownerId, id) {
  await connectDb();
  if (!isObjectId(id)) return null;
  return Intervention.findOne({ _id: id, ownerId });
}

const cleanSteps = (steps) =>
  (Array.isArray(steps) ? steps : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 40);

export async function createIntervention(
  ownerId,
  folderId,
  space,
  { title, note, durationMinutes, steps }
) {
  const folder = await getFolder(ownerId, folderId, space);
  if (!folder) return null;
  return Intervention.create({
    ownerId,
    folderId: folder._id,
    title,
    note: note || "",
    durationMinutes: Number(durationMinutes) || 0,
    steps: cleanSteps(steps),
  });
}

export async function updateIntervention(ownerId, id, { title, note, durationMinutes, steps }) {
  const intervention = await getIntervention(ownerId, id);
  if (!intervention) return null;
  if (title !== undefined) intervention.title = title;
  if (note !== undefined) intervention.note = note;
  if (durationMinutes !== undefined) intervention.durationMinutes = Number(durationMinutes) || 0;
  if (steps !== undefined) intervention.steps = cleanSteps(steps);
  await intervention.save();
  return intervention;
}

export async function deleteIntervention(ownerId, id) {
  const intervention = await getIntervention(ownerId, id);
  if (!intervention) return false;
  await intervention.deleteOne();
  return true;
}

// Valide un folderId fourni par le client avant de l'écrire sur un document :
// null/absent = pas de dossier ; sinon il doit exister, appartenir à l'owner
// et au même space que le document (sinon on pourrait rattacher un document
// perso à un dossier pro ou vice versa).
export async function resolveFolderId(ownerId, space, folderId) {
  if (!folderId) return null;
  const folder = await getFolder(ownerId, folderId, space);
  return folder ? folder._id : null;
}
