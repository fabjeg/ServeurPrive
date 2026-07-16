// Métadonnées uniquement — les fichiers eux-mêmes vivent dans Vercel Blob (privé).
import mongoose from "mongoose";

const documentSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true, trim: true },
    mimetype: { type: String, required: true },
    category: { type: String, default: "divers", trim: true, lowercase: true },
    tags: { type: [String], default: [] },
    // Chemin/URL du blob privé. Jamais renvoyé au client : la consultation
    // passe toujours par la route proxy authentifiée.
    blobPath: { type: String, required: true, unique: true },
    blobUrl: { type: String, required: true },
    ownerId: { type: String, required: true, index: true },
    size: { type: Number, default: 0 },
    // Origine du dépôt : interface web ou tool MCP (Claude).
    source: { type: String, enum: ["web", "claude"], default: "web" },
    // URL d'origine quand le document vient du web (traçabilité des dépôts IA).
    sourceUrl: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

documentSchema.index({ ownerId: 1, category: 1, uploadedAt: -1 });
documentSchema.index({ filename: "text", tags: "text" });

// Représentation publique : sans blobPath/blobUrl.
documentSchema.methods.toClient = function toClient() {
  return {
    id: this._id.toString(),
    filename: this.filename,
    mimetype: this.mimetype,
    category: this.category,
    tags: this.tags,
    size: this.size,
    source: this.source,
    sourceUrl: this.sourceUrl,
    description: this.description,
    uploadedAt: this.uploadedAt,
  };
};

export const Document =
  mongoose.models.Document || mongoose.model("Document", documentSchema);
