// Cas de dépannage : panne réelle rattachée (optionnellement) à un modèle,
// avec diagnostic et solution — historique consultable par Jarvis/MCP pour
// aider aux prochains dépannages (voir server/services/repairs.js).
import mongoose from "mongoose";

const repairSchema = new mongoose.Schema(
  {
    ownerId: { type: String, required: true, index: true },
    space: { type: String, enum: ["pro", "perso"], required: true, default: "pro" },
    // Modèle concerné, optionnel : un dépannage peut ne pas être rattaché à
    // un dossier catalogué. Pas de garantie référentielle stricte (comme
    // Document.folderId) — si le dossier est supprimé, folderId reste,
    // simplement non résolu à l'affichage.
    folderId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    symptom: { type: String, required: true, trim: true, maxlength: 300 },
    diagnosis: { type: String, default: "", trim: true, maxlength: 1000 },
    solution: { type: String, default: "", trim: true, maxlength: 1000 },
    faultCodes: { type: [String], default: [] },
    partsUsed: { type: [String], default: [] },
    resolved: { type: Boolean, default: true },
    source: { type: String, enum: ["manual", "jarvis"], default: "manual" },
    // Vecteur d'embedding (gemini-embedding-001) pour la recherche sémantique
    // app-level — voir server/lib/embeddings.js. Même convention que
    // Document.embedding : absent/vide = pas encore traité.
    embedding: { type: [Number], default: [] },
  },
  { versionKey: false, timestamps: true }
);

repairSchema.index({ ownerId: 1, space: 1, createdAt: -1 });

repairSchema.methods.toClient = function toClient() {
  return {
    id: this._id.toString(),
    folderId: this.folderId ? this.folderId.toString() : null,
    symptom: this.symptom,
    diagnosis: this.diagnosis,
    solution: this.solution,
    faultCodes: this.faultCodes,
    partsUsed: this.partsUsed,
    resolved: this.resolved,
    source: this.source,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const Repair = mongoose.models.Repair || mongoose.model("Repair", repairSchema);
