// Chatbot documentaire : Claude + outils branchés sur les services existants
// (recherche, extraction texte PDF, dossiers). Réponse en streaming SSE.
// Même règle que partout : rien sans authentification (requireAuth).
import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "../lib/auth.js";
import { env } from "../lib/env.js";
import {
  extractDocumentText,
  getDocument,
  listDocuments,
} from "../services/documents.js";
import { getFolderDetail, listFolders } from "../services/folders.js";

export const chatRouter = Router();

const MODEL = "claude-opus-4-8";
const MAX_TOOL_ROUNDS = 6;
const MAX_HISTORY_MESSAGES = 30;

const SYSTEM_PROMPT = `Tu es l'assistant du coffre documentaire « Frigo » d'un technicien frigoriste.
Le coffre contient des documents professionnels (notices PDF, schémas électriques, plans, photos)
classés dans des dossiers — un dossier correspond à un modèle de frigo/groupe froid (ex. « carrier xarios 200 »)
et regroupe aussi des interventions (procédures avec étapes et durées).

Ton rôle :
- retrouver les documents pertinents avec les outils de recherche, puis lire leur contenu pour répondre ;
- expliquer en détail quand on te le demande (fonctionnement, procédure, diagnostic), en t'appuyant d'abord
  sur le contenu des documents du coffre, complété par tes connaissances métier en froid/climatisation ;
- toujours citer le nom des documents utilisés dans ta réponse.

Règles :
- Réponds en français, de manière claire et directe.
- Réponds en texte simple, sans Markdown : pas de **gras** ni de titres #. Des tirets « - » pour les listes sont acceptés.
- Si aucun document ne correspond, dis-le franchement avant de répondre de mémoire.
- Les PDF scannés sans couche texte ne sont pas lisibles : signale-le si tu tombes dessus.
- Tu es en lecture seule : tu ne peux ni ajouter, ni modifier, ni supprimer quoi que ce soit.`;

const TOOLS = [
  {
    name: "search_documents",
    description:
      "Recherche des documents dans le coffre par mots-clés (nom de fichier, tags, catégorie). " +
      "Appelle cet outil dès que la question porte sur un équipement, une notice ou un schéma. " +
      "Essaie plusieurs variantes de mots-clés si la première recherche ne donne rien.",
    input_schema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Mots-clés (ex. « xarios », « schema electrique »)" },
        folder_id: { type: "string", description: "Limiter à un dossier (id MongoDB)" },
      },
      required: ["q"],
    },
  },
  {
    name: "read_document",
    description:
      "Lit le contenu texte d'un document (extraction du texte des PDF). " +
      "À utiliser après search_documents pour lire les documents pertinents avant de répondre.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id du document (renvoyé par search_documents)" },
      },
      required: ["id"],
    },
  },
  {
    name: "list_folders",
    description:
      "Liste les dossiers du coffre (un dossier = un modèle de frigo) avec le nombre de documents et d'interventions.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_folder",
    description:
      "Détail d'un dossier : ses documents, ses interventions (procédures, étapes, durées) et ses statistiques.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id du dossier (renvoyé par list_folders)" },
      },
      required: ["id"],
    },
  },
];

const docSummary = (d) => ({
  id: d.id || d._id?.toString(),
  filename: d.filename,
  category: d.category,
  tags: d.tags,
  description: d.description || undefined,
  mimetype: d.mimetype,
  folderId: d.folderId ? d.folderId.toString() : null,
  uploadedAt: d.uploadedAt,
});

async function runTool(ownerId, name, input) {
  switch (name) {
    case "search_documents": {
      const docs = await listDocuments(ownerId, {
        q: input.q,
        folder: input.folder_id,
        limit: 25,
      });
      if (!docs.length) return { results: [], note: "Aucun document trouvé pour ces mots-clés." };
      return { results: docs.map((d) => docSummary(d.toClient ? d.toClient() : d)) };
    }
    case "read_document": {
      const doc = await getDocument(ownerId, String(input.id || ""));
      if (!doc) return { error: "Document introuvable." };
      const extracted = await extractDocumentText(doc);
      if (!extracted.ok) return { filename: doc.filename, error: extracted.reason };
      return {
        filename: doc.filename,
        pages: extracted.pages,
        truncated: extracted.truncated || undefined,
        text: extracted.text,
      };
    }
    case "list_folders": {
      const { folders, unfiledCount } = await listFolders(ownerId);
      return {
        folders: folders.map((f) => ({
          id: f.id,
          name: f.name,
          description: f.description || undefined,
          documentCount: f.documentCount,
          interventionCount: f.interventionCount,
        })),
        unfiledCount,
      };
    }
    case "get_folder": {
      const detail = await getFolderDetail(ownerId, String(input.id || ""));
      if (!detail) return { error: "Dossier introuvable." };
      return {
        folder: detail.folder,
        documents: detail.documents.map(docSummary),
        interventions: detail.interventions,
        stats: detail.stats,
      };
    }
    default:
      return { error: `Outil inconnu : ${name}` };
  }
}

// Libellés affichés dans l'interface pendant que le modèle travaille.
const TOOL_LABELS = {
  search_documents: (i) => `Recherche « ${i.q} »`,
  read_document: () => "Lecture d'un document",
  list_folders: () => "Consultation des dossiers",
  get_folder: () => "Consultation d'un dossier",
};

chatRouter.post("/", requireAuth, async (req, res) => {
  if (!env.anthropicApiKey) {
    return res.status(503).json({
      error: "Chatbot non configuré : variable ANTHROPIC_API_KEY manquante.",
    });
  }

  // Historique côté client : uniquement des tours texte (les échanges d'outils
  // d'un tour précédent ne sont pas rejoués — le modèle re-cherche au besoin).
  const history = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const messages = history
    .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.text === "string")
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, content: m.text }));
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return res.status(400).json({ error: "Message utilisateur manquant." });
  }

  // Contexte optionnel : le document ouvert dans le viewer. Ajouté comme
  // second bloc système (après le bloc caché/cachable) pour que le modèle
  // sache de quel document on parle et le lise directement.
  const system = [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }];
  if (typeof req.body?.documentId === "string" && req.body.documentId) {
    const doc = await getDocument(req.ownerId, req.body.documentId).catch(() => null);
    if (doc) {
      system.push({
        type: "text",
        text:
          `L'utilisateur a actuellement ouvert le document « ${doc.filename} » ` +
          `(id: ${doc._id}, catégorie: ${doc.category}). Quand il dit « ce document », ` +
          `« cette notice » ou pose une question sans préciser, il parle de celui-ci : ` +
          `lis-le avec read_document(id: "${doc._id}") avant de répondre.`,
      });
    }
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const send = (event) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const client = new Anthropic({ apiKey: env.anthropicApiKey });
  let aborted = false;
  req.on("close", () => {
    aborted = true;
  });

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        system,
        tools: TOOLS,
        messages,
      });

      stream.on("text", (delta) => send({ type: "delta", text: delta }));
      const message = await stream.finalMessage();
      if (aborted) return;

      if (message.stop_reason !== "tool_use" || round === MAX_TOOL_ROUNDS) {
        if (message.stop_reason === "refusal") {
          send({ type: "error", message: "La demande a été refusée par le modèle." });
        }
        send({ type: "done" });
        return res.end();
      }

      messages.push({ role: "assistant", content: message.content });
      const toolResults = [];
      for (const block of message.content) {
        if (block.type !== "tool_use") continue;
        send({ type: "tool", label: TOOL_LABELS[block.name]?.(block.input) || block.name });
        let result;
        try {
          result = await runTool(req.ownerId, block.name, block.input);
        } catch (err) {
          console.error(`Tool ${block.name} a échoué :`, err);
          result = { error: "Erreur interne pendant l'exécution de l'outil." };
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
          is_error: Boolean(result?.error),
        });
      }
      messages.push({ role: "user", content: toolResults });
    }
  } catch (err) {
    console.error("Erreur chatbot :", err);
    send({
      type: "error",
      message:
        err instanceof Anthropic.AuthenticationError
          ? "Clé API Anthropic invalide."
          : err instanceof Anthropic.RateLimitError
            ? "Limite d'utilisation atteinte, réessaie dans un instant."
            : "Erreur du chatbot, réessaie.",
    });
    send({ type: "done" });
    res.end();
  }
});
