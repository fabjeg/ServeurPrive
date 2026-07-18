// Dossier = référentiel d'un modèle de frigo (ex. « carrier xarios 200 ») :
// regroupe des documents et des interventions. Nom en minuscules, comme les
// catégories/tags (la capitalisation est purement affichage côté client).
import mongoose from "mongoose";

const folderSchema = new mongoose.Schema(
  {
    // Les dossiers sont un concept pro uniquement côté UI (l'espace perso
    // reste une liste plate), mais le champ existe pour que folders.js
    // applique la même garantie de cloisonnement que documents.js.
    space: { type: String, enum: ["pro", "perso"], required: true, default: "pro" },
    name: { type: String, required: true, trim: true, lowercase: true, maxlength: 80 },
    description: { type: String, default: "", trim: true, maxlength: 300 },
    ownerId: { type: String, required: true, index: true },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

folderSchema.index({ ownerId: 1, space: 1, name: 1 }, { unique: true });

folderSchema.methods.toClient = function toClient() {
  return {
    id: this._id.toString(),
    space: this.space,
    name: this.name,
    description: this.description,
    createdAt: this.createdAt,
  };
};

export const Folder = mongoose.models.Folder || mongoose.model("Folder", folderSchema);
