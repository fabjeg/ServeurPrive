import express from "express";
import cookieParser from "cookie-parser";
// Doit être importé avant toute route pouvant charger pdf-parse (extraction
// PDF) — voir le commentaire du fichier pour le pourquoi.
import "./lib/pdfjsPolyfill.js";
import { env } from "./lib/env.js";
import { authRouter } from "./routes/auth.js";
import { documentsRouter } from "./routes/documents.js";
import { foldersRouter } from "./routes/folders.js";
import { repairsRouter } from "./routes/repairs.js";
import { uploadRouter } from "./routes/upload.js";
import { chatRouter } from "./routes/chat.js";
import { mcpRouter } from "./mcp/index.js";

export const app = express();

app.disable("x-powered-by");
// Vercel fait tourner l'app derrière un proxy : sans ça, req.ip renverrait
// l'adresse interne du proxy et pas celle du client, ce qui casserait le
// rate limiting par IP sur /api/auth/login (voir lib/rateLimit.js).
if (env.isProduction) app.set("trust proxy", 1);
// Métadonnées, JSON-RPC et le base64 du tool MCP add_document (≤ ~3 Mo de
// fichier → ~4 Mo encodé). Les uploads web, eux, ne passent jamais par ici.
app.use(express.json({ limit: "4.5mb" }));
app.use(cookieParser());

app.use("/api/auth", authRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/folders", foldersRouter);
app.use("/api/repairs", repairsRouter);
app.use("/api/chat", chatRouter);
app.use("/api/mcp/:token", mcpRouter); // jeton dans l'URL (connecteur claude.ai)
app.use("/api/mcp", mcpRouter); // jeton en Bearer (Claude Code, API)

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Les sondes de découverte OAuth (claude.ai, clients MCP) doivent recevoir un
// vrai 404 — sinon le fallback SPA leur sert index.html en 200 et les clients
// croient qu'un serveur OAuth existe, puis échouent à s'y enregistrer.
app.use("/.well-known", (req, res) => res.status(404).json({ error: "Not found" }));

app.use("/api", (req, res) => res.status(404).json({ error: "Route inconnue." }));

// Gestion d'erreur centralisée : ne jamais fuiter de détails internes.
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Erreur interne." });
});
