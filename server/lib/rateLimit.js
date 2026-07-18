// Rate limiting des tentatives de login — protège contre le brute-force.
// État stocké en Mongo (voir models/LoginAttempt.js) : compatible serverless,
// partagé entre toutes les instances de la fonction, pas de mémoire locale.
import { connectDb } from "./db.js";
import { LoginAttempt } from "../models/LoginAttempt.js";

const WINDOW_MS = 15 * 60 * 1000; // fenêtre glissante de 15 min
const MAX_ATTEMPTS = 5; // tentatives autorisées avant blocage
// Escalade : 15 min, puis 1h, puis 4h pour les récidives dans les fenêtres suivantes.
const BLOCK_DURATIONS_MS = [15 * 60 * 1000, 60 * 60 * 1000, 4 * 60 * 60 * 1000];

function rateLimitKey(req) {
  const ip = req.ip || "unknown";
  const email = String(req.body?.email || "").trim().toLowerCase();
  // Clé = IP + email tenté : bloque le brute-force ciblé sur un compte tout en
  // laissant une IP partagée (réseau familial, 4G) tenter d'autres emails.
  return `${ip}:${email}`;
}

function blockDurationFor(blockCount) {
  const idx = Math.min(blockCount, BLOCK_DURATIONS_MS.length - 1);
  return BLOCK_DURATIONS_MS[idx];
}

// Middleware à poser avant verifyCredentials. Lecture seule : l'écriture
// (échec/succès) est faite explicitement par la route une fois le résultat
// connu, via recordLoginFailure / recordLoginSuccess ci-dessous.
export async function checkLoginRateLimit(req, res, next) {
  try {
    await connectDb();
    const key = rateLimitKey(req);
    req.loginRateLimitKey = key;
    const doc = await LoginAttempt.findOne({ key });
    const now = Date.now();
    if (doc?.blockedUntil && doc.blockedUntil.getTime() > now) {
      const retryAfterSeconds = Math.ceil((doc.blockedUntil.getTime() - now) / 1000);
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        error: `Trop de tentatives. Réessayez dans ${Math.ceil(retryAfterSeconds / 60)} min.`,
      });
    }
    next();
  } catch (err) {
    // Mongo indisponible : on ne bloque pas le login pour autant, mais on ne
    // le protège plus non plus le temps de l'incident. Erreur loggée pour audit.
    console.error("checkLoginRateLimit:", err);
    next();
  }
}

// À appeler après un login raté (identifiants ou TOTP invalides).
export async function recordLoginFailure(req) {
  try {
    await connectDb();
    const key = req.loginRateLimitKey || rateLimitKey(req);
    const now = Date.now();
    const doc = await LoginAttempt.findOne({ key });

    if (!doc || now - doc.firstAttemptAt.getTime() > WINDOW_MS) {
      // Nouvelle fenêtre : compteur de tentatives à zéro. blockCount est
      // conservé (via $setOnInsert seulement s'il n'existe pas) pour que
      // l'escalade progressive survive aux fenêtres successives.
      await LoginAttempt.findOneAndUpdate(
        { key },
        {
          $set: {
            attempts: 1,
            firstAttemptAt: new Date(now),
            blockedUntil: null,
            expiresAt: new Date(now + WINDOW_MS),
          },
          $setOnInsert: { blockCount: 0 },
        },
        { upsert: true }
      );
      return;
    }

    const attempts = doc.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      const blockCount = doc.blockCount + 1;
      const blockedUntil = new Date(now + blockDurationFor(blockCount - 1));
      await LoginAttempt.updateOne(
        { key },
        {
          $set: {
            attempts,
            blockedUntil,
            blockCount,
            expiresAt: new Date(blockedUntil.getTime() + WINDOW_MS),
          },
        }
      );
    } else {
      await LoginAttempt.updateOne(
        { key },
        { $set: { attempts, expiresAt: new Date(now + WINDOW_MS) } }
      );
    }
  } catch (err) {
    console.error("recordLoginFailure:", err);
  }
}

// À appeler après un login réussi : efface l'historique pour cette clé.
export async function recordLoginSuccess(req) {
  try {
    await connectDb();
    const key = req.loginRateLimitKey || rateLimitKey(req);
    await LoginAttempt.deleteOne({ key });
  } catch (err) {
    console.error("recordLoginSuccess:", err);
  }
}
