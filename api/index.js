// Point d'entrée unique des fonctions serverless Vercel.
// vercel.json réécrit /api/* vers cette fonction ; Express fait le routage interne.
import { app } from "../server/app.js";

// Le chatbot (/api/chat) répond en SSE : sans ce flag, Vercel bufferise la
// réponse et le stream n'arrive qu'à la fin. maxDuration : la boucle
// recherche + lecture PDF + génération peut dépasser les 10 s par défaut.
export const supportsResponseStreaming = true;
export const maxDuration = 60;

export default app;
