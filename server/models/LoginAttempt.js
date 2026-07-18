// Suivi des tentatives de connexion échouées, pour le rate limiting du login.
// Un document par clé (IP + email tenté). État en Mongo (pas en mémoire locale)
// car les fonctions serverless Vercel n'ont pas de mémoire partagée entre
// invocations. Purge automatique via TTL Mongo — pas de tâche de nettoyage à gérer.
import mongoose from "mongoose";

const loginAttemptSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    attempts: { type: Number, default: 0 },
    firstAttemptAt: { type: Date, default: Date.now },
    blockedUntil: { type: Date, default: null },
    // Nombre de blocages déjà infligés à cette clé — sert à l'escalade
    // progressive de la durée de blocage (voir lib/rateLimit.js).
    blockCount: { type: Number, default: 0 },
    // TTL : Mongo supprime automatiquement le document une fois ce champ dépassé.
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false }
);

loginAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const LoginAttempt =
  mongoose.models.LoginAttempt || mongoose.model("LoginAttempt", loginAttemptSchema);
