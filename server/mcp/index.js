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
  getDocumentAnySpace,
  listDocuments,
  updateDocument,
} from "../services/documents.js";
import { extractContent } from "../services/extractContent.js";
import {
  deleteFolder,
  findFolderByName,
  getFolderDetail,
  getOrCreateFolder,
  listFolders,
  updateFolder,
} from "../services/folders.js";

// Le connecteur MCP ne voit JAMAIS l'espace personnel — cette constante est
// la SEULE source de vérité du space utilisé par tous les tools ci-dessous.
// Aucun inputSchema Zod n'expose de champ `space` : impossible pour Claude
// d'en fournir un, donc impossible de le faire dévier de "pro".
const SPACE = "pro";

// Message renvoyé quand un id fourni par Claude désigne bien un document
// existant, mais hors de l'espace pro — jamais un simple "introuvable" qui
// masquerait qu'il s'agit d'un refus d'accès délibéré, pas d'une absence.
function accessDeniedMessage(id) {
  return `Accès refusé : le document ${id} appartient à l'espace personnel, non accessible depuis l'assistant.`;
}

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

// Résolution marque/modèle à partir d'un libellé plat façon MCP, ex.
// « carrier xarios 600 » : si le libellé commence par le nom d'une marque
// existante (dossier de premier niveau) suivi d'un espace, le reste devient
// un modèle enfant de cette marque (créé au besoin) ; si le libellé est
// EXACTEMENT le nom d'une marque, le document est rattaché directement à la
// marque (pas d'enfant) ; sinon, comportement historique : dossier de
// premier niveau plat, créé au besoin (limite acceptée : une toute nouvelle
// marque pas encore créée via l'UI atterrit ainsi en dossier plat).
async function resolveFolderLabel(ownerId, space, label) {
  const normalized = String(label).trim().toLowerCase();
  const { folders: brands } = await listFolders(ownerId, space);
  for (const brand of brands) {
    if (normalized === brand.name) {
      return getOrCreateFolder(ownerId, space, brand.name);
    }
    const prefix = `${brand.name} `;
    if (normalized.startsWith(prefix)) {
      const modelName = normalized.slice(prefix.length).trim();
      if (modelName) return getOrCreateFolder(ownerId, space, modelName, brand.id);
    }
  }
  return getOrCreateFolder(ownerId, space, normalized);
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
        const f = await findFolderByName(OWNER_ID, SPACE, folder);
        if (!f) return textResult(`Dossier « ${folder} » introuvable (voir list_folders).`);
        folderId = f._id.toString();
      }
      const docs = await listDocuments(OWNER_ID, {
        space: SPACE,
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
      const docs = await listDocuments(OWNER_ID, { space: SPACE, q: query, limit: 50 });
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
      const doc = await getDocumentAnySpace(OWNER_ID, id);
      if (!doc) return textResult(`Document ${id} introuvable.`);
      if (doc.space !== SPACE) return textResult(accessDeniedMessage(id));

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
      const folderDoc = folder ? await resolveFolderLabel(OWNER_ID, SPACE, folder) : null;
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
        space: SPACE,
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
      const existing = await getDocumentAnySpace(OWNER_ID, id);
      if (!existing) return textResult(`Document ${id} introuvable.`);
      if (existing.space !== SPACE) return textResult(accessDeniedMessage(id));

      let folderId;
      if (folder !== undefined) {
        folderId = folder.trim() ? (await resolveFolderLabel(OWNER_ID, SPACE, folder))._id : null;
      }
      const doc = await updateDocument(OWNER_ID, id, SPACE, {
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
      const doc = await getDocumentAnySpace(OWNER_ID, id);
      if (!doc) return textResult(`Document ${id} introuvable.`);
      if (doc.space !== SPACE) return textResult(accessDeniedMessage(id));
      const filename = doc.filename;
      await deleteDocument(OWNER_ID, id, SPACE);
      return textResult(`Document « ${filename} » supprimé définitivement (fichier + métadonnées).`);
    }
  );

  server.registerTool(
    "list_folders",
    {
      title: "Lister les dossiers",
      description:
        "Liste les marques (dossiers de premier niveau, ex. « carrier ») avec leurs modèles " +
        "(ex. « xarios 200 ») et leurs compteurs de documents.",
      inputSchema: {},
    },
    async () => {
      const { folders: brands, unfiledCount } = await listFolders(OWNER_ID, SPACE);
      if (!brands.length && !unfiledCount) {
        return textResult("Aucun dossier pour l'instant.");
      }
      const lines = [];
      for (const brand of brands) {
        const { folders: models } = await listFolders(OWNER_ID, SPACE, { parentId: brand.id });
        lines.push(
          `- ${brand.name} — ${brand.documentCount} document(s) directs` +
            (brand.description ? ` : ${brand.description}` : "")
        );
        for (const m of models) {
          lines.push(
            `  - ${m.name} — ${m.documentCount} document(s)` + (m.description ? ` : ${m.description}` : "")
          );
        }
      }
      if (unfiledCount) lines.push(`- (hors dossier) — ${unfiledCount} document(s) non classé(s)`);
      return textResult(`${brands.length} marque(s) :\n${lines.join("\n")}`);
    }
  );

  server.registerTool(
    "get_folder",
    {
      title: "Détail d'un dossier",
      description:
        "Retourne le contenu complet d'un dossier : ses modèles enfants (si c'est une marque), " +
        "ses documents directs et leur répartition par catégorie.",
      inputSchema: {
        name: z.string().min(1).describe("Nom exact du dossier, marque ou modèle (voir list_folders)"),
      },
    },
    async ({ name }) => {
      const folder = await findFolderByName(OWNER_ID, SPACE, name);
      if (!folder) return textResult(`Dossier « ${name} » introuvable (voir list_folders).`);
      const detail = await getFolderDetail(OWNER_ID, folder._id.toString(), SPACE);
      const { documents, stats, childFolders } = detail;
      const parts = [
        `Dossier : ${detail.folder.name}` +
          (detail.folder.description ? `\nDescription : ${detail.folder.description}` : ""),
      ];
      if (childFolders.length) {
        parts.push(
          `Modèles (${childFolders.length}) :\n${childFolders
            .map((c) => `- ${c.name} — ${c.documentCount} document(s)`)
            .join("\n")}`
        );
      }
      parts.push(
        `Documents directs (${stats.documentCount}) : ${
          stats.categories.map((c) => `${c.name} ${c.count}`).join(", ") || "aucun"
        }`
      );
      if (documents.length) {
        parts.push(
          documents
            .map((d) => `- [${d.id}] ${d.filename} — ${d.category}`)
            .join("\n")
        );
      }
      return textResult(parts.join("\n\n"));
    }
  );

  server.registerTool(
    "delete_folder",
    {
      title: "Supprimer un dossier",
      description:
        "Supprime un dossier ; si c'est une marque avec des modèles enfants, ces modèles sont " +
        "supprimés aussi (jamais les documents, toujours conservés non classés). Ne JAMAIS " +
        "l'appeler de ta propre initiative — uniquement après confirmation explicite de " +
        "l'utilisateur dans la conversation.",
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
      const folder = await findFolderByName(OWNER_ID, SPACE, name);
      if (!folder) return textResult(`Dossier « ${name} » introuvable.`);
      await deleteFolder(OWNER_ID, folder._id.toString(), SPACE);
      return textResult(`Dossier « ${folder.name} » supprimé (documents conservés non classés).`);
    }
  );

  server.registerTool(
    "update_model_specs",
    {
      title: "Mettre à jour la fiche technique d'un modèle",
      description:
        "Renseigne ou corrige la fiche technique d'un modèle (réfrigérant, huile, compresseur, " +
        "charge, fusibles, pressions HP/BP, codes défauts). À utiliser après avoir lu un document " +
        "(get_document_content) qui donne ces informations de façon fiable — ne jamais inventer une " +
        "valeur. Seuls les champs fournis sont modifiés, les autres restent inchangés ; fault_codes " +
        "remplace la liste entière (fournir la liste complète voulue, existants inclus).",
      inputSchema: {
        model: z
          .string()
          .min(1)
          .describe("Modèle, ex. « xarios 350 » ou « carrier xarios 350 » (créé s'il n'existe pas)"),
        refrigerant: z.string().max(60).optional().describe("Ex. « R404A »"),
        oil: z.string().max(60).optional().describe("Ex. « POE 68 »"),
        compressor: z.string().max(100).optional().describe("Ex. « Denso 10PA17C »"),
        charge: z.string().max(40).optional().describe("Ex. « 2.4 kg »"),
        fuses: z.string().max(60).optional().describe("Ex. « 15 A »"),
        pressure_hp: z.string().max(40).optional().describe("Pression haute pression, ex. « 18 bar »"),
        pressure_bp: z.string().max(40).optional().describe("Pression basse pression, ex. « 2 bar »"),
        fault_codes: z
          .array(z.string().min(1).max(20))
          .max(50)
          .optional()
          .describe("Liste complète des codes défauts (remplace l'existante)"),
      },
    },
    async ({ model, refrigerant, oil, compressor, charge, fuses, pressure_hp, pressure_bp, fault_codes }) => {
      const specs = {
        ...(refrigerant !== undefined && { refrigerant }),
        ...(oil !== undefined && { oil }),
        ...(compressor !== undefined && { compressor }),
        ...(charge !== undefined && { charge }),
        ...(fuses !== undefined && { fuses }),
        ...(pressure_hp !== undefined && { pressureHp: pressure_hp }),
        ...(pressure_bp !== undefined && { pressureBp: pressure_bp }),
        ...(fault_codes !== undefined && { faultCodes: fault_codes }),
      };
      if (!Object.keys(specs).length) {
        return textResult(
          "Aucun changement demandé : fournir au moins un champ (refrigerant, oil, compressor, " +
            "charge, fuses, pressure_hp, pressure_bp, fault_codes)."
        );
      }
      const folder = await resolveFolderLabel(OWNER_ID, SPACE, model);
      const updated = await updateFolder(OWNER_ID, folder._id.toString(), SPACE, { specs });
      const { specs: s } = updated.toClient();
      const lines = [
        s.refrigerant && `Réfrigérant : ${s.refrigerant}`,
        s.oil && `Huile : ${s.oil}`,
        s.compressor && `Compresseur : ${s.compressor}`,
        s.charge && `Charge : ${s.charge}`,
        s.fuses && `Fusibles : ${s.fuses}`,
        s.pressureHp && `Pression HP : ${s.pressureHp}`,
        s.pressureBp && `Pression BP : ${s.pressureBp}`,
        s.faultCodes.length && `Codes défauts : ${s.faultCodes.join(", ")}`,
      ].filter(Boolean);
      return textResult(`Fiche technique de « ${updated.name} » mise à jour :\n${lines.join("\n")}`);
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
