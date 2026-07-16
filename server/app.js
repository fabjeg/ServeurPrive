import express from "express";
import cookieParser from "cookie-parser";
import { authRouter } from "./routes/auth.js";
import { documentsRouter } from "./routes/documents.js";
import { uploadRouter } from "./routes/upload.js";
import { mcpRouter } from "./mcp/index.js";

export const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" })); // métadonnées et JSON-RPC uniquement — jamais de fichier
app.use(cookieParser());

app.use("/api/auth", authRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/mcp/:token", mcpRouter); // jeton dans l'URL (connecteur claude.ai)
app.use("/api/mcp", mcpRouter); // jeton en Bearer (Claude Code, API)

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api", (req, res) => res.status(404).json({ error: "Route inconnue." }));

// Gestion d'erreur centralisée : ne jamais fuiter de détails internes.
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Erreur interne." });
});
