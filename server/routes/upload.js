// Génération de jetons d'upload client → Blob.
// Le fichier ne transite JAMAIS par cette fonction (limite 4,5 Mo de Vercel) :
// on ne fait que signer un jeton après avoir vérifié la session.
import { Router } from "express";
import { handleUpload } from "@vercel/blob/client";
import { SESSION_COOKIE, verifySessionToken, OWNER_ID } from "../lib/auth.js";
import { env } from "../lib/env.js";
import { registerDocument } from "../services/documents.js";

export const uploadRouter = Router();

uploadRouter.post("/", async (req, res) => {
  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      token: env.blobToken,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // Vérification d'authentification AVANT toute génération de jeton.
        const session = verifySessionToken(req.cookies?.[SESSION_COOKIE]);
        if (!session) {
          throw new Error("Authentification requise.");
        }
        // Jeton scoppé : préfixe imposé par utilisateur, suffixe aléatoire.
        if (!pathname.startsWith(`documents/${OWNER_ID}/`)) {
          throw new Error("Chemin d'upload non autorisé.");
        }
        return {
          access: "private",
          addRandomSuffix: true,
          maximumSizeInBytes: 500 * 1024 * 1024,
          tokenPayload: JSON.stringify({
            ownerId: OWNER_ID,
            clientPayload: clientPayload || null,
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Appelé par Vercel Blob en production (pas en localhost) —
        // le client fait aussi une confirmation explicite, l'upsert déduplique.
        const payload = JSON.parse(tokenPayload || "{}");
        const meta = JSON.parse(payload.clientPayload || "{}");
        await registerDocument(payload.ownerId || OWNER_ID, {
          filename: meta.filename || blob.pathname.split("/").pop(),
          mimetype: meta.mimetype || blob.contentType || "application/octet-stream",
          category: meta.category || "divers",
          tags: Array.isArray(meta.tags) ? meta.tags : [],
          size: meta.size || 0,
          blobPath: blob.pathname,
          blobUrl: blob.url,
        });
      },
    });
    res.json(jsonResponse);
  } catch (err) {
    res.status(err.message === "Authentification requise." ? 401 : 400).json({
      error: err.message,
    });
  }
});
