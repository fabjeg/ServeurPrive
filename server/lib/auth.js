// Authentification : application mono-utilisateur, identité définie par les
// variables d'environnement. Session portée par un JWT en cookie httpOnly.
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { authenticator } from "otplib";
import { env } from "./env.js";

export const SESSION_COOKIE = "frigo_session";
const SESSION_TTL = "7d";

// Identifiant stable du propriétaire (mono-utilisateur).
export const OWNER_ID = "owner";

export function verifyCredentials(email, password, totpCode) {
  if (!email || !password) return { ok: false, error: "Identifiants requis." };
  const emailOk = email.trim().toLowerCase() === env.authEmail.trim().toLowerCase();
  const passwordOk = bcrypt.compareSync(password, env.authPasswordHash);
  if (!emailOk || !passwordOk) {
    return { ok: false, error: "Identifiants invalides." };
  }
  if (env.totpSecret) {
    if (!totpCode) return { ok: false, error: "Code 2FA requis.", totpRequired: true };
    const totpOk = authenticator.verify({ token: String(totpCode), secret: env.totpSecret });
    if (!totpOk) return { ok: false, error: "Code 2FA invalide.", totpRequired: true };
  }
  return { ok: true };
}

export function createSessionToken() {
  return jwt.sign({ sub: OWNER_ID }, env.jwtSecret, { expiresIn: SESSION_TTL });
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

export function verifySessionToken(token) {
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    return payload.sub === OWNER_ID ? payload : null;
  } catch {
    return null;
  }
}

// Middleware Express : refuse toute requête sans session valide.
// Appliqué à TOUTES les routes documentaires (listing et téléchargement compris).
export function requireAuth(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  const session = token ? verifySessionToken(token) : null;
  if (!session) {
    return res.status(401).json({ error: "Authentification requise." });
  }
  req.ownerId = OWNER_ID;
  next();
}

// Middleware du serveur MCP : jeton Bearer dédié (connecteur Claude).
// La règle "rien sans authentification" s'applique aussi ici.
export function requireMcpAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token || !timingSafeEqual(token, env.mcpAccessToken)) {
    return res.status(401).json({ error: "Jeton MCP invalide." });
  }
  req.ownerId = OWNER_ID;
  next();
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
