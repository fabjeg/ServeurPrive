import { Router } from "express";
import {
  SESSION_COOKIE,
  createSessionToken,
  requireAuth,
  sessionCookieOptions,
  verifyCredentials,
} from "../lib/auth.js";
import {
  checkLoginRateLimit,
  recordLoginFailure,
  recordLoginSuccess,
} from "../lib/rateLimit.js";
import { env } from "../lib/env.js";

export const authRouter = Router();

authRouter.post("/login", checkLoginRateLimit, async (req, res) => {
  const { email, password, totp } = req.body || {};
  const result = verifyCredentials(email, password, totp);
  if (!result.ok) {
    await recordLoginFailure(req);
    return res
      .status(401)
      .json({ error: result.error, totpRequired: !!result.totpRequired });
  }
  await recordLoginSuccess(req);
  res.cookie(SESSION_COOKIE, createSessionToken(), sessionCookieOptions());
  res.json({ ok: true });
});

authRouter.post("/logout", (req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ email: env.authEmail, totpEnabled: !!env.totpSecret });
});

// Permet au frontend de savoir si la 2FA est active avant le login.
authRouter.get("/config", (req, res) => {
  res.json({ totpEnabled: !!env.totpSecret });
});
