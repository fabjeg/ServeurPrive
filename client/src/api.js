// Client API : toutes les requêtes portent le cookie de session (httpOnly).
// Cloisonnement pro/perso : chaque fonction qui touche des documents/dossiers
// prend `space` en premier argument — jamais de défaut silencieux, pour ne
// jamais risquer d'envoyer une requête vers le mauvais espace.
async function request(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Erreur ${res.status}`);
    err.status = res.status;
    err.totpRequired = !!data.totpRequired;
    throw err;
  }
  return data;
}

function withSpace(space, params = {}) {
  const qs = new URLSearchParams();
  qs.set("space", space);
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  return qs.toString();
}

export const api = {
  authConfig: () => request("/api/auth/config"),
  me: () => request("/api/auth/me"),
  login: (email, password, totp) =>
    request("/api/auth/login", { method: "POST", body: { email, password, totp } }),
  logout: () => request("/api/auth/logout", { method: "POST" }),

  listDocuments: (space, filters = {}) =>
    request(`/api/documents?${withSpace(space, filters)}`),
  getDocument: (space, id) => request(`/api/documents/${id}?${withSpace(space)}`),
  searchDocuments: (space, q) => request(`/api/documents/search?${withSpace(space, { q })}`),
  listCategories: (space) => request(`/api/documents/categories?${withSpace(space)}`),
  registerDocument: (space, meta) =>
    request("/api/documents", { method: "POST", body: { ...meta, space } }),
  updateDocument: (space, id, patch) =>
    request(`/api/documents/${id}`, { method: "PATCH", body: { ...patch, space } }),
  deleteDocument: (space, id) =>
    request(`/api/documents/${id}?${withSpace(space)}`, { method: "DELETE" }),
  analyzeDocument: (space, id) =>
    request(`/api/documents/${id}/analyze`, { method: "POST", body: { space } }),
  createScanDocument: (space, body) =>
    request("/api/documents/scan", { method: "POST", body: { ...body, space } }),

  // Dossiers (marque -> modèle, pro uniquement côté UI). Sans parentId,
  // liste les marques (dossiers de premier niveau) uniquement.
  listFolders: (space, { parentId } = {}) => request(`/api/folders?${withSpace(space, { parentId })}`),
  folderDetail: (space, id) => request(`/api/folders/${id}?${withSpace(space)}`),
  createFolder: (space, body) =>
    request("/api/folders", { method: "POST", body: { ...body, space } }),
  updateFolder: (space, id, body) =>
    request(`/api/folders/${id}`, { method: "PATCH", body: { ...body, space } }),
  deleteFolder: (space, id) =>
    request(`/api/folders/${id}?${withSpace(space)}`, { method: "DELETE" }),

  // URLs du proxy authentifié — jamais d'URL Blob directe.
  fileUrl: (space, id) => `/api/documents/${id}/file?${withSpace(space)}`,
  downloadUrl: (space, id) => `/api/documents/${id}/file?${withSpace(space, { download: "1" })}`,
};
