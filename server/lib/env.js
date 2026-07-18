// Accès centralisé aux variables d'environnement, avec échec explicite
// au premier usage si une variable indispensable manque.
function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variable d'environnement manquante : ${name}`);
  }
  return value;
}

export const env = {
  get mongodbUri() {
    return required("MONGODB_URI");
  },
  get blobToken() {
    return required("BLOB_READ_WRITE_TOKEN");
  },
  get authEmail() {
    return required("AUTH_EMAIL");
  },
  get authPasswordHash() {
    return required("AUTH_PASSWORD_HASH");
  },
  get jwtSecret() {
    return required("JWT_SECRET");
  },
  get totpSecret() {
    // Optionnel : 2FA activée seulement si défini.
    return process.env.TOTP_SECRET || null;
  },
  get mcpAccessToken() {
    return required("MCP_ACCESS_TOKEN");
  },
  get anthropicApiKey() {
    // Optionnel : le chatbot est désactivé (erreur explicite) si absent.
    return process.env.ANTHROPIC_API_KEY || null;
  },
  get isProduction() {
    return process.env.NODE_ENV === "production" || !!process.env.VERCEL;
  },
};
