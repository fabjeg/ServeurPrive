// Extraction automatique des informations clés d'un document (chatbot d'analyse) :
// modèle d'équipement (→ dossier), type de document (→ catégorie), version,
// tags. Sortie structurée garantie par responseJsonSchema (Gemini).
import { askLLM } from "../lib/llm.js";

const MAX_ANALYZE_CHARS = 15000; // les premières pages suffisent (titre, modèle, révision)

// Champs nullable exprimés via `anyOf` plutôt que `type: ["string", "null"]` :
// c'est la forme explicitement supportée par responseJsonSchema (Gemini) —
// voir la liste des mots-clés JSON Schema pris en charge dans le SDK @google/genai.
const nullableString = (description) => ({
  anyOf: [{ type: "string" }, { type: "null" }],
  description,
});

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    model: nullableString(
      "Modèle d'équipement frigorifique concerné, en minuscules avec la marque si connue " +
        "(ex. « carrier xarios 200 », « thermo king v-500 »). null si indéterminable."
    ),
    category: nullableString(
      "Type de document en minuscules (ex. « manuel atelier », « notice utilisateur », " +
        "« schema electrique », « plan », « facture », « fiche technique »). null si indéterminable."
    ),
    version: nullableString("Version, révision ou année du document (ex. « 2019 », « rev c »). null sinon."),
    tags: {
      type: "array",
      items: { type: "string" },
      description: "3 à 6 mots-clés utiles en minuscules (composants, thèmes : « degivrage », « compresseur »…)",
    },
    description: nullableString("Une phrase décrivant le document, en français."),
  },
  required: ["model", "category", "version", "tags", "description"],
  additionalProperties: false,
};

// Analyse le texte d'un document et renvoie les métadonnées détectées, ou
// null en cas d'échec (quota Gemini, JSON invalide, etc.) — jamais d'exception
// propagée : l'appelant (route /:id/analyze) traite null comme "analyse
// impossible" sans jamais faire échouer la requête.
// existingFolders / existingCategories guident le modèle vers les libellés
// déjà utilisés dans le coffre (cohérence du classement).
export async function analyzeDocumentText({ filename, text, existingFolders, existingCategories }) {
  const system =
    "Tu analyses des documents techniques d'un frigoriste (notices, manuels, schémas de groupes froids) " +
    "pour les classer automatiquement. Réutilise les libellés existants quand ils correspondent " +
    "(même équipement, même type) plutôt que d'en inventer des variantes.\n" +
    `Dossiers existants (modèles d'équipement) : ${existingFolders.length ? existingFolders.join(", ") : "aucun"}.\n` +
    `Catégories existantes : ${existingCategories.length ? existingCategories.join(", ") : "aucune"}.`;

  const userContent =
    `Nom du fichier : ${filename}\n\n--- Début du contenu extrait ---\n${text.slice(0, MAX_ANALYZE_CHARS)}\n--- Fin ---\n\n` +
    "Identifie le modèle d'équipement, le type de document, la version et des tags.";

  try {
    const raw = await askLLM(
      [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
      { responseSchema: OUTPUT_SCHEMA }
    );
    return JSON.parse(raw);
  } catch (err) {
    console.error("Analyse auto échouée :", err.message || err);
    return null;
  }
}
