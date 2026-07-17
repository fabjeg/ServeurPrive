// Intervention fréquente rattachée à un dossier (modèle de frigo) :
// une procédure courte avec durée estimée et étapes ordonnées.
import mongoose from "mongoose";

const interventionSchema = new mongoose.Schema(
  {
    ownerId: { type: String, required: true, index: true },
    folderId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    // Note courte affichée sous le titre (ex. « accès direct depuis la cabine »).
    note: { type: String, default: "", trim: true, maxlength: 200 },
    durationMinutes: { type: Number, default: 0, min: 0, max: 6000 },
    steps: { type: [String], default: [] },
  },
  { versionKey: false, timestamps: true }
);

interventionSchema.methods.toClient = function toClient() {
  return {
    id: this._id.toString(),
    folderId: this.folderId.toString(),
    title: this.title,
    note: this.note,
    durationMinutes: this.durationMinutes,
    steps: this.steps,
    updatedAt: this.updatedAt,
  };
};

export const Intervention =
  mongoose.models.Intervention || mongoose.model("Intervention", interventionSchema);
