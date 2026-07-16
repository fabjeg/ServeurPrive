// Point d'entrée unique des fonctions serverless Vercel.
// vercel.json réécrit /api/* vers cette fonction ; Express fait le routage interne.
import { app } from "../server/app.js";

export default app;
