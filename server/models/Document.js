// Métadonnées uniquement — les fichiers eux-mêmes vivent dans Vercel Blob (privé).
import mongoose from "mongoose";

const documentSchema = new mongoose.Schema(
  {
    // Cloisonnement pro/perso — toute route et tout accès MCP doivent filtrer
    // dessus. default "pro" pour la rétrocompatibilité (voir scripts/migrate-space.js).
    space: { type: String, enum: ["pro", "perso"], required: true, default: "pro" },
    filename: { type: String, required: true, trim: true },
    mimetype: { type: String, required: true },
    category: { type: String, default: "divers", trim: true, lowercase: true },
    tags: { type: [String], default: [] },
    // Dossier (modèle de frigo) auquel le document est rattaché — optionnel.
    folderId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
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
    // Résumé automatique généré à l'upload (Gemini) — best-effort, jamais
    // bloquant (voir server/services/summarize.js).
    summary: { type: String, default: "" },
    summaryStatus: {
      type: String,
      enum: ["pending", "done", "failed", "skipped"],
      default: "pending",
    },
    // Texte extrait à l'upload (PDF/texte) — sert au résumé Gemini ET à
    // l'index full-text ci-dessous, une seule extraction (voir
    // server/services/documents.js:processNewDocument). Jamais renvoyé au
    // client (potentiellement long), voir toClient().
    extractedText: { type: String, default: "" },
    uploadedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

documentSchema.index({ ownerId: 1, category: 1, uploadedAt: -1 });
documentSchema.index({ ownerId: 1, space: 1, uploadedAt: -1 });
// Un seul index texte possible par collection Mongo : filename pèse le plus
// lourd (nom de fichier explicite), puis tags, puis le corps extrait. Géré
// à la main dans scripts/migrate-space.js (pas d'auto-index en prod pour un
// changement de forme d'index texte existant).
documentSchema.index(
  { filename: "text", tags: "text", extractedText: "text" },
  { weights: { filename: 10, tags: 5, extractedText: 1 }, name: "document_text_search" }
);

// Représentation publique : sans blobPath/blobUrl.
documentSchema.methods.toClient = function toClient() {
  return {
    id: this._id.toString(),
    space: this.space,
    filename: this.filename,
    mimetype: this.mimetype,
    category: this.category,
    tags: this.tags,
    folderId: this.folderId ? this.folderId.toString() : null,
    size: this.size,
    source: this.source,
    sourceUrl: this.sourceUrl,
    description: this.description,
    summary: this.summary,
    summaryStatus: this.summaryStatus,
    uploadedAt: this.uploadedAt,
  };
};

export const Document =
  mongoose.models.Document || mongoose.model("Document", documentSchema);
