// Boucle de chat Gemini avec streaming + tool calling (function calling), pour
// le chatbot documentaire (server/routes/chat.js). Séparé de llm.js pour ne pas
// complexifier askLLM(), qui reste la fonction simple texte-only utilisée par
// le résumé automatique (server/services/summarize.js).
import { ApiError, GoogleGenAI } from "@google/genai";
import { env } from "./env.js";

const MODEL = "gemini-flash-lite-latest";
const MAX_TOOL_ROUNDS = 6;

// Les tools existants sont déclarés au format Anthropic (name, description,
// input_schema en JSON Schema brut). Gemini accepte ce même JSON Schema tel
// quel via `parametersJsonSchema` (mutuellement exclusif avec `parameters`,
// qui lui attend le format Schema/Type propriétaire de Gemini) — donc pas de
// conversion de schéma nécessaire, seulement un renommage de champs.
function toGeminiTools(tools) {
  if (!tools?.length) return undefined;
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parametersJsonSchema: t.input_schema,
      })),
    },
  ];
}

// history : [{ role: "user" | "assistant", content: string }]
function toInitialContents(history) {
  return history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

// Erreurs Gemini traduites en message générique, jamais de détails internes
// (même contrainte que llm.js) — le status HTTP suffit à distinguer quota vs clé.
function friendlyError(err) {
  const status = err instanceof ApiError ? err.status : err?.status;
  if (status === 429) return "Quota Gemini dépassé — réessaie dans un instant.";
  if (status === 401 || status === 403) return "Clé API Gemini invalide.";
  return "Erreur du chatbot, réessaie.";
}

/**
 * Fait tourner une conversation avec tool calling jusqu'à réponse finale.
 *
 * @param {object} params
 * @param {{role: "user"|"assistant", content: string}[]} params.history
 * @param {string} params.system - instruction système (texte simple)
 * @param {{name: string, description: string, input_schema: object}[]} params.tools
 * @param {(name: string, args: object) => Promise<any>} params.runTool - exécute
 *   un tool et renvoie son résultat JS (sérialisé en JSON pour le modèle) ; les
 *   erreurs métier doivent être renvoyées comme `{ error: "..." }`, pas levées.
 * @param {(text: string) => void} params.onDelta - appelé pour chaque fragment de texte streamé
 * @param {(call: { name: string, args: object }) => void} [params.onToolCall] - appelé avant l'exécution d'un tool
 */
export async function runChatLoop({ history, system, tools, runTool, onDelta, onToolCall }) {
  const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });
  const geminiTools = toGeminiTools(tools);
  const contents = toInitialContents(history);

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const stream = await ai.models.generateContentStream({
      model: MODEL,
      contents,
      config: {
        systemInstruction: system,
        ...(geminiTools ? { tools: geminiTools } : {}),
      },
    });

    // On reconstruit le tour "model" complet (texte + functionCall) à partir
    // des chunks streamés, pour pouvoir le rejouer dans `contents` au tour
    // suivant si le modèle a demandé un tool (Gemini est stateless par appel,
    // comme Claude : tout l'historique doit être renvoyé à chaque requête).
    const modelParts = [];
    let sawFunctionCall = false;
    for await (const chunk of stream) {
      const parts = chunk.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        // On repousse la part telle quelle (pas de reconstruction) : les modèles
        // "thinking" (gemini-3.5) attachent un `thoughtSignature` aux parts de
        // functionCall, qui DOIT être rejoué à l'identique au tour suivant —
        // sinon l'API renvoie 400 INVALID_ARGUMENT ("missing thought_signature").
        modelParts.push(part);
        if (part.text) onDelta(part.text);
        else if (part.functionCall) sawFunctionCall = true;
      }
    }

    if (!sawFunctionCall || round === MAX_TOOL_ROUNDS) return;

    contents.push({ role: "model", parts: modelParts });

    const responseParts = [];
    for (const part of modelParts) {
      if (!part.functionCall) continue;
      const { id, name, args } = part.functionCall;
      onToolCall?.({ name, args: args || {} });
      let result;
      try {
        result = await runTool(name, args || {});
      } catch (err) {
        console.error(`Tool ${name} a échoué :`, err);
        result = { error: "Erreur interne pendant l'exécution de l'outil." };
      }
      responseParts.push({
        functionResponse: {
          id,
          name,
          response: result?.error ? { error: result.error } : { output: result },
        },
      });
    }
    contents.push({ role: "user", parts: responseParts });
  }
}

export { friendlyError };
