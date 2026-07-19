// Chatbot documentaire : Gemini + outils branchés sur les services existants
// (recherche, extraction texte PDF, dossiers). Réponse en streaming SSE.
// Même règle que partout : rien sans authentification (requireAuth).
import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { friendlyError, runChatLoop } from "../lib/llm-chat.js";
import {
  extractDocumentText,
  getDocument,
  listDocuments,
  semanticSearchDocuments,
  updateDocument,
} from "../services/documents.js";
import {
  getFolder,
  getFolderDetail,
  listFolders,
  resolveFolderLabel,
  updateFolder,
} from "../services/folders.js";
import { createRepair, listRepairs, semanticSearchRepairs } from "../services/repairs.js";
import { appendMessage, clearHistory, getHistory } from "../services/chatHistory.js";

export const chatRouter = Router();

// Le chatbot web n'existe que dans l'espace pro (décision produit : pas
// d'assistant IA en perso, documents sensibles type fiches de paie/contrats).
// Comme pour le MCP, cette constante est codée en dur et jamais dérivée du
// body de la requête — le client ne peut pas la faire dévier.
const SPACE = "pro";

const MAX_HISTORY_MESSAGES = 30;

const SYSTEM_PROMPT = `Tu es Jarvis, l'assistant du coffre documentaire « Frigo » d'un technicien frigoriste.
Le coffre contient des documents professionnels (notices PDF, schémas électriques, plans, photos)
classés dans des dossiers — un dossier correspond à un modèle de frigo/groupe froid (ex. « carrier xarios 200 »)
.

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
- Quand tu renvoies vers un document précis (a fortiori une page précise), ajoute juste après
  l'avoir cité un marqueur {{open:ID}} ou {{open:ID:PAGE}} (ID = identifiant renvoyé par
  search_documents/read_document, PAGE = numéro vu dans un marqueur « --- Page N --- » de
  read_document) — il devient un bouton cliquable qui ouvre directement le document à la bonne
  page. N'utilise ce marqueur que pour un document que tu as identifié avec certitude (jamais un ID
  halluciné) ; un simple nom de document sans avoir appelé search_documents/read_document ne suffit
  pas.
- Tu ne peux jamais supprimer un document ou un dossier : cette action reste interdite, quoi qu'on
  te demande.
- Tu peux en revanche déplacer un document vers un autre dossier (update_document, champ folder) et
  modifier ses métadonnées (nom de fichier, catégorie, tags, description) quand l'utilisateur te le
  demande explicitement, ou quand c'est une correction évidente et sans ambiguïté (ex. mauvaise
  catégorie détectée à l'upload). En cas de doute sur l'intention, demande confirmation avant d'agir.
- Quand on te demande de ranger/trier le coffre (ou une marque en particulier) : utilise
  search_documents (folder_id: "none" pour les non classés, ou sans filtre pour repérer un document
  déjà classé au mauvais endroit — chaque résultat indique son folderId actuel) et list_folders/
  get_folder pour connaître les modèles existants, lis le contenu si le nom de fichier ne suffit pas
  à trancher, puis déplace chaque document concerné directement avec update_document sans demander
  confirmation à chacun. Termine toujours par un récapitulatif de ce qui a été déplacé (et vers où).
- Tu peux aussi renseigner la fiche technique d'un modèle (update_model_specs) quand un document que
  tu viens de lire donne ces informations de façon fiable — jamais une valeur inventée ou supposée.
- Dis toujours à l'utilisateur ce que tu as modifié.

Historique de dépannage :
- Le coffre contient aussi un historique de cas de dépannage déjà résolus (symptôme, diagnostic,
  solution, codes défauts, pièces utilisées). Quand on te décrit une panne, consulte-le en premier
  avec search_repair_cases (mots-clés du symptôme et/ou modèle concerné) en complément des documents
  — plus cet historique grossit, plus tes réponses deviennent pertinentes.
- Quand un dépannage se conclut dans la conversation (panne résolue, ou tentative notable même non
  résolue), propose à l'utilisateur d'enregistrer le cas (résume symptôme/diagnostic/solution) et
  n'appelle log_repair_case qu'après un accord explicite de sa part dans le fil — jamais
  silencieusement, contrairement à update_document/update_model_specs qui peuvent s'exécuter sans
  demander si le contexte est sans ambiguïté.`;

const TOOLS = [
  {
    name: "search_documents",
    description:
      "Recherche des documents dans le coffre par mots-clés (nom de fichier, tags, catégorie), et/ou " +
      "liste-les par dossier. Appelle cet outil dès que la question porte sur un équipement, une " +
      "notice ou un schéma. Essaie plusieurs variantes de mots-clés si la première recherche ne " +
      "donne rien. Pour ranger le coffre : omets q et mets folder_id à \"none\" pour lister les " +
      "documents non classés, ou liste sans filtre pour repérer un document déjà mal classé (chaque " +
      "résultat indique son folderId actuel, à comparer avec list_folders/get_folder) avant de le " +
      "déplacer avec update_document.",
    input_schema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Mots-clés (ex. « xarios », « schema electrique »), optionnel si on filtre juste par dossier" },
        folder_id: {
          type: "string",
          description: "Limiter à un dossier (id MongoDB), ou \"none\" pour les documents non classés",
        },
        limit: { type: "number", description: "Nombre max de résultats (défaut 25, max 200)" },
      },
    },
  },
  {
    name: "read_document",
    description:
      "Lit le contenu texte d'un document (extraction du texte des PDF). " +
      "À utiliser après search_documents pour lire les documents pertinents avant de répondre. " +
      "Le texte des PDF est découpé par des marqueurs « --- Page N --- » : utilise-les pour citer " +
      "la page exacte où se trouve une information (voir le marqueur {{open:…}} plus bas).",
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
      "Liste les dossiers du coffre (un dossier = un modèle de frigo) avec le nombre de documents.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_folder",
    description:
      "Détail d'un dossier : ses documents et ses statistiques.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id du dossier (renvoyé par list_folders)" },
      },
      required: ["id"],
    },
  },
  {
    name: "update_document",
    description:
      "Modifie les métadonnées d'un document : nom de fichier, catégorie, tags, description " +
      "et/ou dossier de rattachement. Ne modifie jamais le fichier lui-même. Pour déplacer un " +
      "document vers un modèle, fournir folder (ex. « carrier xarios 350 » — créé au besoin) ; " +
      "chaîne vide pour détacher. Seuls les champs fournis sont modifiés.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id du document (renvoyé par search_documents)" },
        filename: { type: "string", description: "Nouveau nom de fichier" },
        category: { type: "string", description: "Nouvelle catégorie (minuscules)" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Nouvelle liste de tags (remplace l'existante)",
        },
        description: { type: "string", description: "Nouvelle note libre" },
        folder: {
          type: "string",
          description:
            "Dossier de rattachement, ex. « carrier xarios 350 » (créé au besoin) ; chaîne vide pour détacher",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "update_model_specs",
    description:
      "Renseigne ou corrige la fiche technique d'un modèle (réfrigérant, huile, compresseur, " +
      "charge, fusibles, pressions HP/BP, codes défauts) — uniquement à partir d'une information " +
      "trouvée dans un document lu (read_document), jamais inventée. Seuls les champs fournis sont " +
      "modifiés. fault_codes remplace la liste entière : fournir la liste complète voulue. " +
      "IMPORTANT : folder_id doit être l'id du MODÈLE précis (utilise get_folder sur la marque pour " +
      "trouver l'id de son modèle enfant), jamais l'id d'une marque seule.",
    input_schema: {
      type: "object",
      properties: {
        folder_id: { type: "string", description: "Id du dossier modèle (renvoyé par search_documents/list_folders/get_folder)" },
        refrigerant: { type: "string", description: "Ex. « R404A »" },
        oil: { type: "string", description: "Ex. « POE 68 »" },
        compressor: { type: "string", description: "Ex. « Denso 10PA17C »" },
        charge: { type: "string", description: "Ex. « 2.4 kg »" },
        fuses: { type: "string", description: "Ex. « 15 A »" },
        pressure_hp: { type: "string", description: "Pression haute pression, ex. « 18 bar »" },
        pressure_bp: { type: "string", description: "Pression basse pression, ex. « 2 bar »" },
        fault_codes: {
          type: "array",
          items: { type: "string" },
          description: "Liste complète des codes défauts (remplace l'existante)",
        },
      },
      required: ["folder_id"],
    },
  },
  {
    name: "search_repair_cases",
    description:
      "Recherche dans l'historique de dépannage (cas déjà résolus : symptôme, diagnostic, solution, " +
      "codes défauts, pièces utilisées). À appeler dès qu'on te décrit une panne, avant ou en " +
      "complément de la recherche documentaire — l'historique s'enrichit avec le temps.",
    input_schema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Mots-clés (symptôme, code défaut, cause…), optionnel" },
        folder_id: { type: "string", description: "Limiter au modèle concerné (id de dossier), optionnel" },
      },
    },
  },
  {
    name: "log_repair_case",
    description:
      "Enregistre un nouveau cas dans l'historique de dépannage. N'appelle cet outil qu'après avoir " +
      "proposé à l'utilisateur d'enregistrer le cas et reçu son accord explicite dans la conversation " +
      "— jamais de ta propre initiative.",
    input_schema: {
      type: "object",
      properties: {
        folder_id: { type: "string", description: "Id du dossier modèle concerné, optionnel" },
        symptom: { type: "string", description: "Description de la panne" },
        diagnosis: { type: "string", description: "Cause identifiée, optionnel" },
        solution: { type: "string", description: "Réparation effectuée, optionnel" },
        fault_codes: { type: "array", items: { type: "string" }, description: "Codes défauts observés, optionnel" },
        parts_used: { type: "array", items: { type: "string" }, description: "Pièces utilisées, optionnel" },
        resolved: { type: "boolean", description: "Panne résolue (défaut true)" },
      },
      required: ["symptom"],
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

// Fusionne deux listes par id : la première (résultats sémantiques,
// déjà classés par pertinence) prime, la seconde (mot-clé) complète sans
// doublon — voir server/lib/embeddings.js pour le pourquoi de cette
// recherche hybride app-level.
function mergeById(primary, secondary, limit) {
  const seen = new Set(primary.map((x) => x.id));
  const merged = [...primary];
  for (const x of secondary) {
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    merged.push(x);
  }
  return merged.slice(0, limit);
}

async function runTool(ownerId, name, input) {
  switch (name) {
    case "search_documents": {
      const limit = Math.min(Number(input.limit) || 25, 200);
      const [keywordDocs, semanticDocs] = await Promise.all([
        listDocuments(ownerId, {
          space: SPACE,
          q: input.q || undefined,
          folder: input.folder_id,
          limit,
        }),
        input.q ? semanticSearchDocuments(ownerId, SPACE, input.q, limit) : [],
      ]);
      const semanticSummaries = semanticDocs.map(docSummary);
      const keywordSummaries = keywordDocs.map((d) => docSummary(d.toClient ? d.toClient() : d));
      const results = input.q
        ? mergeById(semanticSummaries, keywordSummaries, limit)
        : keywordSummaries;
      if (!results.length) return { results: [], note: "Aucun document ne correspond à ces filtres." };
      return { results };
    }
    case "read_document": {
      const doc = await getDocument(ownerId, String(input.id || ""), SPACE);
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
      const { folders, unfiledCount } = await listFolders(ownerId, SPACE);
      return {
        folders: folders.map((f) => ({
          id: f.id,
          name: f.name,
          description: f.description || undefined,
          documentCount: f.documentCount,
        })),
        unfiledCount,
      };
    }
    case "get_folder": {
      const detail = await getFolderDetail(ownerId, String(input.id || ""), SPACE);
      if (!detail) return { error: "Dossier introuvable." };
      return {
        folder: detail.folder,
        documents: detail.documents.map(docSummary),
        stats: detail.stats,
      };
    }
    case "update_document": {
      const doc = await getDocument(ownerId, String(input.id || ""), SPACE);
      if (!doc) return { error: "Document introuvable." };
      let folderId;
      if (input.folder !== undefined) {
        folderId = input.folder.trim()
          ? (await resolveFolderLabel(ownerId, SPACE, input.folder))._id
          : null;
      }
      const updated = await updateDocument(ownerId, String(input.id), SPACE, {
        filename: input.filename?.replace(/[/\\]/g, "_"),
        category: input.category,
        tags: input.tags,
        description: input.description,
        folderId,
      });
      if (!updated) return { error: "Document introuvable." };
      return { document: docSummary(updated.toClient()) };
    }
    case "update_model_specs": {
      const targetFolder = await getFolder(ownerId, String(input.folder_id || ""), SPACE);
      if (!targetFolder) return { error: "Dossier introuvable." };
      if (!targetFolder.parentId) {
        return {
          error:
            `« ${targetFolder.name} » est une marque, pas un modèle : la fiche technique se ` +
            "renseigne sur un modèle précis. Appelle get_folder sur cette marque pour trouver " +
            "l'id du modèle voulu parmi ses enfants.",
        };
      }
      const specs = {
        ...(input.refrigerant !== undefined && { refrigerant: input.refrigerant }),
        ...(input.oil !== undefined && { oil: input.oil }),
        ...(input.compressor !== undefined && { compressor: input.compressor }),
        ...(input.charge !== undefined && { charge: input.charge }),
        ...(input.fuses !== undefined && { fuses: input.fuses }),
        ...(input.pressure_hp !== undefined && { pressureHp: input.pressure_hp }),
        ...(input.pressure_bp !== undefined && { pressureBp: input.pressure_bp }),
        ...(input.fault_codes !== undefined && { faultCodes: input.fault_codes }),
      };
      if (!Object.keys(specs).length) {
        return { error: "Aucun champ fourni." };
      }
      const updated = await updateFolder(ownerId, targetFolder._id.toString(), SPACE, { specs });
      if (!updated) return { error: "Dossier introuvable." };
      return { folder: updated.toClient() };
    }
    case "search_repair_cases": {
      const [keywordRepairs, semanticRepairs] = await Promise.all([
        listRepairs(ownerId, SPACE, { q: input.q || undefined, folderId: input.folder_id || undefined }),
        input.q
          ? semanticSearchRepairs(ownerId, SPACE, input.q, { folderId: input.folder_id || undefined })
          : [],
      ]);
      const repairs = input.q ? mergeById(semanticRepairs, keywordRepairs, 25) : keywordRepairs;
      if (!repairs.length) return { results: [], note: "Aucun cas ne correspond." };
      return { results: repairs };
    }
    case "log_repair_case": {
      if (!input.symptom || !String(input.symptom).trim()) {
        return { error: "symptom requis." };
      }
      const repair = await createRepair(ownerId, SPACE, {
        folderId: input.folder_id || null,
        symptom: input.symptom,
        diagnosis: input.diagnosis,
        solution: input.solution,
        faultCodes: input.fault_codes,
        partsUsed: input.parts_used,
        resolved: input.resolved,
        source: "jarvis",
      });
      return { repair: repair.toClient() };
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
  update_document: () => "Modification du document",
  update_model_specs: () => "Mise à jour de la fiche technique",
  search_repair_cases: () => "Recherche dans l'historique de dépannage",
  log_repair_case: () => "Enregistrement d'un cas de dépannage",
};

// Historique de conversation persistant côté serveur (voir services/chatHistory.js) :
// le client n'envoie plus que le nouveau message, plus tout le fil — le
// serveur est la source de vérité, partagée entre appareils.
chatRouter.get("/history", requireAuth, async (req, res, next) => {
  try {
    const messages = await getHistory(req.ownerId, SPACE, MAX_HISTORY_MESSAGES);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ messages });
  } catch (err) {
    next(err);
  }
});

chatRouter.delete("/history", requireAuth, async (req, res, next) => {
  try {
    await clearHistory(req.ownerId, SPACE);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

chatRouter.post("/", requireAuth, async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) {
    return res.status(400).json({ error: "Message utilisateur manquant." });
  }

  const previous = await getHistory(req.ownerId, SPACE, MAX_HISTORY_MESSAGES);
  const messages = [...previous, { role: "user", text }]
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, content: m.text }));
  await appendMessage(req.ownerId, SPACE, { role: "user", text });

  // Contexte optionnel : le document ouvert dans le viewer, ajouté à la suite
  // du prompt système (Gemini ne gère qu'une instruction système simple, pas
  // de blocs multiples avec cache_control comme l'API Anthropic).
  let system = SYSTEM_PROMPT;
  if (typeof req.body?.documentId === "string" && req.body.documentId) {
    const doc = await getDocument(req.ownerId, req.body.documentId, SPACE).catch(() => null);
    if (doc) {
      system +=
        `\n\nL'utilisateur a actuellement ouvert le document « ${doc.filename} » ` +
        `(id: ${doc._id}, catégorie: ${doc.category}). Quand il dit « ce document », ` +
        `« cette notice » ou pose une question sans préciser, il parle de celui-ci : ` +
        `lis-le avec read_document(id: "${doc._id}") avant de répondre.`;
    }
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const send = (event) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // `res.on("close")`, pas `req.on("close")` : sur ce runtime, l'événement
  // 'close' de la requête entrante (IncomingMessage) se déclenche dès que son
  // corps est entièrement consommé (donc quasi immédiatement, bien avant la
  // fin de la réponse) — pas quand la connexion se ferme réellement. `res`
  // (ServerResponse) est le bon flux à écouter pour détecter un abandon client.
  let aborted = false;
  res.on("close", () => {
    if (!res.writableEnded) aborted = true;
  });

  let assistantText = "";
  try {
    await runChatLoop({
      history: messages,
      system,
      tools: TOOLS,
      runTool: (name, args) => runTool(req.ownerId, name, args),
      onDelta: (delta) => {
        assistantText += delta;
        if (!aborted) send({ type: "delta", text: delta });
      },
      onToolCall: ({ name, args }) => {
        if (!aborted) send({ type: "tool", label: TOOL_LABELS[name]?.(args) || name });
      },
    });
    if (assistantText.trim()) {
      await appendMessage(req.ownerId, SPACE, { role: "assistant", text: assistantText });
    }
    if (aborted) return;
    send({ type: "done" });
    res.end();
  } catch (err) {
    console.error("Erreur chatbot :", err);
    if (assistantText.trim()) {
      await appendMessage(req.ownerId, SPACE, { role: "assistant", text: assistantText });
    }
    send({ type: "error", message: friendlyError(err) });
    send({ type: "done" });
    res.end();
  }
});
