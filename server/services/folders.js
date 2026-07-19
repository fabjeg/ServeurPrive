// Logique dossiers (modèles de frigo), partagée REST / MCP.
// Les dossiers sont un concept pro-only côté UI, mais toutes les fonctions
// qui touchent Folder/Document exigent `space` en défense en profondeur
// (même garantie de cloisonnement que server/services/documents.js).
//
// Hiérarchie à 2 niveaux : marque (parentId: null) → modèle (parentId =
// id de la marque). Profondeur plafonnée à 1, garantie ici par
// assertValidParent — jamais dans le schéma Mongoose.
import { connectDb } from "../lib/db.js";
import { Document } from "../models/Document.js";
import { Folder } from "../models/Folder.js";

const isObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(String(id || ""));

function requireSpace(space) {
  if (space !== "pro" && space !== "perso") {
    throw new Error(`space invalide ou manquant : ${space}`);
  }
}

// Un dossier parent doit lui-même être un dossier de premier niveau
// (parentId: null) — profondeur plafonnée à 1. Lève si parentId pointe vers
// un dossier introuvable, hors space/owner, ou qui a lui-même un parent.
async function assertValidParent(ownerId, space, parentId) {
  if (!parentId) return null;
  if (!isObjectId(parentId)) throw new Error("parentId invalide.");
  await connectDb();
  const parent = await Folder.findOne({ _id: parentId, ownerId, space });
  if (!parent) throw new Error("Dossier parent introuvable.");
  if (parent.parentId) throw new Error("Un dossier modèle ne peut pas avoir d'enfant (profondeur max 1).");
  return parent._id;
}

export async function listFolders(ownerId, space, { parentId = null } = {}) {
  requireSpace(space);
  await connectDb();
  const [folders, docCounts, unfiled] = await Promise.all([
    Folder.find({ ownerId, space, parentId }).sort({ name: 1 }),
    Document.aggregate([
      { $match: { ownerId, space, folderId: { $ne: null } } },
      { $group: { _id: "$folderId", count: { $sum: 1 } } },
    ]),
    Document.countDocuments({ ownerId, space, folderId: null }),
  ]);
  const docsBy = new Map(docCounts.map((c) => [c._id.toString(), c.count]));
  return {
    folders: folders.map((f) => ({
      ...f.toClient(),
      documentCount: docsBy.get(f._id.toString()) || 0,
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

// Recherche par nom sur TOUS les niveaux (marque ou modèle confondus) —
// scope volontairement plat : voir server/mcp/index.js pour la résolution
// marque/modèle. Limite connue et acceptée : si deux modèles de marques
// différentes portent le même nom, cette recherche est ambiguë (renvoie
// le premier trouvé) — app mono-utilisateur, pas de désambiguïsation UI.
export async function findFolderByName(ownerId, space, name) {
  requireSpace(space);
  await connectDb();
  return Folder.findOne({ ownerId, space, name: String(name).trim().toLowerCase() });
}

export async function createFolder(ownerId, space, { name, description, parentId }) {
  requireSpace(space);
  await connectDb();
  const validParentId = await assertValidParent(ownerId, space, parentId);
  return Folder.create({ ownerId, space, parentId: validParentId, name, description: description || "" });
}

// Pour MCP : rattacher un document à un dossier par nom, créé au besoin.
// `parentId` (facultatif) rattache le dossier créé sous une marque.
export async function getOrCreateFolder(ownerId, space, name, parentId = null) {
  requireSpace(space);
  await connectDb();
  return Folder.findOneAndUpdate(
    { ownerId, space, parentId, name: String(name).trim().toLowerCase() },
    { $setOnInsert: { ownerId, space, parentId, description: "", createdAt: new Date() } },
    { upsert: true, new: true, runValidators: true }
  );
}

export async function updateFolder(ownerId, id, space, { name, description, parentId }) {
  const folder = await getFolder(ownerId, id, space);
  if (!folder) return null;
  if (name !== undefined) folder.name = name;
  if (description !== undefined) folder.description = description;
  if (parentId !== undefined) folder.parentId = await assertValidParent(ownerId, space, parentId);
  await folder.save();
  return folder;
}

// Suppression d'un dossier : si c'est une marque avec des modèles enfants,
// ceux-ci sont supprimés aussi (cascade bornée à 1 niveau, jamais
// récursive puisque la profondeur est plafonnée à 1). Les documents,
// qu'ils soient attachés à la marque ou à un de ses modèles, sont toujours
// détachés (jamais supprimés).
export async function deleteFolder(ownerId, id, space) {
  const folder = await getFolder(ownerId, id, space);
  if (!folder) return false;
  const children = await Folder.find({ ownerId, space, parentId: folder._id });
  const allFolderIds = [folder._id, ...children.map((c) => c._id)];
  await Document.updateMany(
    { ownerId, space, folderId: { $in: allFolderIds } },
    { $set: { folderId: null } }
  );
  if (children.length) {
    await Folder.deleteMany({ _id: { $in: children.map((c) => c._id) } });
  }
  await folder.deleteOne();
  return true;
}

// Détail complet d'un dossier : documents et répartition par catégorie
// attachés directement à ce dossier, plus ses dossiers enfants le cas
// échéant (une marque liste ses modèles ; un modèle n'a jamais d'enfant).
export async function getFolderDetail(ownerId, id, space) {
  const folder = await getFolder(ownerId, id, space);
  if (!folder) return null;
  const [documents, childFolders] = await Promise.all([
    Document.find({ ownerId, space, folderId: folder._id }).sort({ uploadedAt: -1 }),
    folder.parentId ? [] : Folder.find({ ownerId, space, parentId: folder._id }).sort({ name: 1 }),
  ]);
  let childFolderCards = [];
  if (childFolders.length) {
    const childIds = childFolders.map((c) => c._id);
    const counts = await Document.aggregate([
      { $match: { ownerId, space, folderId: { $in: childIds } } },
      { $group: { _id: "$folderId", count: { $sum: 1 } } },
    ]);
    const countsBy = new Map(counts.map((c) => [c._id.toString(), c.count]));
    childFolderCards = childFolders.map((c) => ({
      ...c.toClient(),
      documentCount: countsBy.get(c._id.toString()) || 0,
    }));
  }
  const categories = {};
  for (const d of documents) categories[d.category] = (categories[d.category] || 0) + 1;
  return {
    folder: folder.toClient(),
    childFolders: childFolderCards,
    documents: documents.map((d) => d.toClient()),
    stats: {
      documentCount: documents.length,
      categories: Object.entries(categories)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
    },
  };
}

// Valide un folderId fourni par le client avant de l'écrire sur un document :
// null/absent = pas de dossier ; sinon il doit exister, appartenir à l'owner
// et au même space que le document (sinon on pourrait rattacher un document
// perso à un dossier pro ou vice versa). Fonctionne aussi bien pour une
// marque que pour un modèle : un document peut être attaché directement à
// une marque (section "non classés" de cette marque).
export async function resolveFolderId(ownerId, space, folderId) {
  if (!folderId) return null;
  const folder = await getFolder(ownerId, folderId, space);
  return folder ? folder._id : null;
}
