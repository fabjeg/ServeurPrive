// Extraction automatique des informations clés d'un document (chatbot d'analyse) :
// modèle d'équipement (→ dossier), type de document (→ catégorie), version,
// tags. Sortie structurée garantie par output_config.format (json_schema).
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../lib/env.js";

const MODEL = "claude-opus-4-8";
const MAX_ANALYZE_CHARS = 15000; // les premières pages suffisent (titre, modèle, révision)

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    model: {
      type: ["string", "null"],
      description:
        "Modèle d'équipement frigorifique concerné, en minuscules avec la marque si connue " +
        "(ex. « carrier xarios 200 », « thermo king v-500 »). null si indéterminable.",
    },
    category: {
      type: ["string", "null"],
      description:
        "Type de document en minuscules (ex. « manuel atelier », « notice utilisateur », " +
        "« schema electrique », « plan », « facture », « fiche technique »). null si indéterminable.",
    },
    version: {
      type: ["string", "null"],
      description: "Version, révision ou année du document (ex. « 2019 », « rev c »). null sinon.",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "3 à 6 mots-clés utiles en minuscules (composants, thèmes : « degivrage », « compresseur »…)",
    },
    description: {
      type: ["string", "null"],
      description: "Une phrase décrivant le document, en français.",
    },
  },
  required: ["model", "category", "version", "tags", "description"],
  additionalProperties: false,
};

// Analyse le texte d'un document et renvoie les métadonnées détectées.
// existingFolders / existingCategories guident le modèle vers les libellés
// déjà utilisés dans le coffre (cohérence du classement).
export async function analyzeDocumentText({ filename, text, existingFolders, existingCategories }) {
  const client = new Anthropic({ apiKey: env.anthropicApiKey });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    system:
      "Tu analyses des documents techniques d'un frigoriste (notices, manuels, schémas de groupes froids) " +
      "pour les classer automatiquement. Réutilise les libellés existants quand ils correspondent " +
      "(même équipement, même type) plutôt que d'en inventer des variantes.\n" +
      `Dossiers existants (modèles d'équipement) : ${existingFolders.length ? existingFolders.join(", ") : "aucun"}.\n` +
      `Catégories existantes : ${existingCategories.length ? existingCategories.join(", ") : "aucune"}.`,
    messages: [
      {
        role: "user",
        content:
          `Nom du fichier : ${filename}\n\n--- Début du contenu extrait ---\n${text.slice(0, MAX_ANALYZE_CHARS)}\n--- Fin ---\n\n` +
          "Identifie le modèle d'équipement, le type de document, la version et des tags.",
      },
    ],
  });

  if (response.stop_reason === "refusal") return null;
  const block = response.content.find((b) => b.type === "text");
  if (!block) return null;
  try {
    return JSON.parse(block.text);
  } catch {
    return null;
  }
}
