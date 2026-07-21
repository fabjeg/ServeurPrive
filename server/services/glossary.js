// Glossaire de codes défaut par marque — voir server/models/Glossary.js.
// Best-effort, jamais d'erreur : un glossaire absent/vide n'affecte jamais
// le comportement normal du chatbot (voir server/routes/chat.js, Mode ++).
import { connectDb } from "../lib/db.js";
import { Glossary } from "../models/Glossary.js";

export async function getGlossaryEntries(ownerId, space, brand) {
  if (!brand || !String(brand).trim()) return [];
  try {
    await connectDb();
    const doc = await Glossary.findOne({
      ownerId,
      space,
      brand: String(brand).trim().toLowerCase(),
    });
    return doc?.entries || [];
  } catch (err) {
    console.error("Lecture du glossaire échouée :", err?.message || err);
    return [];
  }
}
