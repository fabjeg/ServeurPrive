// Test isolé du module Gemini, sans passer par une route HTTP.
// Usage : node --env-file=.env scripts/test-llm.mjs
import { askLLM } from "../server/lib/llm.js";

try {
  const reponse = await askLLM([{ role: "user", content: "Bonjour" }]);
  console.log("Réponse Gemini :\n");
  console.log(reponse);
} catch (err) {
  console.error("Échec :", err.message);
  process.exit(1);
}
