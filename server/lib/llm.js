// Fournisseur LLM Gemini — alternative à Ollama pour les environnements sans
// modèle local. Appel serveur uniquement : la clé API ne doit jamais
// transiter vers le client (voir env.geminiApiKey, server/lib/env.js).
import { GoogleGenAI } from "@google/genai";
import { env } from "./env.js";

// Alias -latest volontairement évité — un changement de modèle silencieux
// côté Google a déjà cassé le chat une fois (gemini-3.5-flash s'est retrouvé
// à 20 requêtes/jour gratuites, gemini-2.5-flash fermé aux nouvelles clés).
// Mettre à jour ce nom manuellement, dans un commit dédié, si besoin de
// changer de modèle (résolu depuis gemini-flash-lite-latest le 2026-07-18).
const MODEL = "gemini-3.1-flash-lite";

// Le format `messages` (role/content façon Anthropic/OpenAI) n'est pas celui
// attendu par le SDK Gemini : les rôles "system" n'existent pas dans
// `contents` (ils passent par `systemInstruction`), et "assistant" devient
// "model". On sépare donc les messages système du reste de la conversation.
// `image` est optionnel et permet d'attacher une image inline (vision) à un
// message user, en plus du texte.
function toGeminiRequest(messages) {
  const systemParts = [];
  const contents = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (m?.role === "system") {
      if (typeof m.content === "string" && m.content) systemParts.push(m.content);
      continue;
    }
    const parts = [];
    if (typeof m?.content === "string" && m.content) parts.push({ text: m.content });
    if (m?.image?.data && m?.image?.mimeType) {
      parts.push({ inlineData: { mimeType: m.image.mimeType, data: m.image.data } });
    }
    if (!parts.length) continue;
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts,
    });
  }
  return {
    contents,
    systemInstruction: systemParts.length ? systemParts.join("\n\n") : undefined,
  };
}

// Envoie une conversation à Gemini et renvoie le texte de la réponse.
// messages : [{ role: "system" | "user" | "assistant", content: string, image?: { mimeType, data } }]
// `image.data` : base64 sans préfixe data:, pour un message user (vision).
// `responseSchema` (optionnel) : JSON Schema brut — force une sortie JSON
// valide (responseMimeType: "application/json"). Le texte renvoyé est alors
// le JSON sérialisé tel quel (à parser côté appelant), pas du texte libre.
export async function askLLM(messages, { responseSchema } = {}) {
  const { contents, systemInstruction } = toGeminiRequest(messages);
  if (!contents.length) {
    throw new Error("Aucun message utilisateur à envoyer.");
  }

  const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        ...(systemInstruction ? { systemInstruction } : {}),
        ...(responseSchema
          ? { responseMimeType: "application/json", responseJsonSchema: responseSchema }
          : {}),
      },
    });
    const text = response.text;
    if (!text) throw new Error("Réponse vide du modèle.");
    return text;
  } catch (err) {
    // Ne jamais logger la clé API : on journalise uniquement le statut/type
    // d'erreur renvoyé par le SDK, jamais la config du client ni les headers.
    const status = err?.status ?? err?.response?.status;
    console.error(`Erreur Gemini (${status ?? "inconnue"}) :`, err?.message || err);

    if (status === 429) throw new Error("Quota Gemini dépassé — réessayez plus tard.");
    if (status === 401 || status === 403) throw new Error("Clé API Gemini invalide.");
    throw new Error("Erreur lors de l'appel au modèle Gemini.");
  }
}
