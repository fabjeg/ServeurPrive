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
  fetchBlobResponse,
  getDocument,
  listDocuments,
  updateDocument,
} from "../services/documents.js";

const TEXT_MIMETYPES = /^(text\/|application\/(json|xml|javascript|x-yaml|csv))/;
const IMAGE_MIMETYPES = /^image\/(png|jpeg|gif|webp)$/;
const MAX_INLINE_BYTES = 4 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024; // extraction texte seulement, jamais inline
const MAX_TEXT_CHARS = 60000;
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
  return `- [${d._id}] ${d.filename} — catégorie: ${d.category}${
    d.tags.length ? `, tags: ${d.tags.join(", ")}` : ""
  }, ${kb} Ko, ajouté le ${d.uploadedAt.toISOString().slice(0, 10)}`;
}

function textResult(text) {
  return { content: [{ type: "text", text }] };
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
        limit: z.number().int().min(1).max(200).optional().describe("Nombre max de résultats"),
      },
    },
    async ({ category, tag, limit }) => {
      const docs = await listDocuments(OWNER_ID, { category, tag, limit: limit || 50 });
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

      const isPdf = doc.mimetype === "application/pdf";
      if (doc.size > (isPdf ? MAX_PDF_BYTES : MAX_INLINE_BYTES)) {
        return textResult(
          `${header}\n\n(Fichier trop volumineux pour être retourné inline — consultez-le dans l'application Frigo.)`
        );
      }

      const blobRes = await fetchBlobResponse(doc);
      if (!blobRes.ok) return textResult(`${header}\n\n(Contenu inaccessible dans le stockage.)`);

      if (isPdf) {
        const { PDFParse } = await import("pdf-parse");
        const buf = new Uint8Array(await blobRes.arrayBuffer());
        let parser;
        try {
          parser = new PDFParse({ data: buf });
          const parsed = await parser.getText();
          let text = (parsed.text || "").trim();
          if (!text) {
            return textResult(
              `${header}\nPages : ${parsed.total}\n\n(PDF sans couche texte — probablement un scan. Le contenu n'est pas extractible sans OCR.)`
            );
          }
          const truncated = text.length > MAX_TEXT_CHARS;
          if (truncated) text = text.slice(0, MAX_TEXT_CHARS);
          return textResult(
            `${header}\nPages : ${parsed.total}\n\n--- Contenu extrait ---\n${text}${
              truncated ? "\n\n[… texte tronqué à 60 000 caractères]" : ""
            }`
          );
        } catch {
          return textResult(`${header}\n\n(PDF illisible — extraction de texte impossible.)`);
        } finally {
          await parser?.destroy().catch(() => {});
        }
      }

      if (TEXT_MIMETYPES.test(doc.mimetype)) {
        const text = await blobRes.text();
        return textResult(`${header}\n\n--- Contenu ---\n${text}`);
      }
      if (IMAGE_MIMETYPES.test(doc.mimetype)) {
        const buf = Buffer.from(await blobRes.arrayBuffer());
        return {
          content: [
            { type: "text", text: header },
            { type: "image", data: buf.toString("base64"), mimeType: doc.mimetype },
          ],
        };
      }
      return textResult(
        `${header}\n\n(Format binaire — contenu non extractible inline. Utilisez l'application Frigo pour le consulter.)`
      );
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
        source_url: z
          .string()
          .url()
          .max(2000)
          .optional()
          .describe("URL d'origine si le document vient du web (traçabilité)"),
        description: z.string().max(500).optional().describe("Courte note libre"),
      },
    },
    async ({ filename, mimetype, content, category, tags, source_url, description }) => {
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
      const doc = await createDocumentFromBuffer(OWNER_ID, {
        filename: safeName,
        mimetype,
        category,
        tags,
        buffer,
        source: "claude",
        sourceUrl: source_url,
        description,
      });
      return textResult(`Document déposé dans le coffre :\n${docLine(doc)}`);
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
      },
    },
    async ({ id, filename, category, tags, description }) => {
      if (
        filename === undefined &&
        category === undefined &&
        tags === undefined &&
        description === undefined
      ) {
        return textResult(
          "Aucun changement demandé : fournir filename, category, tags et/ou description."
        );
      }
      const doc = await updateDocument(OWNER_ID, id, {
        filename: filename?.replace(/[/\\]/g, "_"),
        category,
        tags,
        description,
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
