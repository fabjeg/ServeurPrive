// Serveur MCP (Streamable HTTP, mode stateless) — connecteur personnalisé Claude.
// Protégé par jeton Bearer (MCP_ACCESS_TOKEN) : la règle "rien sans
// authentification" s'applique aussi au connecteur.
import { Router } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { requireMcpAuth, OWNER_ID } from "../lib/auth.js";
import {
  createDocumentFromBuffer,
  deleteDocument,
  getDocument,
  listDocuments,
  updateDocument,
} from "../services/documents.js";
import { extractContent } from "../services/extractContent.js";
import {
  createIntervention,
  deleteFolder,
  deleteIntervention,
  findFolderByName,
  getFolderDetail,
  getIntervention,
  getOrCreateFolder,
  listFolders,
  updateIntervention,
} from "../services/folders.js";

// add_document : le contenu transite par la fonction serverless (plafond Vercel
// 4,5 Mo) et le base64 gonfle de ~33 % → limite utile ~3 Mo de fichier décodé.
const MAX_ADD_BYTES = 3 * 1024 * 1024;
// Liste blanche des types déposables via MCP : documents et notes uniquement.
const ALLOWED_ADD_MIMETYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);

function docLine(d) {
  const kb = Math.round((d.size || 0) / 1024);
  const summaryPart =
    d.summaryStatus === "done" && d.summary ? `\n  Résumé : ${d.summary}` : "";
  return `- [${d._id}] ${d.filename} — catégorie: ${d.category}${
    d.tags.length ? `, tags: ${d.tags.join(", ")}` : ""
  }, ${kb} Ko, ajouté le ${d.uploadedAt.toISOString().slice(0, 10)}${summaryPart}`;
}

function textResult(text) {
  return { content: [{ type: "text", text }] };
}

function interventionLine(i) {
  const duration = i.durationMinutes ? `${i.durationMinutes} min` : "durée non renseignée";
  return `- [${i._id}] ${i.title} — ${duration}${
    i.steps.length ? `, ${i.steps.length} étape(s)` : ""
  }${i.note ? ` (${i.note})` : ""}`;
}

function buildServer() {
  const server = new McpServer({ name: "frigo", version: "1.0.0" });

  server.registerTool(
    "list_documents",
    {
      title: "Lister les documents",
      description:
        "Liste les documents du coffre, avec filtres optionnels par catégorie et tag.",
      inputSchema: {
        category: z.string().optional().describe("Filtrer par catégorie"),
        tag: z.string().optional().describe("Filtrer par tag"),
        folder: z
          .string()
          .optional()
          .describe("Filtrer par dossier (nom exact, voir list_folders)"),
        limit: z.number().int().min(1).max(200).optional().describe("Nombre max de résultats"),
      },
    },
    async ({ category, tag, folder, limit }) => {
      let folderId;
      if (folder) {
        const f = await findFolderByName(OWNER_ID, folder);
        if (!f) return textResult(`Dossier « ${folder} » introuvable (voir list_folders).`);
        folderId = f._id.toString();
      }
      const docs = await listDocuments(OWNER_ID, {
        category,
        tag,
        folder: folderId,
        limit: limit || 50,
      });
      if (!docs.length) return textResult("Aucun document ne correspond à ces filtres.");
      return textResult(`${docs.length} document(s) :\n${docs.map(docLine).join("\n")}`);
    }
  );

  server.registerTool(
    "search_documents",
    {
      title: "Rechercher des documents",
      description: "Recherche par nom de fichier, tag ou catégorie (mots-clés).",
      inputSchema: {
        query: z.string().min(1).describe("Mots-clés à rechercher"),
      },
    },
    async ({ query }) => {
      const docs = await listDocuments(OWNER_ID, { q: query, limit: 50 });
      if (!docs.length) return textResult(`Aucun document trouvé pour « ${query} ».`);
      return textResult(
        `${docs.length} résultat(s) pour « ${query} » :\n${docs.map(docLine).join("\n")}`
      );
    }
  );

  server.registerTool(
    "get_document_content",
    {
      title: "Contenu d'un document",
      description:
        "Retourne le contenu d'un document (texte intégral, image inline, ou métadonnées détaillées pour les formats binaires comme le PDF).",
      inputSchema: {
        id: z.string().describe("Identifiant du document (obtenu via list/search)"),
      },
    },
    async ({ id }) => {
      const doc = await getDocument(OWNER_ID, id);
      if (!doc) return textResult(`Document ${id} introuvable.`);

      const header =
        `Fichier : ${doc.filename}\nType : ${doc.mimetype}\nCatégorie : ${doc.category}\n` +
        `Tags : ${doc.tags.join(", ") || "—"}\nTaille : ${Math.round(doc.size / 1024)} Ko\n` +
        `Ajouté le : ${doc.uploadedAt.toISOString()}` +
        (doc.description ? `\nDescription : ${doc.description}` : "") +
        (doc.sourceUrl ? `\nSource : ${doc.sourceUrl}` : "");

      const extracted = await extractContent(doc);
      switch (extracted.kind) {
        case "too_large":
          return textResult(
            `${header}\n\n(Fichier trop volumineux pour être retourné inline — consultez-le dans l'application Frigo.)`
          );
        case "unreachable":
          return textResult(`${header}\n\n(Contenu inaccessible dans le stockage.)`);
        case "pdf_no_text":
          return textResult(
            `${header}\nPages : ${extracted.pages}\n\n(PDF sans couche texte — probablement un scan. Le contenu n'est pas extractible sans OCR.)`
          );
        case "pdf_unreadable":
          return textResult(`${header}\n\n(PDF illisible — extraction de texte impossible.)`);
        case "pdf":
          return textResult(
            `${header}\nPages : ${extracted.pages}\n\n--- Contenu extrait ---\n${extracted.text}${
              extracted.truncated ? "\n\n[… texte tronqué à 60 000 caractères]" : ""
            }`
          );
        case "text":
          return textResult(`${header}\n\n--- Contenu ---\n${extracted.text}`);
        case "image":
          return {
            content: [
              { type: "text", text: header },
              { type: "image", data: extracted.base64, mimeType: extracted.mimeType },
            ],
          };
        case "unsupported":
        default:
          return textResult(
            `${header}\n\n(Format binaire — contenu non extractible inline. Utilisez l'application Frigo pour le consulter.)`
          );
      }
    }
  );

  server.registerTool(
    "add_document",
    {
      title: "Déposer un document",
      description:
        "Ajoute un document dans le coffre (contenu encodé en base64). " +
        `Limite : ${Math.round(MAX_ADD_BYTES / 1024 / 1024)} Mo de fichier décodé — ` +
        "au-delà, l'upload doit passer par l'interface web Frigo. " +
        "Convention : catégorie et tags en minuscules, cohérents avec l'existant " +
        "(ex. catégorie « xarios 600 », tag « schema electrique »).",
      inputSchema: {
        filename: z.string().min(1).max(200).describe("Nom du fichier, extension comprise"),
        mimetype: z
          .string()
          .regex(/^[\w.+-]+\/[\w.+-]+$/, "Type MIME invalide")
          .describe("Type MIME (ex. application/pdf, image/png, text/plain)"),
        content: z
          .string()
          .min(1)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/, "Le contenu doit être du base64 valide")
          .describe("Contenu du fichier encodé en base64 (sans préfixe data:)"),
        category: z
          .string()
          .min(1)
          .max(60)
          .optional()
          .describe("Catégorie en minuscules, cohérente avec l'existant (défaut : divers)"),
        tags: z
          .array(z.string().min(1).max(40))
          .max(20)
          .optional()
          .describe("Tags : mots-clés libres en minuscules"),
        folder: z
          .string()
          .min(1)
          .max(80)
          .optional()
          .describe(
            "Dossier (modèle de frigo) de rattachement, ex. « carrier xarios 200 » — créé s'il n'existe pas"
          ),
        source_url: z
          .string()
          .url()
          .max(2000)
          .optional()
          .describe("URL d'origine si le document vient du web (traçabilité)"),
        description: z.string().max(500).optional().describe("Courte note libre"),
      },
    },
    async ({ filename, mimetype, content, category, tags, folder, source_url, description }) => {
      if (!ALLOWED_ADD_MIMETYPES.has(mimetype)) {
        return textResult(
          `Type MIME non autorisé (${mimetype}). Types acceptés : ` +
            `${[...ALLOWED_ADD_MIMETYPES].join(", ")}.`
        );
      }
      const buffer = Buffer.from(content, "base64");
      if (buffer.length === 0) {
        return textResult("Contenu base64 vide ou indéchiffrable — document non créé.");
      }
      if (buffer.length > MAX_ADD_BYTES) {
        return textResult(
          `Fichier trop volumineux pour cette voie (${Math.round(buffer.length / 1024)} Ko décodés, ` +
            `maximum ${Math.round(MAX_ADD_BYTES / 1024 / 1024)} Mo) : le contenu transite par une ` +
            "fonction serverless limitée à 4,5 Mo. Utilise l'upload de l'interface web Frigo, " +
            "qui envoie le fichier directement vers le stockage sans cette limite."
        );
      }
      // Le nom sert de base au chemin blob : on neutralise les séparateurs
      // pour rester sous documents/<owner>/ (même règle que l'upload web).
      const safeName = filename.replace(/[/\\]/g, "_");
      const folderDoc = folder ? await getOrCreateFolder(OWNER_ID, folder) : null;
      const doc = await createDocumentFromBuffer(OWNER_ID, {
        filename: safeName,
        mimetype,
        category,
        tags,
        buffer,
        source: "claude",
        sourceUrl: source_url,
        description,
        folderId: folderDoc?._id,
      });
      return textResult(
        `Document déposé dans le coffre${folderDoc ? ` (dossier « ${folderDoc.name} »)` : ""} :\n${docLine(doc)}`
      );
    }
  );

  server.registerTool(
    "update_document",
    {
      title: "Modifier un document",
      description:
        "Met à jour les métadonnées d'un document : nom de fichier, catégorie, tags " +
        "et/ou description. Le fichier lui-même n'est pas modifié.",
      inputSchema: {
        id: z.string().describe("Identifiant du document (obtenu via list/search)"),
        filename: z.string().min(1).max(200).optional().describe("Nouveau nom de fichier"),
        category: z
          .string()
          .min(1)
          .max(60)
          .optional()
          .describe("Nouvelle catégorie (minuscules, cohérente avec l'existant)"),
        tags: z
          .array(z.string().min(1).max(40))
          .max(20)
          .optional()
          .describe("Nouvelle liste de tags (remplace l'existante)"),
        description: z.string().max(500).optional().describe("Nouvelle note libre"),
        folder: z
          .string()
          .max(80)
          .optional()
          .describe(
            "Dossier de rattachement (créé s'il n'existe pas) ; chaîne vide pour détacher"
          ),
      },
    },
    async ({ id, filename, category, tags, description, folder }) => {
      if (
        filename === undefined &&
        category === undefined &&
        tags === undefined &&
        description === undefined &&
        folder === undefined
      ) {
        return textResult(
          "Aucun changement demandé : fournir filename, category, tags, description et/ou folder."
        );
      }
      let folderId;
      if (folder !== undefined) {
        folderId = folder.trim() ? (await getOrCreateFolder(OWNER_ID, folder))._id : null;
      }
      const doc = await updateDocument(OWNER_ID, id, {
        filename: filename?.replace(/[/\\]/g, "_"),
        category,
        tags,
        description,
        folderId,
      });
      if (!doc) return textResult(`Document ${id} introuvable.`);
      return textResult(`Document mis à jour :\n${docLine(doc)}`);
    }
  );

  server.registerTool(
    "delete_document",
    {
      title: "Supprimer un document",
      description:
        "Supprime DÉFINITIVEMENT un document (fichier + métadonnées). Action irréversible : " +
        "ne JAMAIS l'appeler de ta propre initiative — uniquement après que l'utilisateur a " +
        "confirmé explicitement la suppression de ce document précis dans la conversation.",
      inputSchema: {
        id: z.string().describe("Identifiant du document (obtenu via list/search)"),
        confirmed: z
          .boolean()
          .describe(
            "Doit être true, et seulement si l'utilisateur a explicitement confirmé la suppression"
          ),
      },
    },
    async ({ id, confirmed }) => {
      if (confirmed !== true) {
        return textResult(
          "Suppression refusée : demande d'abord une confirmation explicite à l'utilisateur, " +
            "puis rappelle ce tool avec confirmed: true."
        );
      }
      const doc = await getDocument(OWNER_ID, id);
      if (!doc) return textResult(`Document ${id} introuvable.`);
      const filename = doc.filename;
      await deleteDocument(OWNER_ID, id);
      return textResult(`Document « ${filename} » supprimé définitivement (fichier + métadonnées).`);
    }
  );

  server.registerTool(
    "list_folders",
    {
      title: "Lister les dossiers",
      description:
        "Liste les dossiers (référentiels par modèle de frigo, ex. « carrier xarios 200 ») " +
        "avec leurs compteurs de documents et d'interventions.",
      inputSchema: {},
    },
    async () => {
      const { folders, unfiledCount } = await listFolders(OWNER_ID);
      if (!folders.length && !unfiledCount) {
        return textResult("Aucun dossier pour l'instant.");
      }
      const lines = folders.map(
        (f) =>
          `- ${f.name} — ${f.documentCount} document(s), ${f.interventionCount} intervention(s)` +
          (f.description ? ` : ${f.description}` : "")
      );
      if (unfiledCount) lines.push(`- (hors dossier) — ${unfiledCount} document(s) non classé(s)`);
      return textResult(`${folders.length} dossier(s) :\n${lines.join("\n")}`);
    }
  );

  server.registerTool(
    "get_folder",
    {
      title: "Détail d'un dossier",
      description:
        "Retourne le contenu complet d'un dossier : documents, répartition par catégorie, " +
        "interventions fréquentes (avec identifiants) et durée moyenne.",
      inputSchema: {
        name: z.string().min(1).describe("Nom exact du dossier (voir list_folders)"),
      },
    },
    async ({ name }) => {
      const folder = await findFolderByName(OWNER_ID, name);
      if (!folder) return textResult(`Dossier « ${name} » introuvable (voir list_folders).`);
      const detail = await getFolderDetail(OWNER_ID, folder._id.toString());
      const { documents, interventions, stats } = detail;
      const parts = [
        `Dossier : ${detail.folder.name}` +
          (detail.folder.description ? `\nDescription : ${detail.folder.description}` : ""),
        `Documents (${stats.documentCount}) : ${
          stats.categories.map((c) => `${c.name} ${c.count}`).join(", ") || "aucun"
        }`,
      ];
      if (documents.length) {
        parts.push(
          documents
            .map((d) => `- [${d.id}] ${d.filename} — ${d.category}`)
            .join("\n")
        );
      }
      parts.push(
        `Interventions (${interventions.length})${
          stats.avgDurationMinutes ? `, temps moyen ${stats.avgDurationMinutes} min` : ""
        } :`
      );
      if (interventions.length) {
        parts.push(
          interventions
            .map(
              (i) =>
                `- [${i.id}] ${i.title} — ${i.durationMinutes || "?"} min` +
                (i.note ? ` (${i.note})` : "") +
                (i.steps.length ? `\n  Étapes : ${i.steps.join(" → ")}` : "")
            )
            .join("\n")
        );
      }
      return textResult(parts.join("\n\n"));
    }
  );

  server.registerTool(
    "add_intervention",
    {
      title: "Ajouter une intervention",
      description:
        "Ajoute une intervention fréquente (procédure courte) à un dossier de modèle de frigo. " +
        "Le dossier est créé s'il n'existe pas.",
      inputSchema: {
        folder: z.string().min(1).max(80).describe("Nom du dossier (ex. « carrier xarios 200 »)"),
        title: z.string().min(1).max(120).describe("Titre (ex. « remplacement sonde évaporateur »)"),
        note: z.string().max(200).optional().describe("Note courte affichée sous le titre"),
        duration_minutes: z.number().int().min(0).max(6000).optional().describe("Durée estimée"),
        steps: z
          .array(z.string().min(1).max(300))
          .max(40)
          .optional()
          .describe("Étapes ordonnées de la procédure"),
      },
    },
    async ({ folder, title, note, duration_minutes, steps }) => {
      const folderDoc = await getOrCreateFolder(OWNER_ID, folder);
      const intervention = await createIntervention(OWNER_ID, folderDoc._id.toString(), {
        title,
        note,
        durationMinutes: duration_minutes,
        steps,
      });
      return textResult(
        `Intervention ajoutée au dossier « ${folderDoc.name} » :\n${interventionLine(intervention)}`
      );
    }
  );

  server.registerTool(
    "update_intervention",
    {
      title: "Modifier une intervention",
      description:
        "Met à jour une intervention existante (titre, note, durée, étapes). " +
        "Les étapes fournies remplacent intégralement les anciennes.",
      inputSchema: {
        id: z.string().describe("Identifiant de l'intervention (obtenu via get_folder)"),
        title: z.string().min(1).max(120).optional().describe("Nouveau titre"),
        note: z.string().max(200).optional().describe("Nouvelle note"),
        duration_minutes: z.number().int().min(0).max(6000).optional().describe("Nouvelle durée"),
        steps: z
          .array(z.string().min(1).max(300))
          .max(40)
          .optional()
          .describe("Nouvelles étapes (remplacent les anciennes)"),
      },
    },
    async ({ id, title, note, duration_minutes, steps }) => {
      if (
        title === undefined &&
        note === undefined &&
        duration_minutes === undefined &&
        steps === undefined
      ) {
        return textResult(
          "Aucun changement demandé : fournir title, note, duration_minutes et/ou steps."
        );
      }
      const intervention = await updateIntervention(OWNER_ID, id, {
        title,
        note,
        durationMinutes: duration_minutes,
        steps,
      });
      if (!intervention) return textResult(`Intervention ${id} introuvable.`);
      return textResult(`Intervention mise à jour :\n${interventionLine(intervention)}`);
    }
  );

  server.registerTool(
    "delete_intervention",
    {
      title: "Supprimer une intervention",
      description:
        "Supprime définitivement une intervention. Ne JAMAIS l'appeler de ta propre initiative — " +
        "uniquement après confirmation explicite de l'utilisateur dans la conversation.",
      inputSchema: {
        id: z.string().describe("Identifiant de l'intervention (obtenu via get_folder)"),
        confirmed: z
          .boolean()
          .describe(
            "Doit être true, et seulement si l'utilisateur a explicitement confirmé la suppression"
          ),
      },
    },
    async ({ id, confirmed }) => {
      if (confirmed !== true) {
        return textResult(
          "Suppression refusée : demande d'abord une confirmation explicite à l'utilisateur, " +
            "puis rappelle ce tool avec confirmed: true."
        );
      }
      const intervention = await getIntervention(OWNER_ID, id);
      if (!intervention) return textResult(`Intervention ${id} introuvable.`);
      const title = intervention.title;
      await deleteIntervention(OWNER_ID, id);
      return textResult(`Intervention « ${title} » supprimée définitivement.`);
    }
  );

  server.registerTool(
    "delete_folder",
    {
      title: "Supprimer un dossier",
      description:
        "Supprime un dossier et ses interventions ; les documents qu'il contenait sont " +
        "conservés (non classés). Ne JAMAIS l'appeler de ta propre initiative — uniquement " +
        "après confirmation explicite de l'utilisateur dans la conversation.",
      inputSchema: {
        name: z.string().min(1).describe("Nom exact du dossier (voir list_folders)"),
        confirmed: z
          .boolean()
          .describe(
            "Doit être true, et seulement si l'utilisateur a explicitement confirmé la suppression"
          ),
      },
    },
    async ({ name, confirmed }) => {
      if (confirmed !== true) {
        return textResult(
          "Suppression refusée : demande d'abord une confirmation explicite à l'utilisateur, " +
            "puis rappelle ce tool avec confirmed: true."
        );
      }
      const folder = await findFolderByName(OWNER_ID, name);
      if (!folder) return textResult(`Dossier « ${name} » introuvable.`);
      await deleteFolder(OWNER_ID, folder._id.toString());
      return textResult(
        `Dossier « ${folder.name} » supprimé (interventions supprimées, documents conservés non classés).`
      );
    }
  );

  return server;
}

// mergeParams : récupère :token quand le routeur est monté sur /api/mcp/:token
export const mcpRouter = Router({ mergeParams: true });
mcpRouter.use(requireMcpAuth);

// Mode stateless : un serveur + un transport par requête, pas de session.
mcpRouter.post("/", async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Erreur interne du serveur MCP." },
        id: null,
      });
    }
  }
});

const methodNotAllowed = (req, res) =>
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Méthode non supportée (mode stateless)." },
    id: null,
  });
mcpRouter.get("/", methodNotAllowed);
mcpRouter.delete("/", methodNotAllowed);
