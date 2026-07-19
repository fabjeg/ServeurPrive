// Embeddings texte (Google, même clé que le chat/résumé) — recherche
// sémantique app-level (pas d'Atlas Vector Search, voir CLAUDE.md).
import { GoogleGenAI } from "@google/genai";
import { env } from "./env.js";

// Nom de modèle explicite (pas d'alias -latest) — même prudence que
// server/lib/llm-chat.js après un précédent incident de renommage silencieux.
// "text-embedding-004" n'est plus servi par cette clé API (404) — confirmé
// via ai.models.list() que seul gemini-embedding-001/-2 supportent
// embedContent aujourd'hui.
const MODEL = "gemini-embedding-001";

export async function embedText(text) {
  const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });
  const res = await ai.models.embedContent({ model: MODEL, contents: text });
  return res.embeddings?.[0]?.values || [];
}

export function cosineSimilarity(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
