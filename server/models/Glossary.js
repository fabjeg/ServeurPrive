// Glossaire de codes défaut par marque (référentiel officiel du fabricant),
// distinct de Folder.specs.faultCodes (codes observés sur un modèle précis
// lors d'un dépannage) — voir server/services/glossary.js.
import mongoose from "mongoose";

const glossarySchema = new mongoose.Schema(
  {
    ownerId: { type: String, required: true, index: true },
    space: { type: String, enum: ["pro", "perso"], required: true, default: "pro" },
    brand: { type: String, required: true, trim: true, lowercase: true, maxlength: 60 },
    entries: {
      type: [
        {
          code: { type: String, trim: true, maxlength: 20 },
          description: { type: String, trim: true, maxlength: 500 },
        },
      ],
      default: [],
    },
  },
  { versionKey: false, timestamps: true }
);

glossarySchema.index({ ownerId: 1, space: 1, brand: 1 }, { unique: true });

export const Glossary = mongoose.models.Glossary || mongoose.model("Glossary", glossarySchema);
