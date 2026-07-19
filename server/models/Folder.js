// Dossier = référentiel d'un modèle de frigo (ex. « xarios 200 ») ou d'une
// marque (ex. « carrier ») : regroupe des documents et/ou des dossiers
// enfants. Nom en minuscules, comme les catégories/tags (la capitalisation
// est purement affichage côté client).
import mongoose from "mongoose";

const folderSchema = new mongoose.Schema(
  {
    // Les dossiers sont un concept pro uniquement côté UI (l'espace perso
    // reste une liste plate), mais le champ existe pour que folders.js
    // applique la même garantie de cloisonnement que documents.js.
    space: { type: String, enum: ["pro", "perso"], required: true, default: "pro" },
    // Dossier parent (marque) — null = dossier de premier niveau (marque).
    // Profondeur plafonnée à 1 (un dossier enfant ne peut pas avoir lui-même
    // d'enfant) : garantie dans services/folders.js (assertValidParent),
    // pas ici — Mongoose ne peut pas valider ça sans aller-retour DB.
    parentId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    name: { type: String, required: true, trim: true, lowercase: true, maxlength: 80 },
    description: { type: String, default: "", trim: true, maxlength: 300 },
    ownerId: { type: String, required: true, index: true },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

folderSchema.index({ ownerId: 1, space: 1, parentId: 1, name: 1 }, { unique: true });

folderSchema.methods.toClient = function toClient() {
  return {
    id: this._id.toString(),
    space: this.space,
    parentId: this.parentId ? this.parentId.toString() : null,
    name: this.name,
    description: this.description,
    createdAt: this.createdAt,
  };
};

export const Folder = mongoose.models.Folder || mongoose.model("Folder", folderSchema);
