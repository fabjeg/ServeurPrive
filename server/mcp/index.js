// Serveur MCP (Streamable HTTP, mode stateless) — connecteur personnalisé Claude.
// Protégé par jeton Bearer (MCP_ACCESS_TOKEN) : la règle "rien sans
// authentification" s'applique aussi au connecteur.
import { Router } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { requireMcpAuth, OWNER_ID } from "../lib/auth.js";
import {
  fetchBlobResponse,
  getDocument,
  listDocuments,
} from "../services/documents.js";

const TEXT_MIMETYPES = /^(text\/|application\/(json|xml|javascript|x-yaml|csv))/;
const IMAGE_MIMETYPES = /^image\/(png|jpeg|gif|webp)$/;
const MAX_INLINE_BYTES = 4 * 1024 * 1024;

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
        `Ajouté le : ${doc.uploadedAt.toISOString()}`;

      if (doc.size > MAX_INLINE_BYTES) {
        return textResult(
          `${header}\n\n(Fichier trop volumineux pour être retourné inline — consultez-le dans l'application Frigo.)`
        );
      }

      const blobRes = await fetchBlobResponse(doc);
      if (!blobRes.ok) return textResult(`${header}\n\n(Contenu inaccessible dans le stockage.)`);

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

  return server;
}

export const mcpRouter = Router();
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
